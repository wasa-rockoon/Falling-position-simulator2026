import os
import sys
import subprocess
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()


def _parse_cors_origins() -> list[str]:
    """Read allowed CORS origins from env, fallback to permissive for local dev."""
    raw = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()
    if raw == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]

# --- パス設定 ---
# このファイル(server.py)があるディレクトリ(backend)から相対的に計算します
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
OUTPUT_DIR = os.path.join(BACKEND_DIR, "outputs")

# outputsフォルダが無ければ自動で作っておく
os.makedirs(OUTPUT_DIR, exist_ok=True)

# CORS設定 (念のため。今回は同一オリジンなのでなくても動くはずですがトラブル防止として)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# 1. APIエンドポイント (シミュレーション実行)
# =============================================================================
@app.get("/api/simulate")
def run_simulation(
    lat: float = Query(...),
    lon: float = Query(...),
    time: str = Query(...),
    ascent_rate: float = Query(5.0),
    burst_alt: float = Query(30000.0),
    descent_rate: float = Query(10.0),
    hours: int = Query(6),
    ocean_drift: bool = Query(True)
):
    print(f"シミュレーション開始リクエスト受信: lat={lat}, lon={lon}, time={time}")
    
    # balloon_and_drift.py を呼び出すコマンドを構築
    script_path = os.path.join(BACKEND_DIR, "balloon_and_drift.py")
    cmd = [
        sys.executable, script_path,
        "--lat", str(lat), 
        "--lon", str(lon), 
        "--time", time,
        "--ascent-rate", str(ascent_rate), 
        "--burst-altitude", str(burst_alt),
        "--descent-rate", str(descent_rate), 
        "--hours", str(hours),
        "--outdir", OUTPUT_DIR
    ]
    # If ocean drift is disabled from the frontend, pass a flag to skip OpenDrift
    if not ocean_drift:
        cmd.append("--no-drift")
    
    try:
        # シミュレーションの実行（同期処理なので、計算が終わるまで待機します）
        subprocess.run(cmd, check=True)
        
        csv_path = os.path.join(OUTPUT_DIR, "trajectory_combined.csv")
        if not os.path.exists(csv_path):
            raise HTTPException(status_code=500, detail="シミュレーションは完了しましたが、CSVファイルが生成されませんでした。")
            
        # 完成したCSVをフロントエンドに返す
        return FileResponse(csv_path, media_type="text/csv", filename="trajectory.csv")
        
    except subprocess.CalledProcessError as e:
        print(f"実行エラー: {e}")
        raise HTTPException(status_code=500, detail="シミュレーションの実行中にエラーが発生しました。バックエンドのログを確認してください。")

# =============================================================================
# 2. フロントエンドの静的ファイル配信
# ※APIのルーティングより「下」に書く必要があります
# =============================================================================

# js, css, imagesディレクトリをマウント（HTMLから相対パスで読み込めるようにする）
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/images", StaticFiles(directory=os.path.join(FRONTEND_DIR, "images")), name="images")

# sites.json など、フロントエンド直下にあるファイルを直接読みたい場合の対応
@app.get("/sites.json")
def read_sites():
    return FileResponse(os.path.join(FRONTEND_DIR, "sites.json"))

# ルートURL ("/") にアクセスが来た時に index.html を返す
@app.get("/")
def read_index():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if not os.path.exists(index_path):
        return {"error": "index.htmlが見つかりません。frontendフォルダの中にindex.htmlがあるか確認してください。"}
    return FileResponse(index_path)


@app.get("/health")
def health():
    return {"status": "ok"}