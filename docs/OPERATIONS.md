# 開発・運用手順

## 必要環境

- Node.js 20以上
- npm
- Windows PowerShell（PWAアイコン・jQuery UI画像を再生成する場合のみ）
- ローカルAPIを使う場合はTawhiriサーバー

## 公開版と現地PCの使い分け

| 環境 | 目的 | 利用するAPI | Localhost API |
|---|---|---|---|
| GitHub Pages | メンバー共有、通常予測、結果・履歴の確認 | SondeHub（標準）またはHTTPS/CORS対応Custom API | 使用不可 |
| 現地PCのローカル起動 | 実験当日の主系、大量探索、不確実性解析 | ローカルTawhiriを推奨、SondeHubは予備 | 使用可能 |

Localhost (Docker)とcors-proxy.jsは**開発・現地PC専用**です。GitHub PagesはNode.jsを実行できないため、公開URLでLocalhost APIを選択してもローカルTawhiriへは接続できません。


## セットアップと起動

```powershell
npm install
node cors-proxy.js
```

既定URLは `http://localhost:3100/`、サーバー情報は `http://localhost:3100/__server-info` です。Localhost APIは既定で `localhost:8000` へ転送します。

```powershell
$env:TAWHIRI_HOST = 'localhost'
$env:TAWHIRI_PORT = '8000'
$env:PORT = '3100'
node cors-proxy.js
```

3100番が使用中の場合、開発サーバーは最大20ポート先まで順番に試します。起動ログに表示されたURLを使ってください。

## ビルド

```powershell
npm run build
```

クロスプラットフォームの通常ビルドは次を実行します。

1. 正本KMLから `ports.json` を再生成
2. HTMLとローカル資産から `sw.js` を再生成
3. 実行対象JavaScriptの構文検査

画像生成は必要な場合だけWindowsで実行します。

```powershell
npm run build:icons:windows
npm run build:ui-assets:windows
```

`ports.json` と `sw.js` は生成物ですがアプリの一部なのでコミットします。直接編集せず生成元を変更してください。

## テスト

```powershell
npm test
```

Nodeテストは外部通信せず、計算、海陸固定点、保存、APIキュー、再試行予算、履歴、PWA、依存ハッシュ、HTML品質を確認します。

初回だけPlaywright用Chromiumを導入します。

```powershell
npx playwright install chromium
npm run test:e2e
```

E2Eは `http://localhost:4173` で専用サーバーを起動し、Tawhiri/Open-Meteoをテスト内で固定応答へ差し替えます。公開API、実ローカルTawhiri、外部地図タイルへは到達しません。

すべてまとめて実行する場合:

```powershell
npm run ci
```

## CI

**CI（Continuous Integration）**は、コード変更のたびにGitHubが自動で行う品質検査です。公開やデプロイを行うものではありません。ローカルPCではたまたま動いても、別OSやまっさらな環境で壊れる問題を早期に見つけます。

**E2E（End-to-End）**は、Chromiumで実際の画面操作を行う自動試験です。ボタン、ダイアログ、地図、履歴、PWAまでを一連の利用者操作として確認します。実APIの代わりに固定応答を使うため、実API・実気象・実回収判断は手動確認チェックリストで別途確認します。

.github/workflows/ci.yml は対象ブランチへのpushとpull requestで以下を実行します。

1. `npm ci`
2. `npm run build`
3. `ports.json` と `sw.js` に未コミット生成差分がないことを確認
4. `npm test`
5. Chromium導入
6. `npm run test:e2e`
7. Playwrightレポートを14日保存

CIでは安定性のためPlaywright workerを1にします。

## データ更新

### 支援・回収地点

`漁船・回収地点位置関係マップ.kml` が正本です。

```powershell
npm run build:data
```

支援地点と実回収地点は用途を分け、探索の最寄り支援距離には支援地点だけを使います。

### 海陸データ

`data/land-sea-datasets.json` にデータ版、出典、ライセンス、SHA-256、既知制約を記録します。通常ビルドではネットワーク取得しません。湖沼データを更新するときだけ、配布ZIPを照合して次を実行します。

```powershell
node scripts/build-inland-water.mjs C:\path\to\W09-05-g.xml data\inland_water_japan_w09_05.geojson
```

更新後は固定検証点、境界、穴、MultiPolygon、データハッシュのテストを通してください。

## 保存データと移行

- localStorage: 前回設定、プリセット、テーマ、旧愛媛履歴
- Cookie: 旧保存地点
- IndexedDB: RunRecord、ジョブ、APIキャッシュ

ストレージスキーマは互換読込を先に実装し、旧キーや旧履歴を削除しません。履歴の「表示クリア」は地図表示だけを消し、保存履歴を削除しません。

## ログと秘密情報

リポジトリ、URL、ログ、スクリーンショットへAPIキーやtokenを保存しないでください。アプリは診断メッセージ内の一般的な秘密クエリとBearer値をマスクし、1000文字へ制限しますが、入力段階で秘密値を共有しないことが第一です。

バグ報告には次だけを含めます。

- 再現手順
- 入力条件（秘密情報を除く）
- ブラウザとOS
- 画面の利用者向けエラー
- マスク済み診断ログ

## リリース手順

1. `git status --short` で意図しない未追跡物がないか確認
2. `npm ci`
3. `npm run build`
4. `git diff --exit-code -- ports.json sw.js` または生成差分をレビューしてコミット
5. `npm test`
6. `npm run test:e2e`
7. `docs/MANUAL_CHECKLIST.md` で実API・実端末確認
8. `vendor-dependencies.json` と `docs/DEPENDENCIES.md` を確認
9. 対象ブランチへpushしGitHub Actions成功を確認

`node_modules/`、Playwrightレポート、生成CSV、ログ、Office一時ファイル、調査資料はコミットしません。

## 公開前のPages確認

- Pages公開元が暫定dev/kotakiか正式masterかを記録する。
- 公開URLをHTTPSで開き、index.html、CSS、JavaScript、GeoJSON、画像に404がないことを確認する。
- 公開ページではSondeHub (Public)で通常予測を1件だけ実行する。
- 公開ページでLocalhost (Docker)を実運用に使わない。ローカルTawhiriが必要な探索・解析は現地PCでnode cors-proxy.jsから行う。
- Service Worker更新後は、更新通知または強制再読み込みで新しい版を確認する。
- Pagesの公開元をmasterへ切り替える直前に、master対象のCIが成功することを確認する。

## 障害切り分け

| 症状 | 確認 |
|---|---|
| 画面全体が開かない | 開発サーバーURL、同一オリジン資産404、Service Worker |
| Localhost予測だけ502 | Tawhiriのホスト・ポート、`/__server-info` |
| SondeHubだけ失敗 | 時刻範囲、公開API状態、429、ネットワーク |
| 大量処理が一部完了 | HTTP試行上限、再試行数、キャッシュ命中、再開ボタン |
| 海陸がunknown | データ読込、対象範囲、データ版、沿岸解像度 |
| 古い画面が残る | 更新通知、Service Worker waiting、キャッシュ版 |
