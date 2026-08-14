# アーキテクチャ

## 目的

このアプリは、高高度気球の放球条件からTawhiri予測を取得し、飛行経路と着地点を地図上で確認するためのブラウザアプリです。通常予測に加え、愛媛向け13条件比較、時間・地点の自動探索、気球ガス計算、API予算付き不確実性解析を一つの画面で扱います。

## 構成

- `index.html`: 入力フォーム、地図、結果パネルの静的な骨格。インラインJavaScriptは置きません。
- `js/core/`: IndexedDB/localStorage、通知、画面全体の初期化とPWA登録。`AppShell.registerInitializer()` が読み込み済み機能を優先度順に一度だけ初期化します。
- `js/pred/pred-api-client.js`: API URLの解決、キュー、間隔制御、タイムアウト、再試行、3時間キャッシュ、同一リクエスト統合。
- `js/pred/pred-job-store.js`: 自動探索と不確実性解析の再開用スナップショット。
- `js/pred/pred-new.js`: 既存の通常予測・愛媛13条件比較・地図描画との接続。
- `js/pred/auto-search*.js`: 自動探索の純粋ロジックとUI/実行制御。
- `js/pred/uncertainty-*.js`: Sobol/LHS/モンテカルロ、分布変換、逐次停止、解析UI/実行制御。
- `js/calc/balloon-gas.js`: 2025年版計算シートに合わせた純粋計算。
- `js/calc/gas-calculator-*.js`: ガス計算画面とシミュレータ入力への反映。
- `js/pred/landsea.js`: 日本域GeoJSONによる同期判定、海岸線距離の概算。
- `js/pred/pred-new.js` の海陸判定接続: 沿岸・曖昧地点でBigDataCloudとOverpassを補助利用する既存互換層。
- `js/pred/launch-window.js`: Open-Meteoを用いた放球ウィンドウ評価。
- `ports.json`: KMLから生成した支援地点22件と実回収地点8件。探索距離には支援地点だけを使います。
- `sw.js`: `npm run build:sw` がHTMLとローカル資産から生成するService Worker。

## 状態管理

| 状態 | 保存場所 | 用途 |
|---|---|---|
| 通常フォーム前回値・プリセット | localStorage | 次回起動時の入力復元、名前付き設定 |
| 保存した放球地点 | Cookie（既存Jookie） | 既存機能との互換維持 |
| UIテーマ・サイドバー・ガス設定 | localStorage | 軽量な画面設定 |
| 愛媛モード実行履歴 | localStorage | 直近10件の再表示 |
| API応答 | メモリ + IndexedDB | 3時間TTL、同じ条件の再通信を防止 |
| 自動探索ジョブ | IndexedDB | 候補完了ごとに保存、中断・再読込後に再開 |
| 不確実性解析ジョブ | IndexedDB | サンプル完了ごとに保存、中断・再読込後に再開 |
| 実行中の通常/愛媛予測 | ページ内メモリ | 地図レイヤーと現在の予測結果 |

API URLは実行ごとの設定としてクライアントへ渡し、共有グローバルを書き換えません。中断は進行中の1リクエストまたは1候補を完了した境界で停止します。

画面初期化は `app-shell.js` の `DOMContentLoaded` 一箇所だけを入口にします。各機能は名前付き初期化処理として登録され、重複登録と二重実行を防止します。

## 外部通信

- Tawhiri/SondeHub: 飛行予測。
- Open-Meteo: 自動探索の降水・地上風と放球ウィンドウ。
- BigDataCloud: 沿岸・曖昧地点の逆ジオコーディングによる補助判定。
- Overpass: ローカルGeoJSONで陸と判断した地点の内水面確認。
- 地図タイル: 表示済みタイルを最大500件までオフライン用に保存。

Service WorkerはAPI応答をキャッシュしません。予測APIのTTL管理は `pred-api-client.js` に一本化しています。オフラインでは画面と保存済みジョブ・表示済み地図タイルを開けますが、新しい気象・飛行予測は取得できません。

海陸判定は現在、機能ごとに同期ローカル判定と非同期補助判定の使い分けが残っています。沿岸部では確定値として扱わず、Phase 0以降で判定結果・根拠・信頼度を共通データ契約へ統合します。
