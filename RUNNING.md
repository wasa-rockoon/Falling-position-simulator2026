# 起動・操作メモ (RUNNING.md)

このファイルはローカルでプロジェクトを0から起動して動作確認するための手順メモです。

前提
- Windows (PowerShell)
- リポジトリルート: `C:\Users\msnb0\Documents\GitHub\Falling-position-simulator2026`
- 仮想環境は `.venv311` を使う想定（既に作成済み）

1) 仮想環境の有効化 (PowerShell)

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
& .\.venv311\Scripts\Activate.ps1
```

2) 必要パッケージのインストール（初回）

```powershell
python -m pip install --upgrade pip
python -m pip install fastapi "uvicorn[standard]" requests pandas numpy xarray netCDF4 opendrift copernicus-marine-client matplotlib cmocean cartopy
```

- 注: `opendrift` や `cartopy`、`copernicus-marine-client` は大きくプラットフォーム依存のビルドが必要で、環境によっては追加のシステムライブラリが必要です。
- Copernicus データを自動で取得するには `copernicusmarine` CLI のログインが必要（下記参照）。

3) Copernicus CLI のログイン（海洋データを取得する場合）

```powershell
# 仮想環境を有効にした上で
.\.venv311\Scripts\copernicusmarine login
```

- 画面の指示に従って認証情報を作成してください。

4) サーバ起動 (FastAPI + Uvicorn)

```powershell
# プロジェクトルートで
python -m uvicorn backend.server:app --reload --host 127.0.0.1 --port 8000
```

- `--reload` は開発用途（コード変更時自動リロード）。本番では外してください。
- もし別プロセスで既に起動している場合は停止してから再起動してください（Ctrl+C または該当ターミナルを閉じる）。

5) 動作確認

- ヘルスチェック (PowerShell)：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health | Select-Object -ExpandProperty Content
```

- ブラウザで UI を開く: `http://127.0.0.1:8000/` を開いてください。

6) フロントの変更が反映されない（UIに見えない）場合のチェックリスト

- ブラウザのキャッシュをクリアして強制再読み込み（Windows: Ctrl+F5、Shift+F5、または開発者ツールを開いて右クリック→Empty Cache and Hard Reload）。
- サーバを再起動しているか確認（`uvicorn` を停止 → 再起動）。静的ファイルはサーバ起動時に読み込まれるため再起動で最新ファイルを配信します。
- ブラウザのデベロッパーツールで該当要素を確認: `document.getElementById('enable_drift')` をコンソールで実行。
- 手元でファイルが本当に変更されているか確認: `git status` またはファイルをエディタで開く。

7) UI上の「Enable Ocean Drift」が効いているかを素早く確認する方法

- ブラウザで UI を開き、Developer Console を開いて次を実行:

```javascript
// チェック状態を確認
document.getElementById('enable_drift').checked
```

- API の動作をコマンドラインで検証する（サーバが起動している前提）:

```powershell
# ocean_drift=true(デフォルト)
curl "http://127.0.0.1:8000/api/simulate?lat=-34.0297&lon=138.6917&time=2026-05-19T12:00:00Z&ascent_rate=5&burst_alt=30000&descent_rate=10&hours=6&ocean_drift=true"

# ocean_drift=false（高速: OpenDrift をスキップ）
curl "http://127.0.0.1:8000/api/simulate?lat=-34.0297&lon=138.6917&time=2026-05-19T12:00:00Z&ascent_rate=5&burst_alt=30000&descent_rate=10&hours=6&ocean_drift=false"
```

- サーバログに `--no-drift` を渡した時は `"[INFO] --no-drift flag set; skipping ocean drift"` のようなログが出ます。

8) 出力先

- 結果の CSV と画像は `backend/outputs/` に保存されます（例: `trajectory_combined.csv`, `trajectory_balloon.csv`, `trajectory_drift.nc`, `trajectory_map.png`）。

---

トラブルが続く場合は、次の情報を教えてください:
- ブラウザで `document.getElementById('enable_drift')` を実行した結果
- `uvicorn` を起動したターミナルのログ（直近の数十行）


