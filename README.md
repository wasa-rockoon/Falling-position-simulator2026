
<div align="center">

# Falling Position Simulator 2026

気球 / 高高度プラットフォームの飛行（上昇 → 破裂 → 下降）着地点を予測・可視化するシングルページ Web クライアント。Leaflet を用いて API から取得した飛行経路 / 着地点を地図上にレンダリングし、パラメータ感度 (Ehime 実験モード) を 13 バリアント同時比較します。

👉 公開ページ (GitHub Pages): **現在公開してません**

<sub>静的ホスティングのみで動作。バックエンド (風予測 API) は外部サービスを利用します。</sub>

</div>

---

## 目次
1. [目的 / Overview](#1-目的--overview)
2. [主な機能 (Features)](#2-主な機能-features)
3. [デモ (Live Demo)](#3-デモ-live-demo)
4. [動かし方 (Quick Start)](#4-動かし方-quick-start)
5. [設定 / カスタマイズ (Configuration)](#5-設定--カスタマイズ-configuration)
6. [画面と操作概要](#6-画面と操作概要)
7. [パラメータ定義 (Flight Parameters)](#7-パラメータ定義-flight-parameters)
8. [Ehime 気球実験モード (Multi-Variant Sensitivity)](#8-ehime-気球実験モード-ehime-balloon-experiment-mode)
9. [データ / 判定ロジック](#9-データ--判定ロジック)
10. [ディレクトリ構成](#10-ディレクトリ構成)
11. [アーキテクチャ概要](#11-アーキテクチャ概要)
12. [よくある質問 (FAQ)](#12-よくある質問-faq)
13. [開発 / 貢献 (Contributing)](#13-開発--貢献-contributing)
14. [テスト / 品質](#14-テスト--品質)
15. [既知の制限事項 / Limitations](#15-既知の制限事項--limitations)
16. [ライセンス](#16-ライセンス)
17. [更新履歴 (Changelog)](#17-更新履歴-changelog)
18. [English Extended Summary](#18-english-extended-summary)

---

## 1. 目的 / Overview
高高度気球等の放球計画で「風予測と簡易物理モデル」に基づく着地点の見積もりと、不確実性（上昇・下降速度, 破裂高度の揺らぎ）が着地点分布へ与える影響を地図と数値で即時可視化することを目的としています。

## 2. 主な機能 (Features)
* 標準シナリオ: 上昇 → 破裂 → 下降 1 本予測
* Ehime 実験モード: 基準 + 12 感度バリアント (計 13) 並列実行・比較
* 統計指標: 平均着地点 / 最大偏差距離 (km)
* 陸 / 海 判定: 日本域 GeoJSON による簡易 Point-in-Polygon
* マップ操作: ズーム / パン / ポップアップ / レイヤ切替 (OSM, Topo, Esri 画像 等)
* KML / CSV 出力 (一部コード内フックあり)
* モバイル向け UI (`predictor-mobile.css`)
* 入力値永続化: Cookie によるフォーム値再利用 (`pred-cookie.js`)
* 軽量構成: ビルド工程不要 (純静的アセット)
* Leaflet + jQuery ベース (React / Vue などフレームワーク非依存)

## 3. デモ (Live Demo)
GitHub Pages (静的フロント):
https://wasa-rockoon.github.io/Falling-position-simulator2025/

> 注意: 風予測 API は外部サービス (Tawhiri / SondeHub) を利用します。CORS / 利用制限により本番デモで失敗する場合があります。

## 4. 動かし方 (Quick Start)
静的ファイルを配信するだけで動作します (ビルド不要)。

最短 (Python 簡易サーバ / PowerShell):
```
python -m http.server 8000
```
ブラウザ: http://localhost:8000/

Node を使う場合:
```
npm i -g serve
serve -l 8000 .
```

Docker ワンライナー (任意):
```
docker run --rm -p 8000:80 -v ${PWD}:/usr/share/nginx/html:ro nginx:alpine
```

> API 呼び出しが失敗する場合はブラウザ DevTools の Network / Console を確認してください。

### API接続先切替とローカル運用
API接続先切替（SondeHub / Localhost / カスタム）とローカルCORSプロキシの運用手順は以下を参照してください。

- `assignment-info.md`

ローカルTawhiriを使う場合は、リポジトリ直下で次を実行します。

```bash
node cors-proxy.js
```

補足:
- `Localhost (Docker)` 選択時は、過去日時のシミュレーションをGUIから実行できます。
- `SondeHub (Public)` 選択時は公開APIの時刻レンジ制限を適用します。

### 入力支援機能
- トースト通知: `showToast` による軽量通知を追加
- 共通設定取得: `getSettings` を追加
- 入力バリデーション: 実行前に主要入力を検証
- プリセット: 保存/読込/削除/前回復元を追加

## 5. 設定 / カスタマイズ (Configuration)
現状 .env / 設定ファイルは不要。主な調整点は JS 内定数です。

| 項目 | 位置 | 説明 | 変更例 |
|------|------|------|--------|
| 風予測 API ベース URL | `js/pred/pred-new.js` (`tawhiri_api`) | SondeHub Tawhiri エンドポイント | 自前 API に差替 |
| 陸域 GeoJSON | `data/land_japan_raw.geojson` | 陸海判定ポリゴン | 全球 / 高解像度へ更新 |
| UI 初期中心座標 | `pred-map.js` | Leaflet `setView` | 発射地域に合わせる |
| バリアント許容幅 | `pred-new.js` (Ehime ロジック付近) | 感度解析の範囲 | 新しい ±幅に変更 |

> 派生プロジェクトで API 鍵が必要な場合は、ビルドステップ導入 (例: Vite / Webpack) して `.env` 埋め込みを推奨。

## 6. 画面と操作概要
1. 出発地点 / Launch 時刻などを入力
2. 予測モードを選択: 標準 or 愛媛気球実験用
3. 「予測」ボタンで API 呼び出し開始
4. マップに BASE 軌跡 / 着地点マーカー (実験モードではバリアント群) が追加
5. 情報パネルで進行状況・統計を確認

## 7. パラメータ定義 (Flight Parameters)
| パラメータ | 意味 | 単位 | 備考 |
|------------|------|------|------|
| Ascent Rate | 上昇平均速度 | m/s | 破裂高度到達まで一定仮定 |
| Descent Rate | 下降平均速度 | m/s | パラシュート展開後一定仮定 |
| Burst Altitude | 破裂高度 | m | 上昇フェーズ終了高度 |
| Launch Time | 離陸時刻 | UTC/JST | 風予測参照時間 |
| Start Lat/Lon | 離陸緯度経度 | deg | 入力地点 |

## 8. Ehime 気球実験モード (Multi-Variant Sensitivity)
下部セクション「愛媛気球実験モード」で詳細記述。ここでは概要のみ。

| 特徴 | 内容 |
|------|------|
| バリアント数 | 13 (基準 + 単一変動 6 + 複合 6) |
| 並列化 | ブラウザから非同期リクエスト並列送信 |
| 指標 | 完了数 / 平均着地点 / 最大偏差 |
| 目的 | 上昇, 下降, 破裂高度の不確実性が着地点に与える影響把握 |

## 9. データ / 判定ロジック
* 風 / 予測: 外部 API (Tawhiri via SondeHub) から取得（本リポジトリに風データは含まれない）
* 陸海判定: `data/land_japan_raw.geojson` で簡易 Point-in-Polygon
* カラーリング: `js/colour-map.js` によるカテゴリ割当
* 時刻処理: `moment.js`
* Cookie: `pred-cookie.js` (単純 key/value)

### API 参考 (Tawhiri/SondeHub)
`https://api.v2.sondehub.org/tawhiri` へクエリパラメータ (例: `?launch_lat=..&launch_lon=..&launch_datetime=..&ascent_rate=..&descent_rate=..&burst_altitude=..`) を送信。詳細仕様は公式ドキュメントを参照してください。高頻度アクセスは控えてください。

> 将来的にレート制限 / キャッシュ層を追加する場合は Service Worker か軽量リバースプロキシ (Cloudflare Workers 等) を推奨。

## 10. ディレクトリ構成
```
.
├── index.html                # メインページ (フォーム + マップ領域)
├── js/
│   ├── pred/                 # 予測ロジック群 (UI / Map / Event / Mode)
│   ├── calc/                 # 追加計算 (必要に応じ)
│   └── ... 3rd party libs
├── css/                      # スタイル (デスクトップ / モバイル)
├── data/                     # GeoJSON (陸域)
├── images/                   # UI アイコン / マーカー
├── drift-api/ (stub)         # 将来の API 関連データ / 参考
└── sites.json                # 既定地点 (推測)
```

## 11. アーキテクチャ概要
| 層 | 技術 | 役割 |
|----|------|------|
| UI | HTML / CSS (Bootstrap / jQuery UI) | フォーム・ダイアログ・レイアウト |
| Map | Leaflet | タイル, マーカー, ポップアップ表示 |
| JS ロジック | `js/pred/*.js` | モード選択, API 呼び出し, 結果描画 |
| 補助 | jQuery, moment.js | DOM 操作 / 日時処理 |
| GeoData | GeoJSON (日本陸域) | 陸海判定 |

主要ファイル (推測):
* `pred-new.js`: 新 UI / Ehime モードロジック
* `pred-map.js`: 地図初期化と描画
* `pred-ui.js`: 入力フォーム連動
* `pred-event.js`: イベントハンドラ集中管理
* `pred-config.js`: 定数 / 設定

### エラー処理メモ
* ネットワーク失敗時: コンソールへスタック / メッセージ表示
* 部分成功: 成功分のみマッピング (失敗バリアントは再試行可)
* フォームバリデーション: 最低限 (数値の範囲 / 未入力)

## 12. よくある質問 (FAQ)
Q. なぜ 13 バリアント?  
A. 基準 + (単一パラメータ変動 6) + (2 パラメータ同符号組合せ 6) = 13。計算負荷と視認性のバランス。

Q. 平均 / 偏差を円で表示しない理由?  
A. ビジュアル混雑を避け、数値集中による比較を優先。必要なら fork で再追加可能。

Q. 海外放球に使える?  
A. 陸海判定ポリゴンを差し替えれば可能。風予測 API 側の全球対応が前提。

## 13. 開発 / 貢献 (Contributing)
Issue / PR 歓迎。バグ報告には以下を含めてください:
1. 再現手順 (最小)
2. 入力パラメータ (Ascent / Descent / Burst / Launch 時刻)
3. ブラウザ / OS バージョン
4. コンソールログ (可能ならスクリーンショット)

### 推奨ワークフロー
1. Fork & ブランチ作成 (`feat/xxx` or `fix/yyy`)
2. 変更 (JS / CSS) - コードスタイルは既存に倣う (Prettier 未導入)
3. ローカルで簡易サーバ起動し挙動確認
4. PR 作成 (変更概要 / Before-After スクリーンショット)

### 改善アイデア (歓迎)
* TypeScript 化 / モジュール分割
* E2E テスト導入 (Playwright)
* Service Worker キャッシュ
* 陸域ポリゴン差し替え (全球対応)
* UI アクセシビリティ向上 (ARIA, キーボード操作)

## 14. テスト / 品質
現状自動テストは未整備。最低限次を手動確認してください:
* 標準モード単一予測が成功する
* Ehime モード 13 バリアントの完了カウンタが正しく増分
* 平均着地点 / 最大偏差が NaN にならない
* 陸海判定が表示される

導入を検討している品質ゲート (提案):
| 種類 | ツール案 |
|------|----------|
| Lint | ESLint (browser, jquery) |
| Format | Prettier |
| Unit | Vitest / Jest (計算ロジック抽出後) |
| E2E | Playwright (入力～表示) |

## 15. 既知の制限事項 / Limitations
* 風予測 API 依存: オフラインでは利用不可
* バリアント数固定: 動的な組合せ変更 UI なし
* 陸海判定精度: 簡易ポリゴンによる低解像度判定
* 時間解像度: API レスポンス仕様に依存 (補間未実装)
* エラーハンドリング: 詳細リトライ戦略なし (手動再実行)

## 16. ライセンス
本プロジェクトは GPLv3 ライセンスです。詳細は `LICENSE` を参照してください。

## 17. 更新履歴 (Changelog)
| 日付 | 変更 |
|------|------|
| 2025-09-10 | README 大幅改訂 (構成拡張, 設定 / 品質 / 制限追加) |
| 2026-05-01 | フロントエンド 大幅改訂 |

## 18. English Extended Summary
Falling Position Simulator 2025 is a lightweight static web client (Leaflet + jQuery) that visualizes predicted high-altitude balloon flights (ascent → burst → descent). In the Ehime Experiment mode it concurrently runs 13 sensitivity variants (single-parameter ± changes and paired combinations) against a Tawhiri/SondeHub prediction API, displaying each landing point plus aggregated mean landing coordinates and maximum deviation. Land/Sea classification is a simple point-in-polygon test over a Japan landmask GeoJSON. No build step required; just serve the static files. Suggested future improvements include TypeScript refactor, automated testing, global landmask, and offline caching. Licensed under GPLv3. Live demo: https://wasa-rockoon.github.io/Falling-position-simulator2025/

---

## 愛媛気球実験モード (Ehime Balloon Experiment Mode)

本フォークには観測実験向けの「愛媛気球実験用」予測モードが追加されています。標準プロファイル（上昇→破裂→下降）を基準に、主要パラメータの許容幅を同時に複数バリエーションで API へ投げ、着地点の分布と統計値を可視化します。

### 許容幅 / マージン
* 上昇速度 (Ascent Rate): 基準値 ±1 m/s
* 下降速度 (Descent Rate): 基準値 ±3 m/s
* 破裂高度 (Burst Altitude): +10% / -20%

### 生成される 13 バリアントとラベル
| ラベル | 変更内容 |
|--------|----------|
| BASE   | 基準 (変更なし) |
| ASC- / ASC+ | 上昇 -1 / +1 m/s |
| DES- / DES+ | 下降 -3 / +3 m/s |
| BURST- / BURST+ | 破裂高度 -20% / +10% |
| A-D- / A+D+ | 上昇±1 & 下降±3 (同符号) |
| A-B- / A+B+ | 上昇±1 & 破裂高度 -20% / +10% |
| D-B- / D+B+ | 下降±3 & 破裂高度 -20% / +10% |

（合計 1 + 12 = 13 バリアント）

### 使い方
1. 予測タイプで「愛媛気球実験用」を選択。
2. 上昇速度 / 下降速度 / 破裂高度（標準プロファイル）を入力。
3. 「予測実行」を押すと 13 件の API リクエストが並列実行され、着地点が順次表示。
4. 情報行に以下が更新されます:
	* 上昇/下降 許容範囲表示
	* 破裂高度マージン (+10% / -20%)
	* 完了数 / 総数
	* 平均着地点 (全バリアント平均緯度経度)
	* 最大偏差 (平均地点から最も遠い着地点までの距離 km)
5. 履歴パネルから過去結果を再表示できます。左右ボタンで前後の履歴へ移動し、再表示後は表の行クリックで該当ピンへ移動します。
6. 履歴の重ね表示は、個別に色分けされた単純なオーバーレイとして切り替えできます。

### マップ表示の意味
* カラフルな小円: 各バリアントの着地点（BASE はやや大きい）
* BASE の軌跡: 標準条件の飛行経路
* 平均着地点 / 最大偏差: いずれも現在はマップ図形を表示せず、パネル内数値のみ表示 (平均緯度経度, 最大偏差 km)。以前存在した青い平均マーカー・青/オレンジ破線円は削除しました。

### ポップアップ
任意の着地点マーカーをクリックすると:
* 変更: 上昇/下降/破裂高度が基準からどの方向に変化したか（例: 上昇+1 m/s → 「上昇+1 m/s」）
* 条件値（上昇速度, 下降速度, 破裂高度）
* 着地点座標
* 離陸時刻 (JST)

BASE のポップアップでは「変更: なし (基準)」と表示されます。

### 結果の解釈
* 平均着地点: 統計的中心（単純平均）。現状は数値のみ (マップ上マーカー非表示)。
* 最大偏差: 平均地点から最遠バリアント着地点までの距離 (km)。視覚円は表示せず数値のみ。
* 破裂高度影響: 破裂高度を含むバリアント (ラベルに B を含む) のばらつきは現在個別円を描かず、必要なら CSV へ出力後オフライン解析してください。

### 陸海判定 (Land / Sea Classification)
Ehime バリエーション表の最終列は各バリアントの予測着地点が「陸」か「海」かを表示します。

* 判定データ: `data/land_japan_raw.geojson` (日本付近切り出し陸地ポリゴン) による単純 Point-in-Polygon 判定。
* 表示: 「陸」= 通常色, 「海」= 水色強調, 読み込み中は「判定中」。
* 制限: ポリゴン外の遠方 (海上含む) は "海" と判定される可能性が高い。微小島嶼など低解像度により陸を海と誤判定することがあります。厳密用途では高解像度海岸線や別ソースで再確認してください。

### English Summary
The "Ehime Balloon Experiment" mode runs 13 parameter variants (ascent ±1 m/s, descent ±3 m/s, burst altitude +10% / -20%, and paired combinations) in parallel and plots each landing point (color-coded). The panel lists completed/total count, mean landing coordinates, and maximum deviation (km). Removed overlays (mean marker / dispersion circles) remain numeric-only for clarity. Land/Sea is a simple polygon test over a Japan land mask. Popups show parameter deltas vs BASE.


