# Falling Position Simulator 2026

高高度気球の放球条件から飛行経路・着地点を予測し、放球時刻、回収、安全性を検討するためのブラウザアプリです。WASAの愛媛気球実験向け機能を含み、通常予測、13条件比較、放球自動探索、ガス計算、不確実性解析、実行履歴を一つの画面で扱います。

> このアプリは計画支援ツールです。予測には気象モデル、入力値、機体特性に由来する不確実性があります。実運用では最新の気象情報、関係法令、チームの安全基準を必ず併用してください。

## 主な機能

- 通常・落下のみ・時間別・愛媛13条件のTawhiri予測
- 地点×時刻の放球自動探索
  - 高速: 粗探索で不適候補を除外
  - 全候補精密: 粗探索結果にかかわらず13条件を評価
  - 段階的: 候補を除外せず、見込み順に評価
- 2025年版計算シートに基づくヘリウム量、純浮力、ボンベ、破裂高度計算
- モンテカルロ、Latin Hypercube、Sobolと正規・Weibull分布による不確実性解析
- 着地点、95%確率楕円、KDE密度等高線の地図重ね表示
- 通常・愛媛・自動探索・不確実性解析を共通化した実行履歴、再開、CSV/KML出力
- 高度・水平風速の最大5系列比較、診断ログ、レスポンシブUI、PWA

自動探索の海上率は「下限以上」で合格します。中断は進行中のAPI呼出または候補を完了した境界で止まり、次へ進みません。自動探索と不確実性解析は各処理境界で自動保存され、再読込後に再開できます。

## 起動

必要環境はNode.js 20以上です。

```powershell
npm install
node cors-proxy.js
```

`http://localhost:3100/` を開きます。`cors-proxy.js` は静的ファイルを配信し、画面でLocalhostを選んだ場合は既定で `localhost:8000` のTawhiriへ `/api/v1/` を転送します。

```powershell
$env:TAWHIRI_HOST = 'localhost'
$env:TAWHIRI_PORT = '8000'
$env:PORT = '3100'
node cors-proxy.js
```

ローカルTawhiriを起動していない場合は、画面のAPI接続先でSondeHubを選択してください。`http://localhost:3100/__server-info` で現在の静的配信元と転送先を確認できます。

## API負荷と大量実行

予測APIクライアントは同時数、最小間隔、タイムアウト、429/5xx/通信失敗の再試行、同一要求の統合、3時間キャッシュを共通管理します。自動探索と不確実性解析は、開始前に論理要求数、再試行を含む最悪HTTP試行数、概算時間を表示します。

SondeHub公開APIは同時1件で実行し、300 HTTP試行を超える設定では警告します。数千件規模はローカルTawhiriを推奨します。上限に達した場合は一部完了として自動保存し、上限を増やして再開できます。

## 状態とデータ

| データ | 保存先 | 補足 |
|---|---|---|
| 前回のフォーム値、プリセット、テーマ | localStorage | 既存キーとの互換性を維持 |
| 保存した放球地点 | Cookie | 旧機能との互換用 |
| RunRecord、履歴、再開スナップショット | IndexedDB | 全実行種別で共通 |
| API応答 | メモリ + IndexedDB | 3時間TTL、件数上限あり |
| 海陸判定 | 同梱GeoJSON | 実行時に外部判定APIへ通信しない |
| 支援・回収地点 | `ports.json` | KMLを正本として生成 |

海陸判定はNatural Earth陸域と国土数値情報W09-05湖沼の固定版を使い、`land`、`sea`、`inland_water`、`unknown`を決定論的に返します。内水面は海上率へ含めず、範囲外や読込失敗はunknownのまま扱います。データ版・出典・SHA-256は `data/land-sea-datasets.json` に記録しています。

## 外部通信

- SondeHub/Tawhiri: 飛行予測
- Open-Meteo: 自動探索の降水・地上風
- OpenStreetMap/OpenTopoMap/ArcGIS/Carto: 地図タイル

BigDataCloudとOverpassは実行時の海陸判定に使用しません。Service Workerも予測・気象API応答をキャッシュせず、APIキャッシュはアプリ側のTTLと上限で管理します。

## 開発と検証

初回だけChromiumを導入します。

```powershell
npx playwright install chromium
```

```powershell
npm run build       # ports.json、sw.js、構文検査
npm test            # Node単体・統合テスト
npm run test:e2e    # 固定APIによるChromium E2E
npm run ci          # 上記をまとめて実行
```

E2Eは公開APIへ到達せず、テスト内の固定レスポンスで次を確認します。

1. 通常予測
2. 愛媛13条件
3. 自動探索の開始・候補境界中断・再開
4. ガス計算結果のSETTINGS反映
5. 不確実性解析と密度等高線
6. 共通履歴の再表示とCSV出力
7. モバイル・キーボード操作
8. PWAのオフライン再起動

PWAアイコンとjQuery UI画像を再生成する場合だけWindows PowerShellが必要です。

```powershell
npm run build:icons:windows
npm run build:ui-assets:windows
```

GitHub Actionsはpushとpull requestでビルド、生成物差分、Nodeテスト、Chromium E2Eを検証します。

## ディレクトリ

```text
index.html                  画面骨格と読込順
cors-proxy.js               開発サーバーとローカルTawhiri転送
js/core/                    初期化、保存、通知、履歴、出力
js/domain/run-record.js     共通RunRecordスキーマ
js/pred/                    予測、API、探索、不確実性、描画、グラフ
js/calc/                    ガス・浮力・破裂高度計算
js/geo/                     決定論的な海陸分類
data/                       固定版地理データとマニフェスト
scripts/                    データ・Service Worker生成
 tests/                     Nodeテスト
 e2e/                       固定APIブラウザE2E
 docs/                      設計・運用・手動確認資料
```

通常予測の互換入口は `js/pred/pred-new.js` に残し、API実行は `prediction-runner.js`、描画は `prediction-renderer.js`、愛媛制御は `ehime-controller.js`、結果UIは `prediction-results-ui.js` へ分離しています。

## ドキュメント

- [アーキテクチャ](docs/ARCHITECTURE.md)
- [開発・運用手順](docs/OPERATIONS.md)
- [手動確認チェックリスト](docs/MANUAL_CHECKLIST.md)
- [依存関係とライセンス](docs/DEPENDENCIES.md)

## 既知の制約

- 新しい飛行予測・気象取得にはネットワークまたは起動済みローカルTawhiriが必要です。
- オフラインではアプリシェル、保存履歴、表示済み地図タイルを利用できますが、新規予測はできません。
- 海陸判定は固定版データの解像度と範囲に依存し、微小島嶼や複雑な沿岸ではunknownまたは誤差があり得ます。
- 愛媛13条件は固定プロファイルです。任意の組合せは不確実性解析を使用してください。
- ブラウザ自動試験はChromiumを対象とし、実APIの可用性・予測精度は手動確認が必要です。

## ライセンス

本プロジェクトはGPLv3です。詳細は [LICENSE](LICENSE) を参照してください。第三者ライブラリは各ライセンスに従い、同梱物のバージョンとSHA-256は `vendor-dependencies.json` に記録しています。
