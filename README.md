<div align="center">

# Falling Position Simulator 2026

気球・高高度プラットフォームの飛行経路と着地点を予測し、放球時刻、回収、安全性を検討するためのシングルページWebアプリです。

通常予測、愛媛気球実験用13条件比較、放球自動探索、不確実性解析、実行履歴を一つの地図上で扱います。ガス・破裂高度計算では、2026年版モデルによる必要ガス量、ボンベ残圧、破裂高度を確認できます。

公開予定（GitHub Pages）: **https://wasa-rockoon.github.io/Falling-position-simulator2026/**

<sub>アプリ本体は静的ホスティングで動作し、飛行予測・気象・地図は外部サービスを利用します。</sub>

</div>

---

> [!IMPORTANT]
> このアプリは計画支援ツールです。予測には気象モデル、入力値、機体特性に由来する不確実性があります。実運用では最新の気象情報、関係法令、現地状況、チームの安全基準を必ず併用してください。

## 目次

1. [目的](#1-目的)
2. [主な機能](#2-主な機能)
3. [公開版と起動方法](#3-公開版と起動方法)
4. [画面と基本操作](#4-画面と基本操作)
5. [予測モード](#5-予測モード)
6. [放球自動探索](#6-放球自動探索)
7. [ガス・破裂高度計算](#7-ガス破裂高度計算)
8. [不確実性解析](#8-不確実性解析)
9. [状態・履歴・出力](#9-状態履歴出力)
10. [APIと大量実行](#10-apiと大量実行)
11. [海陸判定と地点データ](#11-海陸判定と地点データ)
12. [アーキテクチャとディレクトリ](#12-アーキテクチャとディレクトリ)
13. [開発・テスト・CI](#13-開発テストci)
14. [既知の制約](#14-既知の制約)
15. [ドキュメントとライセンス](#15-ドキュメントとライセンス)

## 1. 目的

高高度気球等の放球計画で、風予測と飛行条件に基づく経路・着地点を可視化し、次の判断を支援します。

- いつ、どこから放球するか
- 予測着地点が海上・陸上・内水面のどこになるか
- 回収支援地点からどの程度離れるか
- 上昇速度、下降速度、破裂高度の変動が結果へどう影響するか
- 大量の候補を調べる場合に、API呼び出し数と所要時間がどの程度になるか

飛行予測そのものはTawhiri/SondeHub等のAPIへ依頼し、本アプリは入力、負荷制御、複数条件の編成、表示、保存、再開、出力を担当します。

## 2. 主な機能

- 通常予測、落下のみ予測、時間別予測
- 愛媛気球実験用13条件の比較
- 地点×時刻の放球自動探索
- 2026年版モデルによるガス量・3過程のボンベ残圧・破裂高度計算
- Monte Carlo、Latin Hypercube、Sobolによる不確実性解析
- 正規分布・Weibull分布を使った入力変動
- 着地点群、95%確率楕円、KDE密度等高線の地図表示
- 高度・水平風速グラフの最大5系列比較
- 通常予測、愛媛13条件、自動探索、不確実性解析の共通履歴
- 中断、再開、自動保存、CSV/KML出力
- デスクトップ・モバイル対応、PWA、オフラインアプリシェル

## 3. 公開版と起動方法

### GitHub Pages

公開後はブラウザだけで利用できます。Node.jsのインストールは不要です。

```text
https://wasa-rockoon.github.io/Falling-position-simulator2026/
```

現在のリポジトリには検証用CIがありますが、GitHub Pagesへのデプロイ設定は別途必要です。公開版では既定のSondeHub (Public)を利用します。

> [!WARNING]
> Localhost (Docker)は**開発・現地PC専用**です。GitHub Pagesではcors-proxy.jsやローカルTawhiriを実行できないため、公開ページからLocalhost APIを使うことはできません。公開ページではSondeHub、またはHTTPSかつCORS対応のCustom APIを選択してください。

### ローカルで画面を開く

ローカル開発にはNode.js 20以上を使用します。

```powershell
node cors-proxy.js
```

起動ログに表示されたURL（既定は`http://localhost:3100/`）を開きます。3100番が使用中の場合は、最大20ポート先まで自動的に再試行します。

### ローカルTawhiriを使う

画面で`Localhost (Docker)`を選ぶ場合、`cors-proxy.js`が同一オリジンの`/api/v1/`をローカルTawhiriへ転送します。

```powershell
$env:TAWHIRI_HOST = 'localhost'
$env:TAWHIRI_PORT = '8000'
$env:PORT = '3100'
node cors-proxy.js
```

`http://localhost:3100/__server-info`で配信元と転送先を確認できます。GitHub PagesではNode.jsサーバーを実行できないため、`Localhost`はローカル起動時専用です。

## 4. 画面と基本操作

1. `SETTINGS`で放球地点、日時、上昇速度、下降速度、破裂高度等を入力します。
2. 予測タイプとAPI接続先を選択します。
3. `予測を実行`を押します。
4. 地図で上昇・下降軌跡、破裂点、着地点を確認します。
5. `RESULTS`で概要、グラフ、履歴、診断を確認します。
6. 必要に応じてCSV/KMLを出力し、履歴から結果を再表示します。

フォーム値、プリセット、テーマは自動保存されます。画面上の表示を消しても、保存済み履歴は削除されません。

## 5. 予測モード

### 通常・落下のみ・時間別

- 標準プロファイル: 上昇 → 破裂 → 下降
- 落下のみ: 指定高度から下降する経路
- 時間別: 複数の放球時刻を比較

主な入力値は次のとおりです。

| パラメータ | 意味 | 単位 |
|---|---|---|
| Launch latitude / longitude | 放球地点 | degree |
| Launch altitude | 放球地点高度 | m |
| Launch datetime | 放球日時（画面入力はJST） | date/time |
| Ascent rate | 平均上昇速度 | m/s |
| Descent rate | 平均下降速度 | m/s |
| Burst altitude | 破裂高度 | m |

### 愛媛気球実験用13条件

基準条件と12の感度条件を実行し、着地点分布を比較します。

| ラベル | 基準からの変更 |
|---|---|
| BASE | 変更なし |
| ASC- / ASC+ | 上昇速度 -1 / +1 m/s |
| DES- / DES+ | 下降速度 -3 / +3 m/s |
| BURST- / BURST+ | 破裂高度 -20% / +10% |
| A-D- / A+D+ | 上昇速度・下降速度を同時変更 |
| A-B- / A+B+ | 上昇速度・破裂高度を同時変更 |
| D-B- / D+B+ | 下降速度・破裂高度を同時変更 |

完了数、平均着地点、最大偏差、海上率を集計し、各系列の着地点・軌跡・高度・風速を比較できます。

## 6. 放球自動探索

複数地点と時間帯を組み合わせ、海上率、雨量、風速、回収支援地点までの距離などから候補を探します。

| モード | 動作 |
|---|---|
| 高速 | 粗探索で条件を満たさない候補を除外してから精密探索 |
| 全候補精密 | 粗探索の合否にかかわらず全候補を13条件で評価 |
| 段階的 | 候補を除外せず、粗探索の見込み順に精密評価 |

- 海上率は「下限以上」で合格します。
- 中断要求は進行中のAPI呼び出しまたは候補を完了した境界で反映し、次へ進みません。
- 候補境界ごとに自動保存し、再読み込み後に再開できます。
- 開始前に論理API要求数、再試行を含む最悪HTTP試行数、概算時間を表示します。

## 7. ガス・破裂高度計算

2025年版Excelを移植したコードを基礎に、`gas_calc_2026.py`の改良内容をブラウザ向けJavaScriptへ反映しています。

- 密度差1.1138 kg/m³によるヘリウム必要量
- 純浮力・目標上昇速度
- 4本それぞれの容積、初期圧力、使用量、終了残圧
- 準静的、ポリトロープ（初期値 n=1.3）、断熱の比較
- 楕円体3方式と球直径方式による破裂高度
- 球直径方式の推奨破裂高度と上昇速度をSETTINGSへ反映

入力値はブラウザへ自動保存されます。1200 g気球は上昇速度係数が未確定のため選択肢に表示せず、推測値は使用しません。

## 8. 不確実性解析

上昇速度、下降速度、破裂高度をサンプリングし、入力変動が着地点へ与える影響を調べます。

- Monte Carlo
- Latin Hypercube Sampling
- Sobol系列
- 正規分布
- Weibull分布
- 再現用シードによる同一サンプル生成
- API予算に応じたサンプル数制御
- Wilson区間と安定バッチによる逐次停止

結果は着地点、95%確率楕円、KDE密度等高線を個別または重ねて地図表示できます。解析日時は不確実性解析画面で設定し、JSTとして保存・復元します。

## 9. 状態・履歴・出力

| データ | 保存先 | 内容 |
|---|---|---|
| フォーム値、プリセット、テーマ | localStorage | 即時自動保存、旧キー互換 |
| 旧保存地点 | Cookie | 従来機能との互換 |
| RunRecord、履歴 | IndexedDB | 全実行種別の共通履歴 |
| 探索・解析ジョブ | IndexedDB | 中断・再開スナップショット |
| API応答 | メモリ + IndexedDB | 3時間TTL、件数上限あり |
| 表示中レイヤー・グラフ | ページ内メモリ | 表示クリアと履歴削除を分離 |

履歴から地図再表示、再実行準備、固定、削除、CSV/KML出力ができます。旧愛媛履歴は削除せず、共通履歴へ互換移行します。

## 10. APIと大量実行

### 接続先

- SondeHub/Tawhiri: 飛行予測
- Localhost: ローカルTawhiri（`cors-proxy.js`経由）
- Custom: ユーザー指定API。GitHub PagesではHTTPSかつCORS対応が必要
- Open-Meteo: 自動探索の雨量・地上風
- OpenStreetMap/OpenTopoMap/ArcGIS/Carto: 地図タイル

予測APIクライアントは、同時数、最小間隔、タイムアウト、429/5xx/通信失敗の再試行、同一要求の統合、キャッシュを共通管理します。

SondeHub公開APIは同時1件で実行し、300 HTTP試行を超える設定では警告します。数千回規模の探索・解析はローカルTawhiriを推奨します。API予算へ到達した場合は一部完了として保存し、上限を見直して再開できます。

## 11. 海陸判定と地点データ

海陸判定は外部判定APIを使用せず、同梱した固定版データから決定論的に計算します。

- 陸域: Natural Earth `ne_10m_land`の日本域
- 内水面: 国土数値情報W09-05湖沼データ
- 結果: `land` / `sea` / `inland_water` / `unknown`

内水面は海上率へ含めません。範囲外、境界、読込失敗は無理に海・陸へ変換せず`unknown`として扱います。データ版、出典、ライセンス、SHA-256は`data/land-sea-datasets.json`に記録しています。

支援・回収地点は`漁船・回収地点位置関係マップ.kml`を正本とし、`ports.json`を生成します。支援地点と実回収地点は用途を分け、探索の最寄り支援距離には支援地点だけを使います。

## 12. アーキテクチャとディレクトリ

React/Vue等のフレームワークや本番バンドラーを使用せず、`index.html`からローカルJavaScriptを順番に読み込む構成です。旧CUSF由来の互換層を残しながら、保存、API、描画、履歴、計算を分割しています。

```text
.
├── index.html                  # 画面骨格とスクリプト読込順
├── manifest.json / sw.js      # PWAとオフラインアプリシェル
├── cors-proxy.js              # ローカル開発サーバー・Tawhiri転送
├── js/
│   ├── core/                  # 初期化、保存、履歴、通知、出力
│   ├── domain/                # 共通RunRecordスキーマ
│   ├── pred/                  # 予測、探索、解析、描画、グラフ
│   ├── calc/                  # ガス・浮力・破裂高度計算
│   └── geo/                   # 決定論的な海陸分類
├── css/                       # デスクトップ・モバイル・各機能UI
├── images/                    # 地図マーカー・PWAアイコン
├── data/                      # 固定版地理データとマニフェスト
├── scripts/                   # データ・Service Worker生成、構文検査
├── tests/                     # Node単体・統合テスト
├── e2e/                       # 固定APIによるPlaywright E2E
├── docs/                      # 設計・運用・手動確認資料
└── .github/workflows/         # GitHub Actions CI
```

主要な依存順は次のとおりです。

```text
AppStorage / AppErrors / RunRecord
              ↓
RunRepository / SettingsRepository / AppShell
              ↓
PredictionApi / RequestContext / PredictionRunner
              ↓
通常予測・愛媛13条件・自動探索・不確実性解析
              ↓
地図・RESULTS・履歴・CSV/KML
```

## 13. 開発・テスト・CI

依存関係を導入します。

```powershell
npm install
npx playwright install chromium
```

主なコマンド:

```powershell
npm run build       # ports.json・sw.js生成、JavaScript構文検査
npm test            # Node単体・統合テスト
npm run test:e2e    # 固定APIによるChromium E2E
npm run ci          # build、Nodeテスト、E2Eをまとめて実行
```

E2Eは公開APIへ通信せず、固定レスポンスで通常予測、愛媛13条件、自動探索、ガス計算、不確実性解析、履歴、モバイル、PWAを検証します。

GitHub Actionsの**CI**は、pushやPull RequestのたびにGitHub上のまっさらなLinux環境で品質を確認する自動検査です。npm run buildで必要な生成物を確認し、Nodeテストで計算・保存・API負荷制御などを検査します。

**E2E（End-to-End test）**は、実際にChromiumで画面を開き、通常予測、愛媛13条件、自動探索、不確実性解析、履歴、モバイル、PWAの一連の操作を自動で確認するブラウザ試験です。外部APIは固定レスポンスに差し替えるため、実APIの可用性や予測精度は別途手動確認が必要です。

CIは品質確認であり、GitHub Pagesへのデプロイ処理ではありません。

PWAアイコンとjQuery UI画像を再生成する場合だけWindows PowerShellが必要です。

```powershell
npm run build:icons:windows
npm run build:ui-assets:windows
```

開発ルールは[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。

## 14. 既知の制約

- 新しい飛行予測・気象取得にはネットワークまたは起動済みローカルTawhiriが必要です。
- GitHub Pagesでは`cors-proxy.js`とローカルTawhiri接続を利用できません。
- オフラインではアプリシェル、保存履歴、表示済み地図タイルを利用できますが、新規予測はできません。
- 海陸判定は固定データの解像度と範囲に依存し、微小島嶼や複雑な沿岸では`unknown`または誤差があり得ます。
- 愛媛13条件は固定プロファイルです。任意の組合せは不確実性解析を使用してください。
- 自動試験はChromiumと固定APIを対象とし、実APIの可用性・予測精度は手動確認が必要です。

## 15. ドキュメントとライセンス

- [アーキテクチャ](docs/ARCHITECTURE.md)
- [開発・運用手順](docs/OPERATIONS.md)
- [手動確認チェックリスト](docs/MANUAL_CHECKLIST.md)
- [依存関係とライセンス](docs/DEPENDENCIES.md)

本プロジェクトはGPLv3です。詳細は[LICENSE](LICENSE)を参照してください。第三者ライブラリは各ライセンスに従い、同梱物のバージョンとSHA-256は`vendor-dependencies.json`に記録しています。

---

## English Summary

Falling Position Simulator 2026 is a static, browser-based planning tool for high-altitude balloon flights. It visualizes Tawhiri/SondeHub trajectories and landing points, compares 13 fixed Ehime experiment variants, searches launch windows across sites and times, includes 2026 helium-volume, cylinder-process, and burst-altitude calculations, and performs uncertainty analysis using Monte Carlo, Latin Hypercube, or Sobol sampling. Results, resumable jobs, diagnostics, and exports are stored locally in the browser. The public application is intended for GitHub Pages; Node.js and `cors-proxy.js` are required only for local development or a local Tawhiri instance.
