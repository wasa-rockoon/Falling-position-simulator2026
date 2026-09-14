"""Offline reference generator, executed INSIDE the pinned Docker image.
No HTTP API, downloader, patched solver, or ported Python interpolator.
--capture-terrain reads the existing read-only /srv volume once.
Without it, only committed fixtures and the pinned image are required.
"""
import argparse
import calendar
import datetime as dt
import hashlib
import importlib
import json
import math
import mmap
import os
import pathlib
import struct
import sys
import tempfile
from types import SimpleNamespace

from tawhiri import dataset, models, solver, interpolate, warnings
from ruaumoko.dataset import Dataset as Terrain

ROOT = pathlib.Path(__file__).resolve().parent
FIX = ROOT / "fixtures"
IMAGE = "ghcr.io/projecthorus/tawhiri-container@sha256:9714dc04a22f8982d810f3dc6f3a8ca69f84274cc4d8bff47ce52b42f0c1e451"
def sha(data):
    return hashlib.sha256(data).hexdigest()
def load(name):
    return json.loads((FIX/name).read_text())
def save(name,value):
    (FIX/name).parent.mkdir(parents=True,exist_ok=True)
    (FIX/name).write_text(json.dumps(value,indent=2,allow_nan=False)+"\n")

def capture_terrain():
    # Exact rows from the original 4x6 tiled int16 file, including tile layout.
    first_row,first_col = (90-35)*240,(131+180)*240
    rows,cols = 3*240+1,4*240+1
    blob=bytearray()
    with open("/srv/ruaumoko-dataset","rb") as f:
        for row in range(first_row,first_row+rows):
            br,ry=divmod(row,10800)
            bc,cx=divmod(first_col,14400)
            assert cx+cols<=14401
            offset=(((br*6+bc)*10801+ry)*14401+cx)*2
            f.seek(offset)
            block=f.read(cols*2)
            assert len(block)==cols*2
            blob.extend(block)
    (FIX/"terrain.bin").write_bytes(blob)
    meta={"dtype":"int16-le","samplesPerDegree":240,"firstGlobalRow":first_row,
          "firstGlobalColumn":first_col,"rows":rows,"columns":cols,"file":"terrain.bin",
          "bytes":len(blob),"sha256":sha(blob),
          "source":{"file":"/srv/ruaumoko-dataset","bytes":os.stat("/srv/ruaumoko-dataset").st_size,
                    "dataset":"Installed Ruaumoko 15 arcsecond snapshot; exact upstream release unknown",
                    "attribution":"Viewfinder Panoramas / Jonathan de Ferranti",
                    "url":"https://www.viewfinderpanoramas.org/dem3.html",
                    "fullFileHash":None,"identity":"SHA256 of the exact cropped bytes, not a claim about the whole DEM"},
          "cellChecks":[]}
    original=Terrain()
    for i in range(70):
        lat=32.01+(i%10)*.29837
        lon=131.01+(i//10)*.64123
        row=int(math.floor((90-lat)*240+.5))-first_row
        col=int(math.floor(((lon+180)%360)*240+.5))-first_col
        expected=original.get(lat,lon)
        actual=struct.unpack_from("<h",blob,(row*cols+col)*2)[0]
        assert expected==actual
        meta["cellChecks"].append({"latitude":lat,"longitude":lon,"altitude":expected})
    save("terrain.json",meta)

def main(case_name="case.json",output_name="reference.json"):
    if (FIX/"baseline.json").exists():
        locked=load("baseline.json")
        for name,expected in locked["sourceHashes"].items():
            assert sha((pathlib.Path("/root/tawhiri-master/tawhiri")/name).read_bytes())==expected, ("Wrong baseline source",name)
        for name,expected in locked["compiledModules"].items():
            assert sha(pathlib.Path(importlib.import_module(name).__file__).read_bytes())==expected["sha256"], ("Wrong baseline binary",name)
    if "--capture-terrain" in sys.argv:
        capture_terrain()
    m,c,tm=load("manifest.json"),load(case_name),load("terrain.json")
    wb=(FIX/"weather.bin").read_bytes()
    tb=(FIX/"terrain.bin").read_bytes()
    assert sha(wb)==m["sha256"] and sha(tb)==tm["sha256"]
    assert m["pressureLevelsHpa"]==list(dataset.Dataset.axes.pressure)
    assert m["variables"]==list(dataset.Dataset.axes.variable)
    # Reserve the original global layout, but commit only the small fixture.
    # No global GFS download, no 9.5GB physical file.
    weather_map=mmap.mmap(-1,dataset.Dataset.size)
    nt,nl,nv,ny,nx=m["shape"]
    for ti,h in enumerate(m["forecastHours"]):
        for level in range(nl):
            for var in range(nv):
                for y in range(ny):
                    source=((((ti*nl+level)*nv+var)*ny+y)*nx)*4
                    target=(((((h//3)*47+level)*3+var)*361+int((m["latitude"]["start"]+90)*2)+y)*720+int(m["longitude"]["start"]*2))*4
                    weather_map[target:target+nx*4]=wb[source:source+nx*4]
    run=dt.datetime.strptime(m["run"],"%Y-%m-%dT%H:%M:%SZ")
    ds=SimpleNamespace(array=weather_map,ds_time=run)
    wc=warnings.WarningCounts()
    native_wind=interpolate.make_interpolator(ds,wc)
    def guard(hour,lat,lon):
        # Check all eight cells even when a weight is zero. Outside-crop zeros
        # in the sparse layout must NEVER enter the reference calculation.
        ti=int(hour/3)*3
        yi=int((lat+90)*2)/2-90
        xi=int(lon*2)/2
        assert ti in m["forecastHours"][:-1], ("weather time",hour)
        assert 30<=yi and yi+.5<=36 and 128<=xi and xi+.5<=137, ("weather region",lat,lon)
    with tempfile.TemporaryFile() as terrain_file:
        terrain_file.truncate(4*6*10801*14401*2)
        for y in range(tm["rows"]):
            row=tm["firstGlobalRow"]+y
            br,ry=divmod(row,10800)
            bc,cx=divmod(tm["firstGlobalColumn"],14400)
            offset=(((br*6+bc)*10801+ry)*14401+cx)*2
            terrain_file.seek(offset)
            start=y*tm["columns"]*2
            terrain_file.write(tb[start:start+tm["columns"]*2])
        terrain_file.flush()
        native_terrain=Terrain("/proc/self/fd/%d"%terrain_file.fileno())
        terrain_accesses=[]
        class CheckedTerrain:
            def get(self,lat,lon):
                row=int(math.floor((90-lat)*240+.5))-tm["firstGlobalRow"]
                col=int(math.floor(((lon+180)%360)*240+.5))-tm["firstGlobalColumn"]
                assert 0<=row<tm["rows"] and 0<=col<tm["columns"], ("terrain region",lat,lon)
                value=native_terrain.get(lat,lon)
                assert value==struct.unpack_from("<h",tb,(row*tm["columns"]+col)*2)[0]
                terrain_accesses.append({"latitude":lat,"longitude":lon,"altitude":value})
                return value
        epoch=calendar.timegm(run.timetuple())
        start=calendar.timegm(dt.datetime.strptime(c["launchDatetime"],"%Y-%m-%dT%H:%M:%SZ").timetuple())
        chain=models.standard_profile(c["ascentRate"],c["burstAltitude"],c["descentRate"],ds,CheckedTerrain(),wc)
        def checked(model):
            def f(t,lat,lon,alt):
                guard((t-epoch)/3600,lat,lon)
                return model(t,lat,lon,alt)
            return f
        chain=tuple((checked(model),term) for model,term in chain)
        result=solver.solve(start,c["launchLatitude"],c["launchLongitude"],c["launchAltitude"],chain)
        prediction=[]
        for label,points in zip(["ascent","descent"],result):
            prediction.append({"stage":label,"trajectory":[
                {"latitude":lat,"longitude":lon,"altitude":alt,"timeSeconds":t,
                 "datetime":dt.datetime.utcfromtimestamp(t).isoformat()+"Z"} for t,lat,lon,alt in points]})
        samples=[]
        # Deliberately independent points: fractional time/position, atmospheric
        # layer boundaries, extrapolation below/above the pressure-height range.
        for i,alt in enumerate([-100,6,100,1234,10999,11000,11001,17000,24999,25000,25001,30000,48000,60000]):
            hour=3.125+(i%6)*.73
            lat=33.13492+(i%4)*.071
            lon=132.50477+(i%5)*.063
            guard(hour,lat,lon)
            u,v=native_wind(hour,lat,lon,alt)
            samples.append({"hour":hour,"latitude":lat,"longitude":lon,"altitude":alt,"u":u,"v":v})
        for stage in result:
            for t,lat,lon,alt in stage[::max(1,len(stage)//12)]:
                u,v=native_wind((t-epoch)/3600,lat,lon,alt)
                samples.append({"hour":(t-epoch)/3600,"latitude":lat,"longitude":lon,"altitude":alt,"u":u,"v":v})
        save(output_name,{"image":IMAGE,"weatherSha256":sha(wb),"terrainSha256":sha(tb),"caseSha256":sha((FIX/case_name).read_bytes()),
             "prediction":prediction,"windSamples":samples,"terrainSamples":terrain_accesses,
             "descentSamples":[{"altitude":a,"velocity":models.make_drag_descent(c["descentRate"])(0,0,0,a)[2]} for a in [0,100,11000,11001,25000,25001,30000]]})
    if case_name != "case.json":
        print("Reference:",case_name,"->",output_name,"points:",sum(len(p["trajectory"]) for p in prediction))
        return
    source_dir=ROOT/"reference-source"
    source_dir.mkdir(exist_ok=True)
    hashes={}
    for name in ["models.py","solver.pyx","interpolate.pyx","dataset.py","warnings.pyx"]:
        p=pathlib.Path("/root/tawhiri-master/tawhiri")/name
        data=p.read_bytes()
        (source_dir/name).write_bytes(data)
        hashes[name]=sha(data)
    lic=pathlib.Path("/root/tawhiri-master/LICENCE")
    if lic.exists():
        (source_dir/"LICENSE").write_bytes(lic.read_bytes())
    compiled={}
    for module in [solver,interpolate,importlib.import_module("ruaumoko.dataset")]:
        p=pathlib.Path(module.__file__)
        compiled[module.__name__]={"file":str(p),"sha256":sha(p.read_bytes())}
    info=pathlib.Path("/root/tawhiri-master/Tawhiri.egg-info/PKG-INFO").read_text()
    save("baseline.json",{"image":IMAGE,"tawhiriPackage":info,"tawhiriCommit":None,
         "commitNote":"Image contains no git checkout metadata. Pin by image digest, source hashes and compiled module hashes.",
         "python":sys.version,"sourceHashes":hashes,"compiledModules":compiled,
         "shape":list(dataset.Dataset.shape),"pressureLevelsHpa":list(dataset.Dataset.axes.pressure),
         "forecastIntervalHours":3,"resolutionDegrees":.5,"timestepSeconds":60,"terminationTolerance":.01,
         "ascent":"constant rate","descent":"models.make_drag_descent standard atmosphere",
         "burst":"altitude >= burstAltitude","landing":"terrain.get(latitude,longitude) > altitude (no added sea-level condition)"})
    print("Reference:",[(p["stage"],len(p["trajectory"])) for p in prediction])
    print("Landing:",prediction[-1]["trajectory"][-1])

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case",default="case.json")
    parser.add_argument("--output",default="reference.json")
    parser.add_argument("--capture-terrain",action="store_true")
    args=parser.parse_args()
    for value in [args.case,args.output]:
        path=(FIX/value).resolve()
        if FIX.resolve() not in path.parents or path.suffix!=".json":
            parser.error("Case/output must be JSON files within fixtures/")
    if args.case!="case.json" and args.output=="reference.json":
        parser.error("Additional cases must not overwrite the Phase 0 reference")
    main(args.case,args.output)
