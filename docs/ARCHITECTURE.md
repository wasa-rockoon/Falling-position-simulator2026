# アーキテクチャ

## 目的

このアプリは、高高度気球の放球条件からTawhiri予測を取得し、飛行経路と着地点を地図上で確認するためのブラウザアプリです。通常予測に加え、愛媛向け13条件比較、時間・地点の自動探索、気球ガス計算、API予算付き不確実性解析を一つの画面で扱います。

## 構成

- `index.html`: 入力フォーム、地図、結果パネルの静的な骨格。インラインJavaScriptは置きません。
- `js/core/` と `js/domain/`: RunRecord、実行履歴、設定、IndexedDB/localStorage、通知、画面全体の初期化とPWA登録。`AppShell.registerInitializer()` が読み込み済み機能を優先度順に一度だけ初期化します。
- `js/pred/pred-api-client.js`: API URLの解決、キュー、間隔制御、タイムアウト、再試行、3時間キャッシュ、同一リクエスト統合。
- `js/pred/pred-job-store.js`: 自動探索と不確実性解析の再開用スナップショット。
- `js/pred/pred-new.js`: 既存の通常予測・愛媛13条件比較・地図描画との接続。
- `js/pred/auto-search*.js`: 自動探索の純粋ロジックとUI/実行制御。
- `js/pred/uncertainty-*.js`: Sobol/LHS/モンテカルロ、分布変換、逐次停止、解析UI/実行制御。
- `js/calc/balloon-gas.js`: 2025年版計算シートに合わせた純粋計算。
- `js/calc/gas-calculator-*.js`: ガス計算画面とシミュレータ入力への反映。
- `js/geo/land-sea-classifier.js`: 固定版の陸域・湖沼GeoJSONを使い、Polygonの穴、MultiPolygon、測地距離、4値のLandSeaResultを返す純粋分類器。
- `js/pred/landsea.js`: 既存機能向けの互換ファサード。大量実行を含めBigDataCloud/Overpassへ通信しません。
- `data/land-sea-datasets.json`: 判定データの版、SHA-256、出典、利用条件、範囲、既知制約。

- `js/pred/launch-window.js`: Open-Meteoを用いた放球ウィンドウ評価。
- `ports.json`: KMLから生成した支援地点22件と実回収地点8件。探索距離には支援地点だけを使います。
- `sw.js`: `npm run build:sw` がHTMLとローカル資産から生成するService Worker。

## 状態管理

| 状態 | 保存場所 | 用途 |
|---|---|---|
| 通常フォーム前回値・プリセット | localStorage | 次回起動時の入力復元、名前付き設定 |
| 保存した放球地点 | Cookie（既存Jookie） | 既存機能との互換維持 |
| UIテーマ・サイドバー・ガス設定 | localStorage | 軽量な画面設定 |
| 全実行種別のRunRecord・履歴 | IndexedDB | 通常、愛媛、自動探索、不確実性解析の共通保存・再開・ピン留め |
| 愛媛モード旧履歴 | localStorage | 既存データを削除せずRunRecordへ一度だけコピー |
| API応答 | メモリ + IndexedDB | 3時間TTL、同じ条件の再通信を防止 |
| 自動探索ジョブ | IndexedDB | 候補完了ごとに保存、中断・再読込後に再開 |
| 不確実性解析ジョブ | IndexedDB | サンプル完了ごとに保存、中断・再読込後に再開 |
| 実行中の通常/愛媛予測 | ページ内メモリ | 地図レイヤーと現在の予測結果 |

API URLは実行ごとの設定としてクライアントへ渡し、共有グローバルを書き換えません。中断は進行中の1リクエストまたは1候補を完了した境界で停止します。

画面初期化は `app-shell.js` の `DOMContentLoaded` 一箇所だけを入口にします。各機能は名前付き初期化処理として登録され、重複登録と二重実行を防止します。

## 外部通信

- Tawhiri/SondeHub: 飛行予測。
- Open-Meteo: 自動探索の降水・地上風と放球ウィンドウ。
- 海陸判定: Natural Earth陸域と国土数値情報W09-05湖沼の固定版をローカル利用。外部判定APIへの通信なし。

- 地図タイル: 表示済みタイルを最大500件までオフライン用に保存。

Service WorkerはAPI応答をキャッシュしません。予測APIのTTL管理は `pred-api-client.js` に一本化しています。オフラインでは画面と保存済みジョブ・表示済み地図タイルを開けますが、新しい気象・飛行予測は取得できません。

海陸判定は全機能で同じ決定論的分類器を使用します。結果は `land`、`sea`、`inland_water`、`unknown`、信頼度、判定元、海岸距離、データ版を保持します。内水面は海上率へ含めず、データ境界・範囲外・読込失敗はunknownのまま扱います。
