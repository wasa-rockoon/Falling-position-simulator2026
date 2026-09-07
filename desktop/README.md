# Windowsデスクトップ版

既存SimulatorをElectronで表示します。GitHub Pages版とstart-local.bat版も維持します。

## 利用者

1. Windows 11でWSL2を有効にし、Docker DesktopのWSL2 backend / Linux containersを使用してください。
2. GitHub ReleasesからWasaSimulatorSetup.exeを取得してインストールするか、ZIPを展開します。
3. Docker Desktopを起動し、WASA Falling Position Simulatorを開きます。
4. データ不足の場合は画面のローカル環境パネルから取得します。

配布版はNode.jsとSimulatorを同梱するため、Node.jsの別途インストール、clone、WSLターミナル操作は不要です。Docker・GFS・標高は同梱しません。初回の取得にはネット接続が必要です。

終了時はアプリが起動したNodeサーバとTawhiriを停止します。取得中は確認してキャンセルします。GFSは削除しません。バッチ版と同時に起動すると3100番ポートの競合を案内します。先に使っていた版を終了してください。

## 保存場所

- GFS・標高: Docker named volume wasa-tawhiri-data。バッチ版と共用します。
- 設定・履歴: Windowsのアプリデータ内にあるElectron専用の永続領域。ブラウザのIndexedDBとは別で、既存ブラウザ履歴の自動移行はしません。
- 診断ログ: %APPDATA%/WASA Falling Position Simulator/runtime/ のdesktop.log、server.log、operations.log。
- CSV/KML: 保存ダイアログで指定した場所。

アプリ更新時はWeb画面のキャッシュだけを消し、IndexedDBと設定を保持します。GFS削除はローカル環境パネルで明示的に実行してください。

## 開発・ビルド

Node.js 22以上とnpmを推奨します。

- npm ci
- npm run desktop:start — 開発起動
- npm run desktop:package — Windows x64アプリフォルダを生成
- npm run desktop:make — インストーラーとZIPをout/makeに生成

ビルド前に共通Web資産を生成し、desktop/prepare.mjsが配布用Simulatorをdesktop/.stagingへコピーします。ComposeとDockerから読むPythonはapp.asarの外にあるresources/simulatorに置きます。GFS、.env、ログ、Git、テスト資料は同梱しません。

main.jsが既存ランチャーのrunActionを呼び、utilityProcessでNodeサーバを動かします。画面のnodeIntegrationは無効、contextIsolationとsandboxは有効です。外部ページへの画面遷移を禁止し、HTTPSの外部リンクは既定ブラウザで開きます。

## GitHub Releases

desktop-release.ymlはworkflow_dispatchでのみ実行します。package.jsonのversionを上げ、対象コミットでWindowsビルド後、desktop-vVERSIONのドラフトReleaseを作ります。通常pushでは実行しません。同じタグが存在すると失敗するので、内容を確認してから新しいversionを使用してください。

生成物を確認してからドラフトを公開します。Pagesの公開元masterとは独立しています。Releaseワークフローは今回追加した設定であり、GitHub上での実行・公開は別途必要です。

初版は署名なしです。Windowsで発行元の警告が出る場合があります。一般配布前のコード署名、インストール・アンインストール・上書き更新の別PC検証、自動更新は今後の課題です。

## 検証状況

パッケージしたWindowsアプリから起動し、既存GFSと標高を認識することを確認済みです。初回の空volume検証は他メンバーの確認待ちです。最新GFS全量取得・オフライン予測はバッチ版でユーザー確認済みです。

依存関係: 配布時のnpm依存はaudit指摘0件。Forgeの開発・ビルド用の間接依存には指摘が残っています。互換範囲のaudit fixを実施しましたが、破壊的なダウングレードは適用していません。署名・公開前に開発ツール更新を継続確認してください。

実機テスト（Dockerに利用可能なデータが必要）: `node desktop/smoke.cjs`。実予測、CSV/KML保存、履歴保持、再起動、サーバ停止を確認します。競合テストは `node desktop/conflict-smoke.cjs`。これらは通常のCIでは自動実行しません。実予測テストはテスト用の予測履歴を追加します。

公開Tawhiriイメージがformat=csv/kmlでもJSONを返すため、ローカルプロキシで既存ExportServiceを使い添付ファイルに変換します。SondeHubプロキシとPagesの接続処理には適用しません。
