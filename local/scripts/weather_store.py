"""Inventory and narrowly scoped deletion inside the Docker data volume."""
import datetime
import hashlib
import json
import os
import re
import stat
import sys

RUN = re.compile(r"^\d{8}(00|06|12|18)$")
TEMP = re.compile(r"^download-\d{8}(00|06|12|18)(?:\.gribmirror)?$")


def valid_run(value):
    if not RUN.fullmatch(value):
        return False
    try:
        datetime.datetime.strptime(value, "%Y%m%d%H")
        return True
    except ValueError:
        return False


def file_info(directory, name):
    path = os.path.join(directory, name)
    info = os.stat(path, follow_symlinks=False)
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Regular files only: " + name)
    signature = "%s:%s:%s:%s" % (name, info.st_ino, info.st_size, info.st_mtime_ns)
    return {"name": name, "bytes": info.st_size, "allocatedBytes": info.st_blocks * 512,
            "fingerprint": hashlib.sha256(signature.encode()).hexdigest()}


def inventory(base="/srv"):
    from tawhiri.dataset import Dataset
    directory = os.path.join(base, "tawhiri-datasets")
    if os.path.islink(directory):
        raise ValueError("Dataset directory must not be a symlink")
    records, temporary = [], []
    names = os.listdir(directory) if os.path.isdir(directory) else []
    for name in sorted(names, reverse=True):
        if valid_run(name):
            try:
                files = [file_info(directory, name)]
                if name + ".gribmirror" in names:
                    files.append(file_info(directory, name + ".gribmirror"))
            except ValueError:
                continue
            dt = datetime.datetime.strptime(name, "%Y%m%d%H")
            record = {"run": name, "format": "standard-v1", "valid": files[0]["bytes"] == Dataset.size,
                      "bytes": sum(f["bytes"] for f in files), "allocatedBytes": sum(f["allocatedBytes"] for f in files),
                      "forecastStart": dt.isoformat() + "Z",
                      "forecastEnd": (dt + datetime.timedelta(hours=Dataset.axes.hour[-1])).isoformat() + "Z",
                      "files": files}
            record["fingerprint"] = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
            records.append(record)
        elif TEMP.fullmatch(name) or (name.endswith(".gribmirror") and valid_run(name[:-11]) and name[:-11] not in names):
            try:
                temporary.append(file_info(directory, name))
            except ValueError:
                pass
    elevation = {"ready": False, "bytes": 0}
    try:
        elevation = file_info(base, "ruaumoko-dataset")
        elevation["ready"] = elevation["bytes"] == 4 * 6 * 10801 * 14401 * 2
    except (OSError, ValueError):
        pass
    try:
        temporary.append(file_info(base, "ruaumoko-dataset.partial"))
    except (OSError, ValueError):
        pass
    usage = os.statvfs(base)
    revision = hashlib.sha256(json.dumps([records, elevation], sort_keys=True).encode()).hexdigest()
    return {"datasets": records, "temporary": temporary, "elevation": elevation, "revision": revision,
            "freeBytes": usage.f_bavail * usage.f_frsize,
            "usedBytes": sum(r["allocatedBytes"] for r in records) + elevation.get("allocatedBytes", 0) + sum(t["allocatedBytes"] for t in temporary)}


def delete(action, target, fingerprint, base="/srv"):
    data = inventory(base)
    if action == "delete-run":
        if not valid_run(target):
            raise ValueError("Invalid GFS run")
        candidates = [r for r in data["datasets"] if r["run"] == target]
        if not candidates or candidates[0]["fingerprint"] != fingerprint:
            raise ValueError("Dataset changed; refresh before deleting")
        directory = os.path.join(base, "tawhiri-datasets")
        files = candidates[0]["files"]
    elif action == "cleanup":
        candidates = [r for r in data["temporary"] if r["name"] == target]
        if not candidates or candidates[0]["fingerprint"] != fingerprint:
            raise ValueError("Temporary file changed; refresh before deleting")
        files = candidates
        directory = base if target == "ruaumoko-dataset.partial" else os.path.join(base, "tawhiri-datasets")
    else:
        raise ValueError("Unknown operation")
    # No recursion, wildcard expansion, symlink traversal, or elevation deletion.
    for item in files:
        if file_info(directory, item["name"])["fingerprint"] != item["fingerprint"]:
            raise ValueError("File changed")
    for item in files:
        os.unlink(os.path.join(directory, item["name"]))
    return {"deleted": [f["name"] for f in files], "bytes": sum(f["bytes"] for f in files)}


if __name__ == "__main__":
    try:
        action = sys.argv[1] if len(sys.argv) > 1 else "inventory"
        result = inventory() if action == "inventory" else delete(action, sys.argv[2], sys.argv[3])
        print(json.dumps(result))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
