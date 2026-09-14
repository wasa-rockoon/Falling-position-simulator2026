# Browser Predictor — Phase 0

既存2026版から独立した、固定1ケースの数値互換PoCです。
**同一GFS・同一地表標高を入力したJavaScript + 1 Dedicated Web Workerが、
固定Dockerイメージ内のTawhiriと1m / 1s以内で一致することを確認しました。**
実際の気球に対する予測精度を保証する結果ではありません。

## 追加検証（2026-09-12）

同じfixtureで条件を変えた5ケースと、範囲外エラー3ケースを追加検証しました。
全5ケースで1m / 1s以内の一致、オフライン実行とエラー後の復帰を確認しています。
手順と結果は [VALIDATION.md](VALIDATION.md) を参照してください。
この追加検証時点では既存UIへの統合や新しい気象取得は行っていません。

## 通常予測への試験接続

その後、固定fixtureによる通常予測を既存UIから試せるようにしました。
使い方と制限は [INTEGRATION.md](INTEGRATION.md) を参照してください。
以下の独立PoCも引き続き利用できます。

## 実行

リポジトリのルートで、Node.js 20以上を使って実行します。

```text
node poc/browser-predictor/serve.mjs
```

http://127.0.0.1:4010 を開き、「1回計算・比較」または「同じ条件で100回計測」を押します。
停止はCtrl+Cです。ブラウザ実行にDockerやPythonは不要です。
file:// ではModule Workerをロードできないため、上記の静的サーバーを使います。

fixture読み込み後はネットワークを切断して再計算できます。
初回ページロードそのもののオフライン化やService Workerは今回実装していません。

## 固定テストケース

| 項目 | 値 |
|---|---|
| 地点 | index.htmlの既存初期地点、北緯33.13492°・東経132.50477° |
| 放球高度 | 海抜100m（PoCの指定値。地表標高は6m） |
| 放球UTC | 2026-09-10 04:30:00Z |
| 上昇 / 海面下降速度 | 5 / 5 m/s |
| 破裂高度 | 30,000m |
| GFS run | 2026-09-10 00:00Z |
| forecast hours | 3, 6, 9 |
| 気象範囲 | 北緯30–36°、東経128–137°、0.5°、47気圧面 |
| 標高範囲 | 北緯32–35°、東経131–135°、15秒角 |
| timestep / 終端探索許容幅 | 60秒 / ステップ内比率0.01 |

実験の実測軌道ではなく、明示的な入力による検証ケースです。
詳細は [case.json](fixtures/case.json)、[manifest.json](fixtures/manifest.json)、
[terrain.json](fixtures/terrain.json) に保存しています。

## 基準Tawhiri

使用イメージは次のdigestで固定しています。

```text
ghcr.io/projecthorus/tawhiri-container@sha256:9714dc04a22f8982d810f3dc6f3a8ca69f84274cc4d8bff47ce52b42f0c1e451
```

- 実イメージのTawhiriパッケージバージョン：0.2.0。
- イメージ作成日時：2021-10-09T23:38:32.748Z。
- Dockerラベルのrevisionはtawhiri-containerのビルドリポジトリを指します。
  Tawhiri本体のcommitとは扱いません。
- 本体のGit commitはイメージ内から確定できませんでした。
  代わりにimage digest、実ソースとロードしたCythonバイナリのSHA-256を
  [baseline.json](fixtures/baseline.json)へ記録しています。
- 実イメージから取得したモデル・積分器・補間器のソースを
  [reference-source](reference-source/) に保存しています。
- 参考値の生成は実イメージ内のネイティブCythonモジュールを直接呼びます。
  JSをPythonへ書き直した「もう一つの同じ実装」との比較ではありません。
- 2026年時点の上流masterや公開SondeHubとの一致を主張していません。

実際の基準の挙動：

1. 全球配列は65時刻 × 47面 × 3変数 × 361 × 720、Float32。
2. 元格子の時刻・緯度・経度から8点の重みを計算。
3. 各気圧面のHGTをその8点で補間してから高度bracketを二分探索。
4. U/Vを水平・時刻補間し、高度方向へ補間。範囲端の鉛直外挿も再現。
5. 一定上昇、標準大気密度による下降。GFS気温は使用しません。
6. RK4は60秒刻み。4項を順に加算する順序も保持。
7. 破裂は altitude >= burstAltitude。
8. 着地は terrain.get(lat, lon) > altitude。海面条件を勝手に追加しません。
9. 終端は前後のRK4状態を線形補間し、比率を二分探索。
   最後に評価した中点を返すため、破裂高度・地表高度へ強制的に合わせません。
10. Ruaumokoの標高参照は最近傍・Cのroundに相当する丸め。双線形補間ではありません。

## 同じデータを使う仕組み

