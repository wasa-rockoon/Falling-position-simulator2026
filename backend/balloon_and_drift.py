#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
balloon_and_drift.py

Tawhiri (SondeHub API) による気球軌道予測と、
OpenDrift による海洋漂流予測を統合したシミュレーター。

主な機能:
1. 指定パラメータで気球の飛行・着水を予測 (SondeHub APIを使用)
2. 着水地点周辺の海流・風・波データを自動ダウンロード (Copernicus Marine)
3. 着水点からの漂流をシミュレーション (OpenDrift)
4. 結果を統合したCSVと地図画像を出力

Usage:
  python balloon_and_drift.py \
    --lat 33.4 --lon 135.2 --time "2026-02-14T10:00:00" \
    --ascent-rate 5 --burst-altitude 30000 --descent-rate 10 \
    --hours 6 --pretty-png

Dependencies:
  pip install opendrift xarray netcdf4 pandas matplotlib cmocean cartopy copernicus-marine-client requests
"""

import os
import sys
import argparse
import json
import subprocess
import shutil
import requests
import math
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

# OpenDrift modules
# cartopy は OpenDrift の内部依存で、未導入だと import 時点で失敗することがある。
# その場合は漂流計算をスキップして、気球軌道のみ返すようにする。
try:
    from opendrift.models.oceandrift import OceanDrift
    from opendrift.readers.reader_netCDF_CF_generic import Reader
    from opendrift.readers import reader_constant
    OPENDRIFT_AVAILABLE = True
except Exception as exc:
    OceanDrift = None
    Reader = None
    reader_constant = None
    OPENDRIFT_AVAILABLE = False
    OPENDRIFT_IMPORT_ERROR = exc

# =============================================================================
# 1. Tawhiri (気球軌道予測) 連携パート
# =============================================================================

# APIエンドポイント (SondeHub Tawhiri)
TAWHIRI_API_URL = "https://api.v2.sondehub.org/tawhiri"

def run_tawhiri_simulation(lat, lon, launch_time, ascent_rate, burst_alt, descent_rate):
    """
    Tawhiri API (SondeHub) を叩いて気球の軌道を取得し、着水点(または最終地点)を返す。
    """
    
    # 時刻フォーマットの正規化 (APIが 'Z' を要求するため)
    if not launch_time.endswith('Z'):
        launch_time += 'Z'

    print(f"[Tawhiri] Simulating flight via SondeHub...")
    print(f"          Launch: {lat:.4f}N, {lon:.4f}E at {launch_time}")

    # APIへのリクエストペイロード
    payload = {
        "launch_latitude": lat,
        "launch_longitude": lon,
        "launch_datetime": launch_time,
        "profile": "standard_profile",
        "ascent_rate": ascent_rate,
        "burst_altitude": burst_alt,
        "descent_rate": descent_rate
    }

    # Bot対策回避のためのヘッダー
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; ResearchScript/1.0; +http://github.com/)"
    }

    try:
        # GETリクエスト
        resp = requests.get(TAWHIRI_API_URL, params=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"[ERROR] Tawhiri API request failed: {e}")
        if 'resp' in locals():
            print(f"Server response snippet: {resp.text[:200]}")
        sys.exit(1)

    # 軌道データの抽出
    trajectory_points = []
    
    if 'prediction' not in data:
        print("[ERROR] Tawhiri response has no 'prediction' data.")
        sys.exit(1)

    for stage in data['prediction']:
        stage_name = stage.get('stage', 'unknown')
        traj = stage.get('trajectory', [])
        for p in traj:
            trajectory_points.append({
                'time': p['datetime'],
                'lat': p['latitude'],
                'lon': p['longitude'],
                'alt': p['altitude'],
                'stage': stage_name
            })

    if not trajectory_points:
        print("[ERROR] No trajectory points returned from API.")
        sys.exit(1)

    # DataFrame化
    df_balloon = pd.DataFrame(trajectory_points)
    
    # 時刻変換 (エラー回避用)
    try:
        df_balloon['time'] = pd.to_datetime(df_balloon['time'], format='ISO8601')
    except Exception:
        df_balloon['time'] = pd.to_datetime(df_balloon['time'], format='mixed')
    
    # 最終地点（着水点とみなす）
    landing_point = df_balloon.iloc[-1]
    
    print(f"[Tawhiri] Simulation success. Total points: {len(df_balloon)}")
    print(f"          Landing: {landing_point['lat']:.4f}N, {landing_point['lon']:.4f}E at {landing_point['time']}")
    
    return df_balloon, landing_point

# =============================================================================
# 2. OpenDrift (海洋漂流予測) & データ取得パート
# =============================================================================

# CMEMS データセット設定
CURR_DATASET = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m" # Forecast (Future OK)
CURR_VARS = ["uo", "vo"]

WIND_DATASET = "cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H" # Observation (Past ONLY)
WIND_VARS = ["eastward_wind", "northward_wind"]

WAVES_DATASET = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i" # Forecast (Future OK)
WAVES_VARS = ["VSDX", "VSDY"]

def deg_buffer_from_km(lat_deg, radius_km):
    lat_per_km = 1.0 / 111.32
    lon_per_km = 1.0 / (111.32 * max(0.1, math.cos(math.radians(lat_deg))))
    return radius_km * lon_per_km, radius_km * lat_per_km

def nc_time_bounds(path):
    with xr.open_dataset(path) as ds:
        t = pd.to_datetime(ds["time"].values)
        return t.min().to_pydatetime().replace(tzinfo=None), t.max().to_pydatetime().replace(tzinfo=None)


def nc_spatial_bounds(path):
    with xr.open_dataset(path) as ds:
        lon_name = None
        lat_name = None
        for candidate in ["longitude", "lon", "x"]:
            if candidate in ds.coords or candidate in ds.data_vars:
                lon_name = candidate
                break
        for candidate in ["latitude", "lat", "y"]:
            if candidate in ds.coords or candidate in ds.data_vars:
                lat_name = candidate
                break

        if lon_name is None or lat_name is None:
            return None

        lon = ds[lon_name].values
        lat = ds[lat_name].values
        return float(np.nanmin(lon)), float(np.nanmax(lon)), float(np.nanmin(lat)), float(np.nanmax(lat))


_LAND_FEATURES = None


def load_land_features():
    global _LAND_FEATURES
    if _LAND_FEATURES is not None:
        return _LAND_FEATURES

    land_path = os.path.join(FRONTEND_DIR, "data", "land_japan_raw.geojson")
    features = []
    try:
        with open(land_path, 'r', encoding='utf-8') as f:
            geo = json.load(f)
        for feat in geo.get('features', []):
            geom = feat.get('geometry') or {}
            if geom.get('type') not in ('Polygon', 'MultiPolygon'):
                continue
            features.append({'geometry': geom, 'bbox': compute_geometry_bbox(geom)})
    except Exception as exc:
        print(f"[WARN] Failed to load land mask: {exc}")
        features = []

    _LAND_FEATURES = features
    return _LAND_FEATURES


def compute_geometry_bbox(geom):
    min_x = 999.0
    min_y = 999.0
    max_x = -999.0
    max_y = -999.0

    def add_coord(coord):
        nonlocal min_x, min_y, max_x, max_y
        x = coord[0]
        y = coord[1]
        min_x = min(min_x, x)
        min_y = min(min_y, y)
        max_x = max(max_x, x)
        max_y = max(max_y, y)

    if geom.get('type') == 'Polygon':
        for ring in geom.get('coordinates', []):
            for coord in ring:
                add_coord(coord)
    elif geom.get('type') == 'MultiPolygon':
        for poly in geom.get('coordinates', []):
            for ring in poly:
                for coord in ring:
                    add_coord(coord)
    return (min_x, min_y, max_x, max_y)


def point_in_ring(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersect = ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi)
        if intersect:
            inside = not inside
        j = i
    return inside


def is_land_point(lat, lon):
    features = load_land_features()
    if not features:
        return False
    for feat in features:
        bbox = feat['bbox']
        if lon < bbox[0] or lon > bbox[2] or lat < bbox[1] or lat > bbox[3]:
            continue
        geom = feat['geometry']
        if geom.get('type') == 'Polygon':
            if geom.get('coordinates') and point_in_ring(lon, lat, geom['coordinates'][0]):
                return True
        elif geom.get('type') == 'MultiPolygon':
            for poly in geom.get('coordinates', []):
                if poly and point_in_ring(lon, lat, poly[0]):
                    return True
    return False


def find_nearest_sea_point(lat, lon, max_radius_deg=1.5, step_deg=0.02):
    if not is_land_point(lat, lon):
        return lat, lon

    max_radius_deg = max(0.05, float(max_radius_deg))
    step_deg = max(0.005, float(step_deg))
    offsets = []
    radius = step_deg
    while radius <= max_radius_deg + 1e-9:
        for angle_idx in range(16):
            angle = (2 * math.pi * angle_idx) / 16.0
            dlat = radius * math.sin(angle)
            dlon = radius * math.cos(angle) / max(0.2, math.cos(math.radians(lat)))
            offsets.append((lat + dlat, lon + dlon))
        radius += step_deg

    for cand_lat, cand_lon in offsets:
        if not is_land_point(cand_lat, cand_lon):
            return cand_lat, cand_lon

    return lat, lon

def cmems_subset(out_nc, dataset_id, vars, lon, lat, start_utc, end_utc, radius_km, force=False):
    os.makedirs(os.path.dirname(out_nc), exist_ok=True)
    
    # キャッシュチェック
    if os.path.exists(out_nc) and not force:
        try:
            tmin, tmax = nc_time_bounds(out_nc)
            bounds = nc_spatial_bounds(out_nc)
            s_naive = start_utc.replace(tzinfo=None)
            e_naive = end_utc.replace(tzinfo=None)
            if tmin <= s_naive and tmax >= e_naive and bounds is not None:
                lon_min, lon_max, lat_min, lat_max = bounds
                if (lon_min - 1.0) <= lon <= (lon_max + 1.0) and (lat_min - 1.0) <= lat <= (lat_max + 1.0):
                    print(f"[CMEMS] Using cache: {out_nc}")
                    return out_nc
                print(f"[CMEMS] Cache spatial bounds do not match request, refreshing: {out_nc}")
        except Exception:
            pass 

    dlon, dlat = deg_buffer_from_km(lat, radius_km)
    
    copernicus_cli = shutil.which("copernicusmarine")
    if copernicus_cli is None:
        venv_candidate = os.path.join(os.path.dirname(sys.executable), "copernicusmarine.exe")
        if os.path.exists(venv_candidate):
            copernicus_cli = venv_candidate

    if copernicus_cli is None:
        raise RuntimeError(
            "Copernicus Marine CLI not found. Activate .venv311 and run: copernicusmarine login"
        )

    cmd = [
        copernicus_cli, "subset",
        "--dataset-id", dataset_id,
        "--start-datetime", start_utc.strftime('%Y-%m-%dT%H:%M:%S'),
        "--end-datetime", end_utc.strftime('%Y-%m-%dT%H:%M:%S'),
        "--minimum-longitude", f"{lon - dlon:.4f}", "--maximum-longitude", f"{lon + dlon:.4f}",
        "--minimum-latitude", f"{lat - dlat:.4f}", "--maximum-latitude", f"{lat + dlat:.4f}",
        "--output-directory", os.path.dirname(out_nc),
        "--output-filename", os.path.basename(out_nc),
        "--force-download"
    ]
    for v in vars:
        cmd += ["--variable", v]
    
    print(f"[CMEMS] Downloading {dataset_id}...")
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return out_nc
    except FileNotFoundError:
        raise RuntimeError(
            "Copernicus Marine CLI executable was not found. Activate .venv311 and run: copernicusmarine login"
        )
    except subprocess.CalledProcessError as e:
        # エラー詳細を取得
        err_msg = e.stderr.decode().strip()
        # "Coordinates out of dataset bounds" エラーは、未来の日付を指定した時によく出る
        if "dataset bounds" in err_msg or "time dimension" in err_msg:
             print(f"[WARN] Data not available for this period (likely future date for observation dataset).")
             print(f"       Dataset: {dataset_id}")
             return None
        
        print(f"[ERROR] Copernicus download failed: {err_msg}")
        raise RuntimeError("Failed to download marine data.")

# =============================================================================
# 3. 統合可視化パート
# =============================================================================

def export_combined_map(balloon_df, drift_nc, png_path):
    try:
        import cartopy.crs as ccrs
        import cartopy.feature as cfeature
    except ImportError as exc:
        raise RuntimeError(
            "cartopy is required for --pretty-png output. Install cartopy or run without --pretty-png."
        ) from exc

    print(f"[Map] Generating combined map: {png_path}")
    
    ds = xr.open_dataset(drift_nc)
    drift_lons = ds["lon"].values
    drift_lats = ds["lat"].values
    
    valid_drift_lon = drift_lons[~np.isnan(drift_lons)]
    valid_drift_lat = drift_lats[~np.isnan(drift_lats)]
    
    if len(valid_drift_lon) == 0:
        print("[WARN] No valid drift particles found. Map might be empty.")
        valid_drift_lon = balloon_df['lon'].values
        valid_drift_lat = balloon_df['lat'].values

    all_lons = np.concatenate([balloon_df['lon'].values, valid_drift_lon])
    all_lats = np.concatenate([balloon_df['lat'].values, valid_drift_lat])
    
    pad = 0.2
    extent = [
        np.min(all_lons) - pad, np.max(all_lons) + pad,
        np.min(all_lats) - pad, np.max(all_lats) + pad
    ]

    fig = plt.figure(figsize=(10, 10))
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent(extent, crs=ccrs.PlateCarree())

    ax.add_feature(cfeature.LAND, facecolor='#f0f0f0')
    ax.add_feature(cfeature.OCEAN, facecolor='#e0f7fa')
    ax.add_feature(cfeature.COASTLINE, linewidth=0.8)
    gl = ax.gridlines(draw_labels=True, linestyle='--', alpha=0.5)
    gl.top_labels = False
    gl.right_labels = False

    # 気球 (赤)
    ax.plot(balloon_df['lon'], balloon_df['lat'], 'r-', linewidth=2, label='Balloon Flight', transform=ccrs.PlateCarree())
    ax.plot(balloon_df.iloc[0]['lon'], balloon_df.iloc[0]['lat'], 'r^', markersize=8, markeredgecolor='black', transform=ccrs.PlateCarree())

    # 漂流 (青)
    step = max(1, drift_lons.shape[1] // 50) 
    for i in range(0, drift_lons.shape[1], step):
        ax.plot(drift_lons[:, i], drift_lats[:, i], 'b-', linewidth=0.5, alpha=0.15, transform=ccrs.PlateCarree())
    
    mean_lon = np.nanmean(drift_lons, axis=1)
    mean_lat = np.nanmean(drift_lats, axis=1)
    ax.plot(mean_lon, mean_lat, color='navy', linewidth=2, linestyle='--', label='Ocean Drift (Mean)', transform=ccrs.PlateCarree())

    ax.plot(mean_lon[0], mean_lat[0], 'kx', markersize=10, markeredgewidth=2, label='Splashdown', transform=ccrs.PlateCarree())

    plt.legend(loc='upper left', shadow=True)
    plt.title(f"Combined Trajectory\nLaunch: {balloon_df.iloc[0]['time'].strftime('%Y-%m-%d %H:%M')}", fontsize=12)
    plt.savefig(png_path, dpi=200, bbox_inches='tight')
    plt.close()


def build_fallback_drift_dataframe(splash_time, landing_point):
    return pd.DataFrame({
        'time': [splash_time],
        'lat': [landing_point['lat']],
        'lon': [landing_point['lon']],
        'alt': [0.0],
        'type': ['drift_mean']
    })


def build_integrated_drift_dataframe(curr_nc, splash_time, landing_point, hours, step_minutes=10, seed_lat=None, seed_lon=None):
    if not curr_nc or not os.path.exists(curr_nc):
        return build_fallback_drift_dataframe(splash_time, landing_point)

    try:
        ds = xr.open_dataset(curr_nc)
    except Exception:
        return build_fallback_drift_dataframe(splash_time, landing_point)

    lat_name = 'latitude' if 'latitude' in ds.coords else 'lat'
    lon_name = 'longitude' if 'longitude' in ds.coords else 'lon'
    time_name = 'time'
    depth_name = 'depth' if 'depth' in ds.coords else None
    u_name = 'uo' if 'uo' in ds else None
    v_name = 'vo' if 'vo' in ds else None

    if u_name is None or v_name is None:
        return build_fallback_drift_dataframe(splash_time, landing_point)

    lat = float(seed_lat if seed_lat is not None else landing_point['lat'])
    lon = float(seed_lon if seed_lon is not None else landing_point['lon'])
    current_time = pd.to_datetime(splash_time).to_pydatetime().replace(tzinfo=None)
    end_time = current_time + timedelta(hours=float(hours))
    step = timedelta(minutes=int(step_minutes))
    last_u = 0.0
    last_v = 0.0

    rows = []
    while current_time <= end_time:
        rows.append({'time': current_time, 'lat': lat, 'lon': lon, 'alt': 0.0, 'type': 'drift_mean'})

        try:
            current_slice = ds
            if depth_name is not None:
                current_slice = current_slice.sel({depth_name: current_slice[depth_name].values[0]}, method='nearest')
            current_slice = current_slice.sel({time_name: np.datetime64(current_time)}, method='nearest')
            lat_pad = 0.25
            lon_pad = 0.25
            u_box = current_slice[u_name].sel({lat_name: slice(lat - lat_pad, lat + lat_pad), lon_name: slice(lon - lon_pad, lon + lon_pad)})
            v_box = current_slice[v_name].sel({lat_name: slice(lat - lat_pad, lat + lat_pad), lon_name: slice(lon - lon_pad, lon + lon_pad)})
            if u_box.size > 0 and v_box.size > 0:
                u = float(u_box.mean(skipna=True).values)
                v = float(v_box.mean(skipna=True).values)
            else:
                u = float(current_slice[u_name].mean(skipna=True).values)
                v = float(current_slice[v_name].mean(skipna=True).values)
            if (not np.isfinite(u)) or (not np.isfinite(v)) or (abs(u) + abs(v) < 1e-6):
                try:
                    u = float(current_slice[u_name].mean(skipna=True).values)
                    v = float(current_slice[v_name].mean(skipna=True).values)
                except Exception:
                    pass
            if not np.isfinite(u):
                u = last_u
            if not np.isfinite(v):
                v = last_v
        except Exception:
            u = last_u
            v = last_v

        last_u = u
        last_v = v

        dt = step.total_seconds()
        lat += (v * dt) / 111320.0
        lon += (u * dt) / (111320.0 * max(0.1, math.cos(math.radians(lat))))
        lon = ((lon + 180.0) % 360.0) - 180.0
        current_time += step

    return pd.DataFrame(rows)

# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Balloon flight + Ocean drift simulator")
    
    parser.add_argument("--lat", type=float, required=True, help="Launch Latitude")
    parser.add_argument("--lon", type=float, required=True, help="Launch Longitude")
    parser.add_argument("--time", type=str, required=True, help="Launch Time (ISO format)")
    parser.add_argument("--ascent-rate", type=float, default=5.0, help="m/s")
    parser.add_argument("--burst-altitude", type=float, default=30000.0, help="meters")
    parser.add_argument("--descent-rate", type=float, default=10.0, help="m/s")
    parser.add_argument("--hours", type=int, default=6, help="Drift duration hours")
    parser.add_argument("--outdir", type=str, default="outputs")
    parser.add_argument("--pretty-png", action="store_true", help="Generate a combined map image")
    parser.add_argument("--no-drift", action="store_true", help="Skip ocean drift (OpenDrift) simulation")
    
    args = parser.parse_args()
    
    os.makedirs(args.outdir, exist_ok=True)
    os.makedirs("copernicus-data", exist_ok=True)

    # 1. Tawhiri (SondeHub) シミュレーション
    # ここで変数名を balloon_df として定義しています
    balloon_df, landing_point = run_tawhiri_simulation(
        args.lat, args.lon, args.time, 
        args.ascent_rate, args.burst_altitude, args.descent_rate
    )
    
    balloon_csv = os.path.join(args.outdir, "trajectory_balloon.csv")
    balloon_df.to_csv(balloon_csv, index=False)
    print(f"[Output] Balloon CSV: {balloon_csv}")

    # If requested, skip OpenDrift / ocean drift to save time
    if args.no_drift:
        print("[INFO] --no-drift flag set; skipping ocean drift and returning balloon-only output.")
        df_drift_mean = build_fallback_drift_dataframe(pd.to_datetime(landing_point['time']).replace(tzinfo=None), landing_point)
        balloon_df['type'] = 'balloon'
        cols = ['time', 'lat', 'lon', 'alt', 'type']
        df_combined = pd.concat([
            balloon_df.reindex(columns=cols),
            df_drift_mean.reindex(columns=cols)
        ])

        combined_csv = os.path.join(args.outdir, "trajectory_combined.csv")
        df_combined.to_csv(combined_csv, index=False)
        print(f"[Output] Combined CSV: {combined_csv}")
        print("[DONE] Balloon-only (no-drift) completed successfully.")
        return

    # 2. OpenDrift 準備
    try:
        splash_time = pd.to_datetime(landing_point['time']).replace(tzinfo=None)
    except:
        splash_time = pd.to_datetime(landing_point['time'])

    print(f"--- Transition to Ocean Drift ---")
    print(f"Splashdown Time (UTC): {splash_time}")
    
    t_start = splash_time - timedelta(hours=6)
    t_end = splash_time + timedelta(hours=args.hours + 6)
    
    # OpenDrift が使えない環境では、気球軌道のみ返す。
    if not OPENDRIFT_AVAILABLE:
        print(f"[WARN] OpenDrift dependencies are unavailable: {OPENDRIFT_IMPORT_ERROR}")
        print("[WARN] Skipping ocean drift simulation and returning balloon-only fallback output.")
        df_drift_mean = build_fallback_drift_dataframe(splash_time, landing_point)
        balloon_df['type'] = 'balloon'
        cols = ['time', 'lat', 'lon', 'alt', 'type']
        df_combined = pd.concat([
            balloon_df.reindex(columns=cols),
            df_drift_mean.reindex(columns=cols)
        ])

        combined_csv = os.path.join(args.outdir, "trajectory_combined.csv")
        df_combined.to_csv(combined_csv, index=False)
        print(f"[Output] Combined CSV: {combined_csv}")
        print("[DONE] Balloon-only fallback completed successfully.")
        return

    # CMEMS データ取得
    curr_nc = None
    wind_nc = None
    waves_nc = None

    print("[CMEMS] Fetching Marine Data...")
    
    # 海流 (Forecast -> OK)
    curr_nc = cmems_subset(os.path.join("copernicus-data", "curr.nc"), CURR_DATASET, CURR_VARS, 
                            landing_point['lon'], landing_point['lat'], t_start, t_end, 150)
    
    # 波 (Forecast -> OK)
    waves_nc = cmems_subset(os.path.join("copernicus-data", "wave.nc"), WAVES_DATASET, WAVES_VARS, 
                            landing_point['lon'], landing_point['lat'], t_start, t_end, 150)

    # 風 (Observation -> Future NG)
    wind_nc = cmems_subset(os.path.join("copernicus-data", "wind.nc"), WIND_DATASET, WIND_VARS, 
                            landing_point['lon'], landing_point['lat'], t_start, t_end, 150)

    if curr_nc is None:
        print("[ERROR] Currents data is critical but failed to download. Exiting.")
        sys.exit(1)

    # 3. OpenDrift 実行
    print("[OpenDrift] Running Simulation...")
    o = OceanDrift(loglevel=20)
    
    readers = []
    if curr_nc: readers.append(Reader(curr_nc))
    if waves_nc: readers.append(Reader(waves_nc))
    
    if wind_nc:
        print("[INFO] Adding Wind data...")
        readers.append(Reader(wind_nc))
    else:
        print("[WARN] Wind data missing (likely future date). Using fallback constant wind (0 m/s).")
        readers.append(reader_constant.Reader({'x_wind': 0, 'y_wind': 0}))

    o.add_reader(readers)
    
    o.set_config('drift:horizontal_diffusivity', 10.0)
    o.set_config('general:coastline_action', 'stranding')
    
    drift_seed_lat, drift_seed_lon = find_nearest_sea_point(float(landing_point['lat']), float(landing_point['lon']))
    if drift_seed_lat != float(landing_point['lat']) or drift_seed_lon != float(landing_point['lon']):
        print(f"[OpenDrift] Adjusted land splash point to sea seed: {drift_seed_lat:.5f}, {drift_seed_lon:.5f}")

    o.seed_elements(
        lon=drift_seed_lon,
        lat=drift_seed_lat,
        time=splash_time,
        number=200,
        radius=1000,
        wind_drift_factor=0.02
    )
    
    drift_nc = os.path.join(args.outdir, "trajectory_drift.nc")
    drift_ok = True
    try:
        o.run(duration=timedelta(hours=args.hours), time_step=600, time_step_output=600, outfile=drift_nc)
    except Exception as e:
        drift_ok = False
        print(f"[WARN] OpenDrift simulation failed: {e}")
        print("[WARN] Continuing with balloon-only output and splash-point fallback drift.")

    # 4. 統合出力
    if drift_ok and os.path.exists(drift_nc):
        ds = xr.open_dataset(drift_nc)
        mean_lon = ds["lon"].mean(dim="trajectory").values
        mean_lat = ds["lat"].mean(dim="trajectory").values
        times = ds["time"].values

        df_drift_mean = pd.DataFrame({
            'time': times,
            'lat': mean_lat,
            'lon': mean_lon,
            'alt': 0.0,
            'type': 'drift_mean'
        })

        try:
            unique_positions = df_drift_mean[['lat', 'lon']].drop_duplicates().shape[0]
        except Exception:
            unique_positions = 0
        if unique_positions <= 1:
            print('[WARN] OpenDrift output is stationary; using CMEMS current integration fallback.')
            df_drift_mean = build_integrated_drift_dataframe(curr_nc, splash_time, landing_point, args.hours, seed_lat=drift_seed_lat, seed_lon=drift_seed_lon)
    else:
        # Fallback: keep a single drift point at splashdown so frontend can still render.
        df_drift_mean = build_integrated_drift_dataframe(curr_nc, splash_time, landing_point, args.hours, seed_lat=drift_seed_lat, seed_lon=drift_seed_lon)
    
    # 【修正箇所】ここで df_balloon ではなく balloon_df を使う
    balloon_df['type'] = 'balloon'
    cols = ['time', 'lat', 'lon', 'alt', 'type']
    
    df_combined = pd.concat([
        balloon_df.reindex(columns=cols), # ここも修正
        df_drift_mean.reindex(columns=cols)
    ])
    
    combined_csv = os.path.join(args.outdir, "trajectory_combined.csv")
    df_combined.to_csv(combined_csv, index=False)
    print(f"[Output] Combined CSV: {combined_csv}")

    if args.pretty_png and drift_ok and os.path.exists(drift_nc):
        map_path = os.path.join(args.outdir, "trajectory_map.png")
        # ここも修正
        export_combined_map(balloon_df, drift_nc, map_path)
        print(f"[Output] Map Image: {map_path}")

    print("[DONE] All simulations completed successfully.")

if __name__ == "__main__":
    main()