# 固定fixtureによる追加5ケース検証

2026-09-12に、Phase 0と同じ気象・地表標高・固定Tawhiriイメージで検証しました。
既存アプリへの統合、新しいデータ取得、エンジンの変更は行っていません。

## 対象

各ケースは元のcase.jsonから、表の項目だけを変更しています（識別用idを除く）。
元のケースとfixtureはハッシュ照合で変更がないことを確認しました。

| ID | 変更した条件 | 着地点の水平差 | 軌道の最大3次元差 | 破裂/着地時刻差 |
|---|---|---:|---:|---:|
| launch-early | 放球03:15 UTC | 3.4214e-8 m | 3.9545e-8 m | 0 / 0秒 |
| launch-late | 放球06:15 UTC | 1.5786e-8 m | 2.6460e-8 m | 0 / 0秒 |
| ascent-slow | 上昇4 m/s | 0 m | 2.8973e-8 m | 0 / 0秒 |
| descent-fast | 下降7 m/s | 0 m | 3.1636e-8 m | 0 / 0秒 |
| burst-high | 破裂35,000m | 3.6859e-8 m | 4.7456e-8 m | 0 / 0秒 |

5ケースとも1m / 1sの基準を満たしました。U/V補間の最大絶対差は
1.6343e-13 m/s、地表標高参照の差は0でした。
誤差0はこの実行での数値一致を示し、実際の飛行に対する誤差0を意味しません。

## エラー検証

- 放球08:30 UTC：飛行中に09:00の気象範囲末端を越えると、気象不足エラー。
- 北緯29°：気象fixture外のため、気象範囲外エラー。
- 北緯31°：気象範囲内・地表標高fixture外のため、下降中に標高範囲外エラー。
- エラー後、同じWorkerで元の正常ケースを再計算できることも確認。

範囲外の3ケースには有効なTawhiri基準軌道はありません。
数値一致試験とは分け、エラーの種類と正常計算への復帰を検証しています。

## 再実行

リポジトリルートで実行します。

```text
node --test poc/browser-predictor/tests/predictor.test.js poc/browser-predictor/tests/validation-cases.test.js
node poc/browser-predictor/verify-validation.mjs
```

ブラウザ検証には既存PlaywrightのChromiumが必要です。Dockerは不要です。
verify-validation.mjsは検証用の空ページで**既存のpredictor.worker.jsそのもの**を1個起動します。
データを最初に読み込み、ブラウザをofflineへ切り替えた後に全ケースを実行します。
計算間で同じWorkerを再利用し、変更するのは入力条件と対応する基準出力です。
Workerへの所有権移動のため小さいバッファをコピーしますが、再ダウンロードはしません。

ブラウザ検証結果：
- 追加5ケース成功、範囲外3ケース成功、エラー後の復帰成功。
- Dedicated Worker 1個、読み込み後の追加通信0件。
- 実Chromium 151.0.7922.34、Windows、headless。
- 詳細：[measurements/validation-cases.json](measurements/validation-cases.json)。
- 再実行結果：results/validation-cases.json（Git管理対象外）。
- NodeテストはPoC内18件、リポジトリ全体143件が成功。

## 基準出力の再現（任意）

固定イメージがローカルにあり、Docker Desktopが起動している場合：

```text
node poc/browser-predictor/regenerate-validation.mjs --check
```

5ケースの基準を再生成し、保存済みJSONとバイト単位で比較します。
実際に全5ケースの完全一致を確認しています。
Dockerはnetwork none、元の気象/標高volumeもマウントしません。
新しいイメージのpullやデータ取得はしません。

入力を意図的に変更して基準を更新する開発作業では、--checkを省略します。
これはfixtures/validation-references/以下を書き換えます。
元のPhase 0のreference.jsonは変更しません。

## 変更した範囲

- build-reference.py：固定入力・出力ファイルを指定する引数を追加。
- fixtures/validation-suite.json：5ケースと範囲外3ケースの定義。
- fixtures/validation-cases/：完全な固定入力5個。
- fixtures/validation-references/：対応するネイティブTawhiri出力5個。
- tests/validation-cases.test.js：追加8テスト。
- regenerate-validation.mjs / verify-validation.mjs：再生成と実ブラウザ検証。
- measurements/validation-cases.json：今回の測定記録。
- README.md / VALIDATION.md：入口と記録。

本体UI、数値エンジン、Worker本体、既存の固定fixtureは変更していません。
着手前に存在した別作業の追跡済みファイルもSHA-256で変更なしを確認しています。
コミット・pushは行っていません。

この段階は同じGFS run・同じ地域内での条件変更の検証です。
別run・別地域、運用中の気象更新、既存UIへの統合は今後の別作業です。
