# Phase 1 検証記録（2026-09-06）

対象: `dev/kotaki`。Windows 11 / Node.js 24.13.1 / Docker Engine 29.7.2（desktop-linux）/ Compose 5.4.0。

| 項目 | 結果 |
| --- | --- |
| 公開イメージ仕様 | Project HorusのREADME・Dockerfile・ソースと実イメージのCLI helpを確認。GHCRのlatest digestと固定値の一致を確認 |
| Compose構文 | `docker compose ... config --quiet` 成功 |
| Tawhiri初回起動 | 空のnamed volumeで起動。HTTP 400 / RequestExceptionによってAPIハンドラ起動を確認 |
| データなし | GFS missing / 標高 missingを日本語で案内し、Nodeサーバの起動に成功 |
| localhost画面 | ブラウザでlocalhost:3100を開き、API選択がlocalであることを確認 |
| Local実予測 | 既存PredictionRunner → localhost:3100/api/v1/ → Tawhiriで成功。キャッシュなし、2 stages / 8 points |
| 停止・再起動 | 実際のstop-local.bat → start-local.batを実行。イメージpull・データ再取得なしで再予測成功 |
| オフライン計算 | `--network none` のTawhiriコンテナ内でFlask APIへ同じ入力を渡し、HTTP 200 / 2 stages。PC全体のネット切断試験ではない |
| 公開API | SondeHubへ実リクエスト1件、HTTP 200。使用dataset 2026-09-06T06:00:00Z |
| 最新GFS判定 | 公式S3 f192のHEAD照会により2026090606を選択 |
| 既存回帰テスト | 112件成功 |
| 追加ローカルテスト | 4件成功（プロキシ、停止認証・秘密ファイル非配信、ポート競合、最新run選択・接続先ポリシー） |
| ブラウザE2E | 16件成功。通常予測・愛媛・自動探索・不確実性・履歴・CSV・モバイル・PWAなど。予測応答は固定fixture |
| 構文・差分 | 既存のnpm run check成功、追加runtimeとcheckスクリプトのnode --check成功、git diff --check成功 |

Local実予測の入力: 緯度33.1333、経度132.5052、高度100 m、UTC 2025-09-12 01:00、上昇5 m/s、破裂1000 m、下降5 m/s。datasetは2025091200。再起動前後で同じ着地点・キャッシュ非使用を確認しました。

## 初回取得についての制限

新規の標高取得は公式ruaumoko-downloadで開始し、最初のZIPの取得と変換開始を確認しました。配信が低速だったため全量完了までの試験は行わず、この検証用コンテナを停止しました。

実予測にはユーザーの既存環境にあった完成済みの標高・GFS 2025091200を、新しいnamed volumeにコピーして使用しました。元ファイルは読み取り専用で扱い、変更していません。この検証用コピーでのみWSLを利用しました。通常の起動・取得スクリプトにWSLコマンドは含みません。

したがって、新規の標高＋最新GFSをゼロから全量取得する一連の実機試験、初回の全イメージpullは未完了です。Downloaderの実entrypoint・引数、最新run判定、Tawhiriによる完成データの読み込みは確認済みです。古い検証用GFSでは現在日時の予測はできません。現在の予測を行う前にdownload-weather.batで更新してください。

## 変更ファイル一覧

追加:

- `start-local.bat`
- `stop-local.bat`
- `download-weather.bat`
- `weather-status.bat`
- `local/docker-compose.yml`
- `local/.env.example`
- `local/scripts/local-runtime.js`
- `local/README.md`
- `local/VALIDATION.md`
- `tests/local-runtime.test.js`

変更:

- `.gitignore`
- `README.md`
- `cors-proxy.js`
- `js/pred/pred.js`
- `scripts/check-syntax.mjs`
- `sw.js`

既存の未追跡ファイルには変更を加えていません。検証終了後はstop-local.batでNodeサーバ・Tawhiriを停止済みです。検証用の標高とGFS 2025091200はnamed volumeに保持されています。

## Phase 2 実装・検証（2026-09-07）

### 追加・変更

- 管理サービス: local/service.js、local/http-api.js、local/scripts/weather_store.py、local/scripts/local-runtime.js、local/docker-compose.yml、cors-proxy.js。
- 画面: js/core/local-environment.js、css/local-environment.css、index.html。
- データ整合性: js/pred/pred-api-client.js、js/pred/request-context.js、js/core/run-repository.js、js/domain/run-record.js、js/core/results-workspace.js。
- PWA・検証: scripts/build-service-worker.mjs、scripts/check-syntax.mjs、sw.js、playwright.config.js、tests/local-cache.test.js、tests/local-service.test.js、tests/local-runtime.test.js、e2e/local-environment.spec.js、local/scripts/weather_store_test.py。
- 手順: README.md、local/README.md、本書。models.pyは変更していません。

### 確認済み

- 単体テスト129件成功。データ期間、更新後キャッシュ、履歴の並行保存、予測中の変更拒否、トークン・Origin検査、取得キャンセル、復旧ロックを含みます。
- ブラウザE2E20件成功。既存予測・愛媛・自動探索・不確実性・履歴・CSV・PWA・モバイル、および管理画面の確認付き削除、再読込後のジョブ表示、キャンセル・再試行、公開相当環境での管理パネル非表示を含みます。これらの予測APIは固定レスポンスです。
- Docker内Pythonテスト4件成功。一時ディレクトリで削除範囲・fingerprint・symlink拒否・標高保持を確認。
- 実Dockerで専用の小さい不完全run 1900010100を作成し、HTTP削除成功。既存GFS 2025091200と標高のfingerprintは変化なし。
- 取得済みrunの取得ジョブはcompleted。最新run 2026090700は実Downloaderの起動・volumeへの書き込み・キャンセル成功。再試行でも書き込みを確認。
- 取得中にランチャーstopを実行し、専用取得コンテナとNode・Tawhiriを停止。volumeを保持。
- 前回の実ブラウザ検証で、2025091200の期間内の単一予測成功と、使用GFS・エンジンdigest・revisionの履歴保存を確認。

### 検証の限界

最新GFSの全量取得は意図的にキャンセルしており、ゼロからの標高＋GFS全量取得完了は未検証です。初回全イメージpull、実際のインターネット切断試験も今回再実施していません。SondeHub実通信についてはPhase 1の記録を参照してください。地域限定・気温形式・models.pyマウント・自動保持数制限・予測日時に応じた不足runの自動取得は未実装です。

最終確認: 再起動後に一時ファイル download-2026090700 を管理APIで削除し、既存run・標高のfingerprint保持を確認。localhost:3100/api/v1/でGFS 2025091200を使用した実予測がHTTP 200（上昇・下降の2段階）となり、revisionヘッダーも確認しました。最終の容量表示変更後、管理画面E2E4件を再実行して成功。現在はローカルサーバとTawhiriが起動中です。
