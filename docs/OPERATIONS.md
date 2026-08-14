# 開発・運用手順

## 必要環境

- Node.js 20以上
- Windows PowerShell（アイコン再生成時のみ）
- ローカルTawhiriを使う場合は別途Tawhiriサーバー

npmの実行時依存はありません。Acornと `node_modules/` は不要で、構文検査はNode標準の `--check` を使います。

## 起動

```powershell
node cors-proxy.js
```

既定の画面は `http://localhost:3100/` です。ローカルAPIを選ぶ場合、プロキシは `localhost:8000` のTawhiriへ接続します。

```powershell
$env:TAWHIRI_HOST = 'localhost'
$env:TAWHIRI_PORT = '8000'
$env:PORT = '3100'
node cors-proxy.js
```

ローカルTawhiriがない場合は画面でSondeHubを選択してください。`/__server-info` で静的配信元と接続先を確認できます。

## 生成と検証

```powershell
npm run build
npm run check
npm test
```

`npm run build` は次を再生成します。

1. KMLから `ports.json`
2. PWA 192/512pxアイコン
3. 欠落しやすいjQuery UI画像スプライト
4. HTMLの実読込資産を列挙した `sw.js`

これらの生成物はアプリの一部なのでコミット対象です。`node_modules/`、自動探索/不確実性解析のCSV、解析用の一時ファイルは `.gitignore` 対象です。

海陸判定の固定版データと出典・SHA-256は `data/land-sea-datasets.json` で管理します。内水面データを更新する場合だけ、国土数値情報W09-05の配布ZIPのSHA-256を照合し、展開した `W09-05-g.xml` から次を実行します。通常の `npm run build` ではネットワーク取得や再生成を行いません。

```powershell
node scripts/build-inland-water.mjs C:\path\to\W09-05-g.xml data\inland_water_japan_w09_05.geojson
```

生成後はマニフェストのファイルSHA-256、地物数、データ版を更新し、固定検証点のテストを通します。

## コミットの境界

- `git status --short` と `git diff --stat` で対象を確認する。
- 機能コード、対応するテスト、文書、必要な生成物を同じ変更単位に含める。
- 生成CSV、`node_modules/`、Office一時ファイル、調査用スクリプトやパッチを含めない。
- `ports.json` は直接修正せず、KMLを正本として `npm run build:data` で更新する。
- ユーザーが作成した未追跡ファイルは、用途が確認できない限り削除も一括追加もしない。

## リリース前

- `npm run build` 後に差分を確認する。
- `npm run check` と `npm test` を通す。
- `docs/MANUAL_CHECKLIST.md` を実ブラウザで確認する。
- API URLや秘密情報をリポジトリへ保存しない。
- Service Worker更新トーストの「今すぐ更新」で新バージョンへ切り替わることを確認する。

外部通信先はTawhiri/SondeHub、Open-Meteo、地図タイルです。海陸判定は固定版ローカルデータだけを使用し、BigDataCloud/Overpassへ通信しません。仕様変更、利用制限、障害時の挙動は機能ごとに確認し、取得や判定の失敗はunknownとして保持してください。

## 依存関係

ローカル同梱ライブラリのバージョンとSHA-256は `vendor-dependencies.json` に固定しています。未使用だったTurf、Leaflet Heat、jQuery Formのうち、前二つのCDN読込とjQuery Formの実行時読込は削除しました。

古いjQuery系・Leaflet系の一括更新は描画・Cookie・イベント挙動へ影響するため、機能改修と分離した専用ブランチで行い、このチェックリストを全て再実行してください。