```text
保存済みの小地域GRIB 3ファイル
    ↓ ecCodesで一度だけデコード・47面を厳密に選択
weather.bin（Float32 LE） + manifest.json
    ├─ JS補間器 → Worker内RK4
    └─ 元の全球アドレス配置へ配置 → 実Tawhiri Cython補間器/RK4

既存Ruaumokoデータの小地域を切り出す
    ↓
terrain.bin（Int16 LE）
    ├─ JS最近傍参照
    └─ 元タイル配置へ再配置 → 実Ruaumoko Cython参照
```

ブラウザに全球データは渡しません。
reference生成のときだけ、Docker内で全球サイズの**仮想アドレス空間と疎ファイル**を使い、
fixture領域だけに値を配置します。全球分をダウンロード・物理保存する処理ではありません。
疎ファイルはTemporaryFileで終了時に除去されます。Docker named volumeへの書き込みはしません。

未配置のゼロを補間に使わないよう、基準側はアクセス範囲を毎回検査します。
ブラウザ側も気象・標高の範囲外はエラーにします。
通常の経度0–360と-180–180は同じ入力として扱いますが、地域fixture自体は日付変更線を跨ぎません。

気象取得時に156メッセージ/時刻が含まれていました。
余分な15メッセージは同じ変数・気圧面の重複で、**全格子のFloat32値が同一**と確認した上で除外しました。
最終的に各時刻141メッセージ（47 × 3）を採用しています。
変数、気圧面、run、forecast hour、単位、格子、欠損、HGTの鉛直順序を検証します。

標高の上流配布版番号は不明です。既存volumeのスナップショットから切り出した
**実際のfixtureのSHA-256**を同一性の基準にしています。
元の約7.47GBファイル全体のハッシュを計算したとは主張しません。
70個の独立点と、基準軌道の全着地判定アクセスでネイティブRuaumokoとの一致を確認しています。

## 自動検証

```text
node --test poc/browser-predictor/tests/predictor.test.js
node poc/browser-predictor/verify-browser.mjs
```

ブラウザ検証にはリポジトリの既存Playwright開発依存関係が必要です。
未導入の場合はリポジトリで npm ci、その後 npx playwright install chromium を実行します。

- 独立PoCの単体テスト10件。
- 42点のU/V補間、標高、下降モデル、fixture/sourceハッシュの照合。
- 破裂・着地・飛行時間の比較。
- 両軌道の点時刻と60秒間隔を合併し、共通UTC時刻に線形補間して位置差を算出。
- trajectory最大/平均誤差は水平距離と高度差を合わせた3次元距離。
  burst/landing errorは水平測地距離で、高度差も別に出力。
- 意図的に軌道をずらしたときに比較が失敗することも確認。
- ブラウザのDedicated Workerが1個だけであることを確認。
- 初回ロード後にPlaywrightでofflineへ切替。
  同じWorkerで100回 + 再度1回計算し、同じ結果・追加要求0件を確認。
- PoCのネットワーク要求はlocalhostの静的ファイルだけ。
  SondeHub、Tawhiri、Custom prediction APIを呼びません。

再実行の詳細結果は results/browser-verification.json、
軌道は results/browser-trajectory.json、画面は results/poc.png に出力します。
results/ はGit管理しません。今回の測定スナップショットだけ
[measurements/chromium-windows.json](measurements/chromium-windows.json) に保存しています。

## PC測定結果

2026-09-11 JSTに測定（UTC記録：2026-09-10T17:01:01.918Z）。
Windows build 26200、AMD Ryzen AI 7 350、論理16CPU、RAM約33.4GB。
Node 24.13.1、Playwright Chromium 151.0.7922.34、headless、1 Worker。

| 項目 | 測定値 |
|---|---:|
| 初回1 trajectory | 14.7ms |
| 同じWorkerで100回 | 206.3ms |
| 100回の平均 | 2.063ms/trajectory |
| 軌道点数 | 146（上昇101、下降45。破裂点は両段階に含む） |
| 気象fixture | 417,924 bytes |
| terrain fixture | 1,385,762 bytes |
| fixture合計 | 1,803,686 bytes |
| 最後の結果JSON | 約22,076 bytes |
| 正確なピークメモリ | 未測定 |
| 風補間の最大絶対差 | 1.0631 × 10^-13 m/s |
| terrain / 下降速度の差 | 0 |
| trajectory最大3次元誤差 | 7.8930 × 10^-8 m |
| trajectory平均3次元誤差 | 3.1212 × 10^-8 m |
| burst水平誤差 | 3.1636 × 10^-8 m |
| landing水平誤差 | 7.1038 × 10^-8 m |
| burst / landing時刻差 | 0秒 / 0秒 |
| オフライン再計算の追加通信 | 0件 |

