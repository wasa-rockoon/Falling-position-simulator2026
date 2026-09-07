# Windows ローカルTawhiri（Phase 2）

GitHub Pagesは従来どおりSondeHubを使用します。この環境は既存Simulatorをローカルで配信し、公開APIを使わず予測するためのものです。Electron/Tauri化はまだ行っていません。

## 初回のみ

1. Windows 11でWSL2を有効化します。
2. Docker Desktopをインストールし、WSL2 backendとLinux containersを有効にして起動します。
3. Node.js 20以上をインストールします。
4. このリポジトリの `dev/kotaki` をcloneします。
5. `start-local.bat` をダブルクリックします。初回は公開Docker imageを取得します。
6. ローカル環境パネルの「最新気象データを取得」を押します（`download-weather.bat` でも開始できます）。標高データと最新の取得可能なGFSを取得します。

WSLターミナル操作、Tawhiriのclone/build、npm installは通常利用には不要です。初回のイメージ・データ取得にはインターネットが必要です。GFSは1 run約9.5 GBの展開済みデータ、標高は約7.5 GBです。一時ファイルや追加runも必要なので、Dockerのディスクに少なくとも50 GB程度の空きを用意し、実際の使用量に応じて増やしてください。ダウンロードは長時間かかる場合があります。

## 通常利用

- 起動: `start-local.bat`。Docker確認 → 不足イメージのみpull → Tawhiri起動 → HTTP応答確認 → データ確認 → Node起動 → 既定ブラウザを開きます。
- 停止: `stop-local.bat`。このランチャーが起動したNodeサーバとComposeを停止します。volumeは削除しません。
- データ更新: `download-weather.bat`。Simulator起動後に利用します。画面から取得・キャンセル・再試行もできます。予測とデータ操作の同時実行はサーバが拒否します。
- データ確認: `weather-status.bat`。Tawhiri起動後に使います。

起動バッチは `http://localhost:3100/?api_source=local` を開きます。通常の `http://localhost:3100` もLocalを初期選択します。URLや保存済み設定で明示された接続先は既存の復元処理に従います。画面でSondeHubやCustomを選ぶこともできます。

データなしでもSimulatorは開きますが予測はできません。画面にGFSと標高の取得状況を表示します。`ready` はファイル構造が使用可能という意味で、入力日時をカバーする保証ではありません。予測前にサーバが対象日時を確認し、利用可能なrunを選択します。放球時刻だけ指定した場合、飛行全体の期間を保証するものではありません。

取得済みイメージは通常起動時にpullしません。データの対象時刻内なら、オフラインでローカル予測APIを利用する構成です。地図タイル・外部気象サービスは別途ネット接続が必要です。

## 構成と保存場所

```text
Windows browser: localhost:3100
  → 既存 cors-proxy.js: /api/v1/
  → 127.0.0.1:8000（Tawhiri container）
      /srv/tawhiri-datasets ← wasa-tawhiri-data（共通named volumeのGFSディレクトリ）
      /srv/ruaumoko-dataset ← wasa-tawhiri-data（同じvolumeの標高ファイル）
Downloader container → wasa-tawhiri-data
Elevation取得container → wasa-tawhiri-data
```

volumeはDocker DesktopのLinux仮想ディスク内に置かれ、GitやWindowsのリポジトリ内には保存されません。Docker DesktopのVolumes画面で確認できます。通常のstopでは保持します。Docker Desktopのデータ初期化やvolume削除はデータを失います。

公式推奨どおり単一volumeを `/srv` に共有し、その内部の `/srv/tawhiri-datasets` にGFSを保存します。Tawhiriのマウントは読み取り専用、データ取得・整理コンテナが書き込み可能です。標高は `.partial` に取得し、成功・サイズ検証後に正式ファイルへ置換します。3100/8000はPC内部のloopbackだけに公開します。日時処理の一貫性のためコンテナはUTC、Simulatorの入力・表示は従来のJSTです。

## エラーと診断

- Docker未導入: Docker Desktopをインストールし、WSL2 backendを有効にしてください。
- Docker Engine未起動: Docker Desktopを起動し、Engineの準備完了後に再実行してください。バッチはDesktopの設定変更やWSL操作を行いません。
- 3100使用中: `stop-local.bat`、または該当アプリを終了してください。ランチャーは別ポートに移動しません。
- 8000使用中／Tawhiri起動失敗: Docker DesktopのContainers画面で競合やログを確認してください。
- データ未取得・不完全: `download-weather.bat` を再実行してください。取得プロセスの終了コードとファイル構造を検証します。
- ダウンロード失敗: 接続とDockerディスク空き容量を確認し、再実行してください。取得済みデータは自動削除しません。
- 異常終了後: start-local.batで再起動すると保存済みジョブの専用コンテナを停止して復旧します。復旧待ちの場合は画面の復旧ボタンを使用してください。ロックファイルを取得中に手動削除しないでください。

取得状態とログ末尾は local/.runtime/weather-job.json に保存します。ブラウザを閉じてもNodeサーバが動いていれば取得は継続し、再表示できます。stop-local.batは取得をキャンセルしてから停止します。再試行は同じrunの取得を再実行します（バイト単位の再開は保証しません）。launcher.log・server.logにも診断情報を残します。これらはGit管理しません。

## ローカル環境パネル

