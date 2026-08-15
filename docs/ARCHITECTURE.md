# アーキテクチャ

## 目的と境界

Falling Position Simulator 2026は、高高度気球の放球・飛行・回収計画を支援するクライアントサイド中心のWebアプリです。Tawhiriの予測精度そのものを実装するのではなく、入力、API負荷制御、複数条件の編成、地図・グラフ表示、保存、再開、出力を担当します。

## 読込と初期化

`index.html` は画面骨格とローカルスクリプトの読込順だけを持ち、インラインJavaScriptは置きません。`js/core/app-shell.js` が一つの `DOMContentLoaded` 入口を所有し、各機能は `AppShell.registerInitializer(name, callback, priority)` で一度だけ初期化されます。

主要な依存順は次のとおりです。

```text
AppStorage / AppErrors / RunRecord
              ↓
RunRepository / SettingsRepository / AppShell
              ↓
PredictionApi / RequestContext / PredictionRunner
              ↓
通常予測・愛媛・自動探索・不確実性解析
              ↓
地図・RESULTS・履歴・CSV/KML
```

## モジュール

| 領域 | 主なファイル | 責務 |
|---|---|---|
| Core | `js/core/app-shell.js` | 初期化、サイドバー、PWA更新 |
| 保存 | `app-storage.js`, `run-repository.js`, `settings-repository.js` | IndexedDB/localStorage、履歴、互換移行 |
| ドメイン | `js/domain/run-record.js` | 共通RunRecord v1、状態遷移、正規化 |
| API | `pred-api-client.js`, `request-context.js` | URL固定、キュー、再試行、予算、キャッシュ、診断 |
| 実行 | `prediction-runner.js` | API応答をプロバイダ非依存形式へ正規化 |
| 通常予測 | `pred-new.js` | 既存フォームとの互換入口、RunRecord開始境界 |
| 描画 | `prediction-renderer.js`, `prediction-results-ui.js` | 軌跡、着地点、指標、結果操作 |
| 愛媛 | `ehime-controller.js`, `variant-profile-registry.js` | 13条件、統計、比較、旧履歴互換 |
| 探索 | `auto-search-core.js`, `auto-search.js` | 3段階探索、見積り、中断・再開、自動保存 |
| 不確実性 | `uncertainty-core.js`, `uncertainty-analysis.js` | サンプリング、逐次停止、楕円、KDE、地図 |
| ガス | `js/calc/balloon-gas.js`, `gas-calculator-ui.js` | 純粋計算、計算シートUI、SETTINGS反映 |
| 海陸 | `land-sea-classifier.js`, `landsea.js` | 固定版GeoJSON分類と旧呼出互換 |
| 表示 | `results-workspace.js`, `pred-chart*.js` | RESULTSタブ、診断、履歴、最大5系列 |
| 出力 | `export-service.js`, `history-controller.js` | CSV/KML、履歴再表示、再実行準備 |

`pred-new.js` はAPI、愛媛制御、描画、履歴、出力を直接抱えず、既存フォームと分割済みサービスを接続する互換層です。

## RunRecordと状態遷移

全実行種別は `single`、`ehime_ensemble`、`auto_search`、`uncertainty` のRunRecordへ正規化します。主な状態は次のとおりです。

```text
draft → running → completed / partial / failed / cancelled
                    ↑
          pause_requested → paused → running
```

RunRecordは入力、API接続先、進捗、軌跡、着地点、指標、警告、再開スナップショット、データ出典を保持します。履歴画面は実行種別に依存せず、地図再表示、CSV/KML、再実行準備、固定、削除を提供します。旧愛媛履歴は削除せず一度だけ共通履歴へコピーします。

## 状態の保存先

| 状態 | 保存先 | ライフサイクル |
|---|---|---|
| 前回設定・プリセット・UI設定 | localStorage | 軽量、即時保存 |
| 旧保存地点 | Cookie | 互換維持 |
| RunRecordと履歴 | IndexedDB | 完了・失敗を含む永続履歴 |
| 自動探索・不確実性ジョブ | IndexedDB | 候補/サンプル境界ごとに自動保存 |
| API応答 | メモリ + IndexedDB | TTL 3時間、LRU 500、永続2500件 |
| 実行中レイヤー・グラフ | ページ内メモリ | 表示クリアと履歴削除を分離 |

中断要求は実行中の通信を強制破棄せず、現在の単位を保存したあと次を開始しない方式です。

## API負荷制御

`PredictionClient` は接続先ごとの同時数と最小間隔を持ちます。RequestContextは実行開始時に接続先URLを固定するため、別実行が共有グローバルURLを書き換える競合はありません。

- SondeHub: 同時1件、最小900ms
- Localhost: 同時2件、最小100ms
- Custom/Open-Meteo: 同時1件、設定された最小間隔
- 429、5xx、タイムアウト、通信TypeErrorを上限内で再試行
- 同一URLの進行中要求を統合
- HTTP試行数は再試行を含めて予算へ計上

自動探索は時刻を外側、地点を内側に並べ、複数地点を公平に進めます。不確実性解析は地点ごとのラウンドロビンで1サンプルずつ進め、1地点の連続失敗が他地点を止めない構造です。

## 海陸判定

`js/geo/land-sea-classifier.js` は同梱したNatural Earth陸域と国土数値情報W09-05湖沼を読み、Polygonの穴とMultiPolygonを含むPoint-in-Polygon、測地海岸距離を計算します。結果は分類、信頼度、判定元、距離、データ版、理由を持ちます。

実行時にBigDataCloud/Overpassへ通信しないため、大量処理でも同じ入力は同じ結果になります。範囲外、データ未読込、境界が判断不能な場合は推測せず `unknown` です。

## エラーと診断

利用者向けメッセージと技術診断を分離します。診断のURLクエリに含まれるkey/token/secretとBearer値はマスクし、保存・イベント・コンソールへ渡す技術メッセージは1000文字へ制限します。巨大なAPI応答本文やError causeを履歴・診断イベントへ保存しません。

## PWA

`scripts/build-service-worker.mjs` はHTMLのローカル依存、地理データ、画像から内容ハッシュ付き `sw.js` を生成します。

- アプリシェル: stale-while-revalidate
- 画面遷移: network-first、失敗時はキャッシュ
- 地図タイル: cache-first、最大500件
- 予測・気象API: Service Worker対象外
- activate時:現行アプリキャッシュとタイル以外の旧キャッシュを削除

## 検証層

- Nodeテスト: 純粋計算、保存、状態遷移、API負荷、静的品質、PWA生成物
- Playwright: 固定APIによる主要6フロー、モバイル、キーボード、PWAオフライン
- GitHub Actions: build、生成物差分、Nodeテスト、Chromium E2E
- 手動確認: 実API、予測妥当性、実端末表示、Service Worker更新通知