測定時間はWorker内の計算ループで、fixture取得、初期化、比較処理、メッセージ転送は含みません。
100回は同じ条件・同じデータを繰り返し、最後のtrajectoryだけを保持します。
初回との差にはJIT最適化・ウォームアップが含まれます。
fixtureとJSONのサイズはメモリの構成要素であり、JavaScriptヒープやピークメモリの測定値ではありません。
他PC・モバイル・100種類の異なる入力の性能を保証しません。

基準の着地点：北緯33.64699724432332、東経132.85275829830755、
高度720.5134832954332m、2026-09-10T06:53:14.062500Z。
山地へ着地するケースなので、terrainを使う終端判定も含めて検証しています。

## 基準を再生成する場合（開発者用・任意）

通常のPoC実行にはこの作業は不要です。保存済みreference.jsonだけで比較できます。

リポジトリルートのPowerShellで、Docker Desktop起動後に実行します。

```powershell
$pocPath = (Resolve-Path .\poc\browser-predictor).Path
docker run --rm --network none --mount "type=bind,source=$pocPath,target=/poc" --entrypoint python3 ghcr.io/projecthorus/tawhiri-container@sha256:9714dc04a22f8982d810f3dc6f3a8ca69f84274cc4d8bff47ce52b42f0c1e451 /poc/build-reference.py
```

元のGFS/terrain volumeもインターネットも不要です（imageがローカルにある場合）。
ソース・ネイティブバイナリのハッシュが基準と違えば停止します。
実際にvolume未マウント・network noneでreferenceを再生成できることを確認しています。
更新前後のreference.jsonハッシュ比較は下記最終検証記録も参照してください。

GRIBからの変換も再現する場合のみ、Python環境に
eccodes==2.48.0 と numpy==2.4.6 を用意し、次を実行します。

```text
python poc/browser-predictor/prepare-weather.py poc/browser-predictor/fixtures/source
```

このスクリプトにダウンロード機能はありません。
ユーザーの許可で今回限り取得した元の小地域GRIB計3個（合計237,328 bytes）と、
取得URL・日時・ハッシュを同梱しています。
全球GFS、元の全球DEM、Docker volume、ツールのインストール先はGit管理しません。
バイナリfixtureとcase.jsonのハッシュを基準出力に結び付け、改行はLFへ固定しています。

## ファイル構成と境界

- trajectory-engine.js：標準大気、上昇/下降、RK4、終端探索。
- weather-interpolator.js：元の全球格子を基準にしたcropの補間。
- terrain-sampler.js：Ruaumoko最近傍参照。
- predictor.worker.js：fixture保持、1回/100回の計算と比較。
- compare.js：時刻を揃えた軌道比較。
- app.js / index.html：fixtureロード、Worker通信、数値結果表示。
- benchmark-pool.mjs：同一fixtureを使った1 / 2 / 4 Workerの比較測定。
- serve.mjs：Node標準機能だけの静的サーバー。
- fixtures/：固定入力、実データ、ネイティブ基準出力、基準識別情報。
- build-reference.py：Docker内のオフライン基準生成。
- prepare-weather.py：保存済みGRIBのオフライン変換。
- tests/ / verify-browser.mjs：単体・実ブラウザ検証。

ここまでの節はPhase 0単体PoC時点の記録です。その後、既存UIのproviderとして接続し、
気象パッケージ、IndexedDBへの明示保存、愛媛13条件、自動探索、
Monte Carlo / LHS / Sobol、適応Worker Poolを追加しました。
最新の利用方法と対応範囲は [INTEGRATION.md](INTEGRATION.md) と [BUILDER.md](BUILDER.md) を参照してください。
GFS自動取得、Actions、SharedArrayBuffer、WASMは追加していません。

## 最終検証記録

- npm run check：既存72ファイルの構文検査成功。
- npm test：143件成功（このPoCの10件を含む）。
- npm run test:e2e：20件成功（既存の固定API応答を使う回帰テスト）。
- verify-browser.mjs：実Chromium、1 Worker、1回/100回、オフライン再計算成功。
- 保存GRIBからweather.binとmanifest.jsonを再生成してSHA-256完全一致。
- データvolume未マウント・network noneのDockerでreference.jsonを再生成してSHA-256完全一致。
  詳細は [measurements/regeneration.json](measurements/regeneration.json)。
- 既存の追跡済みファイルの差分は0。追加ファイルはこのPoCディレクトリ内のみ。
- コミット・push・公開は行っていません。

## 限界と次の判断

この結果は「固定したローカルTawhiriの1ケースとの数値互換」を示します。
公開SondeHub、最新Tawhiri、他地域、他DEM、モバイルの検証はしていません。
GFSデコードをTawhiri Downloaderと別々に実行して比較した試験でもありません。
同じecCodesデコード結果のFloat32を、両エンジンへ入力する試験です。

このPhase 0の成功条件は満たしました。本統合を行うには、別途許可のもとで
入力ケースの拡充・provider設計へ進めます。

ライセンスとデータ出典は [NOTICE.md](NOTICE.md) を参照してください。