- Tawhiri、標高、GFSの状態と使用量・空き容量を表示します。
- 取得ジョブの段階・経過時間・ログを確認し、キャンセル・再試行できます。
- runごとに対象期間と容量を表示します。削除対象と容量を確認して確定すると、そのrunのみ削除します。標高と他のrunは保持します。
- 中断された取得の一時ファイルも個別に整理できます。自動削除や保持数制限は行いません。
- 削除中はTawhiriを停止し、使用中のファイルを解放してから削除・再起動します。履歴そのものは削除しません。履歴に使用run・エンジン・データrevisionを保存し、データ削除後は再取得が必要な旨を表示します。
- ローカルキャッシュはデータrevision別に扱います。データ不足時に古いキャッシュだけで成功扱いにはしません。

Docker内で削除して空き容量が増えても、Windows側のDocker仮想ディスクファイルは直ちに縮小しない場合があります。表示する空き容量はDocker内の値です。

## 開発者向け

`local/scripts/local-runtime.js` がDocker操作とデータ確認を集約します。`check / start / stop / status / download` を受け付けます。特定runは `node local/scripts/local-runtime.js download YYYYMMDDHH`（UTC）。サービス層は local/service.js、HTTP境界は local/http-api.js、volume内の検査・削除は local/scripts/weather_store.py です。利用可能データからのrun選択を行いますが、予測日時に応じた不足データの自動取得は未実装です。停止専用 `/local/shutdown` はランチャー発行トークンが必須です。

任意で `.env.example` を `.env` にコピーしてイメージとworker数を設定できます。クライアント側のlocal並列数2／間隔100 msは変更していません。既定イメージは今回取得して起動・CLI検証したdigestに固定しています。更新は開発者が新digestを検証してComposeまたは.envを変更してください。公開イメージは古いため、現行Docker Desktopでの実機互換性検証が必要です。ソースbuildは行いません。

### 確認した公式仕様（2026-09-06）

- [Project Horus tawhiri-container](https://github.com/projecthorus/tawhiri-container): `ghcr.io/projecthorus/tawhiri-container:latest`、8000、`/srv/tawhiri-datasets`、`/srv/ruaumoko-dataset`、`ruaumoko-download -v`。このリポジトリはarchive済みです。
- [Tawhiri Dockerfile](https://github.com/projecthorus/tawhiri-container/blob/master/Dockerfile): tini entrypoint、gunicorn、Python3、ruaumoko-downloadを含む公開イメージ。
- [Downloader](https://github.com/projecthorus/tawhiri-downloader-container): `ghcr.io/projecthorus/tawhiri-downloader-container:latest`、`/root/tawhiri-downloader/default/main.exe`、`one -base-url aws-mirror YYYYMMDDHH`。
- [最新run選択](https://github.com/projecthorus/tawhiri-downloader-container/blob/main/scripts/download.py): S3のf192存在確認。公式wrapperは `os.system` の終了コードを返さないため、本実装は同じ条件でrunを選び、Downloader本体を直接実行して終了コードを検証します。
- [Tawhiri Dataset](https://github.com/projecthorus/tawhiri/blob/master/tawhiri/dataset.py): 読み込み・サイズ検証。実際にはイメージ内のDatasetクラスを使います。
- [Ruaumoko形式](https://github.com/cuspaceflight/ruaumoko#dataset-format): 標高ファイルサイズの構造検証。

## 検証

`npm test` と `npm run check` に加え、実Dockerで以下を確認してください。

1. 空volumeでstartし、データ不足表示とlocalhost:3100を確認。
2. download-weatherで取得し、Local選択で1件予測。
3. stop → start後にデータが保持され、再取得なしで予測できること。
4. ネット切断後、取得runの対象日時で予測できること。
5. GitHub Pages相当でSondeHub選択による1件予測。

実コンテナでの検証結果は作業報告に記載します。ユニットテストのモック成功は実際のTawhiri予測成功を意味しません。



## 容量削減について

この公開イメージのTawhiriは全球の固定グリッドを読み、所定のファイルサイズを検証します。そのため、Downloaderだけを地域限定・短い予報期間に変えても互換性を保てません。Phase 2でも全球形式を維持します。地域限定にはDownloaderと予測側のグリッド・範囲外判定の変更が必要です。今回追加したrun単位の削除で容量を管理できます。現在は過去runを自動削除しません。圧縮保管も計算時には展開が必要です。

今回の実機結果と未検証範囲は [検証記録](VALIDATION.md) を参照してください。

## 管理API

start-local.batの管理モードでのみ有効です。GitHub Pagesには管理サーバはありません。Host/Originを検証し、変更操作には同一画面から取得するセッショントークンとJSONを要求します。

| Method | Path | 内容 |
| --- | --- | --- |
| GET | /local/status | 環境・ジョブ状態 |
| GET | /local/weather/status | データ一覧・容量を含む状態 |
| GET | /local/weather/resolve | launch_datetime等から利用可能runを選択 |
| POST | /local/weather/download | 最新または指定runの取得を開始 |
| POST | /local/weather/cancel | 取得をキャンセル |
| POST | /local/weather/recover | 失敗した後処理を再実行 |
| DELETE | /local/weather/dataset | runとfingerprintで対象を再確認して削除 |
| DELETE | /local/weather/temporary | 一時ファイルを個別削除 |

models.py差し替え、気温を含む独自データ形式、地域限定GFS、Electron/Tauri配布は今回の対象外です。
