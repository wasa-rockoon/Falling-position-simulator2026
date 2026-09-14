# 地域GFSパッケージ作成（②）

作成担当者のPCで地域・GFS run・予報時間を指定し、ブラウザ予測用の .wasawx を作ります。
指定地域の風U/V・ジオポテンシャル高度・47気圧面だけを取得します。全球GFSを保存しません。

## 起動と操作

必要環境: このリポジトリ、Node.js 20.3以上、Docker Desktop（Linuxコンテナ / WSL2 backend）。
Pythonの手動インストール、Tawhiriのcloneやbuild、WSLターミナル操作は不要です。

1. Docker Desktopを起動します。
2. リポジトリ直下の start-weather-builder.bat をダブルクリックします。
3. http://127.0.0.1:3101 が開きます。
4. 必要なら標高を含む既存パッケージを選択します。同梱標高は北緯32〜35°・東経131〜135°です。
5. GFSの日付・run（UTC）、南北西東端、開始/終了forecast hourを指定します。
6. 「取得してパッケージを作成」を押します。
7. 完了後「作成したパッケージを保存」を押し、シミュレータの「ブラウザ内計算」へ読み込みます。
8. 終了は起動ウィンドウでCtrl+C。完成ファイルは終了前に保存してください。

初回だけ公式Python Docker imageとecCodes / NumPyのバイナリ配布を取得し、次回から再利用します。
日付は放球日ではなくモデルrunのUTC日付です。例: 00 UTCのf3〜f9は同日12:00〜18:00 JST未満。
初期runは公開遅延を考慮した候補です。未公開・公開期間終了・混雑の場合はエラーを表示し、別runへ自動変更しません。

### 放球予定からの提案

「放球予定から取得条件を提案」に、JSTの放球予定、地点、着地までの見積り時間、各方向への余裕を入力すると、GFS run・forecast hour・0.5度格子の地域範囲を入力欄へ提案します。提案は取得を開始せず、放球条件を `.wasawx` へ保存しません。

提案はGFSの公開遅延を8時間として計算します。予測経路全体を保証するものではないため、風で流される距離を見込んだ余裕と、着地までの長さを指定してください。標高データの範囲外や64MiBを超える条件は提案時に止めます。

生成パッケージにサンプル放球条件は含みません。対応範囲内の日時・地点・高度を手入力してください。
南レク南楽園だけに限定されませんが、全経路が気象と標高の両方の範囲内に必要です。
別地域の標高取得そのものは対象外です。使用可能な標高範囲を超える地域は取得前に止めます。

## 放球高度のエラー

放球高度は海抜高度です。地点変更後も以前の低い高度が残ると、地表以下となって計算できません。

- 「この地点の地表標高を確認」: 使用中の標高を表示し、入力は変更しません。
- 放球高度が使用中DEMの地表以下の場合は、入力値を変更せず、計算開始点だけをDEM地表へ自動的に合わせます。
- 地表以下の場合、エラーに地表標高と入力高度を併記します。

標高は15秒角の格子データであり現地実測値ではありません。
既存のSondeHub / Custom / Localhostを選択した場合は各接続先のデータを使用します。

## 容量・保存場所・中止

- 最大10度×10度、0.5度刻み。forecast hourは0〜192、3時間刻み、最大72時間幅です。
- 最大64MiBのパッケージ。取得前に非圧縮サイズを見積もります。
- 気象の最後の時刻・北端・東端は補間のため利用できません。
- NOAAへの取得は直列で、取得終了から次の取得まで最低10秒。無制限の再試行はありません。
- GRIBは .weather-builder/jobs/ に一時保存し、成功・失敗・中止時に削除します。
- 変換コンテナは作業ごとに削除します。Tawhiriサーバーは起動しません。
- 変換依存だけをDocker volume「wasa-weather-builder-python312-v1」に保持します。
  検証PCで依存ファイル約137MiB。Docker imageと管理領域は別です。
- 完成データはサーバーのメモリに保持し、保存操作でダウンロードします。新規作成・標高変更・終了で保持分は破棄されます。
- 中止はその作成ジョブの通信とコンテナだけを停止します。
- 強制終了・電源断では一時ファイルが残る場合があります。ファイル削除とDocker仮想ディスクの自動縮小は別です。

## GitHub Pagesとの関係

    作成担当PC: Node.js → NOAA地域GFS → Docker/ecCodesで変換
                              ＋ 既存標高を切り出し
                                       ↓
                                    .wasawx
                                       ↓
    GitHub Pagesの予測画面 → ファイル読込 → Web Workerで飛行計算

予測する利用者にはNode.jsやDockerは不要です。PagesはHTML/CSS/JSの静的配信なので、
今回の作成サーバー自体はPages上で実行しません。Pagesのサブパス相当の予測画面はテスト済みです。

Browser Predictorは標準フライトの通常予測に加え、愛媛13条件、不確実性解析（Monte Carlo / Latin Hypercube / Sobol）、自動探索の粗探索・13条件精密探索で使用できます。通常予測は1個のDedicated Workerで実行し、複数要求では端末とデータ容量に応じて2〜4 Workerへ遅延拡張します。登録地点とDEMの標高差はWorker内で吸収します。

### Worker Pool事前測定

同じ1.80MiBのfixtureで200 trajectoryを計算した結果、1 Workerは561.7ms、2 Workerは291.2ms、4 Workerは158.1msでした。4 Workerで約3.55倍まで短縮しましたが、各Workerが保持するfixture下限は合計1.80MiB、3.61MiB、7.21MiBへ増えます。測定記録は `measurements/worker-pool.json` です。

通常予測1本ではWorkerを増やさず、複数要求が待機したときだけ増やす方針です。モバイル、端末メモリが少ない場合、大きいパッケージでは1〜2 Workerへ抑えます。GitHub PagesではCOOP/COEPレスポンスヘッダーを自由に設定できないため、SharedArrayBufferを前提にしません。

将来は作成をGitHub Actions等で定期実行して、パッケージを静的配信できます。
自動化・データ配信・本番デプロイは今回行っていません。
Pagesには公開サイト1GB、月間転送量100GBのソフト上限があるため、全runを無期限に蓄積する設計にはしません。
公開対象に .weather-builder、巨大な出力、開発用依存関係を含めず、アプリと必要な静的データを選びます。

## 構造と検証

scripts/weather-builder/ 内:

- plan.cjs: 入力・サイズ検証、NOAA URL、標高切り出し
- build.cjs: Docker準備、直列取得、変換、パッケージ生成、一時ファイル削除
- convert.py: run・時刻・格子・単位・気圧面・重複を検証してFloat32へ変換
- server.cjs: 127.0.0.1限定、Host/Origin/token検査、1ジョブ、中止
- index.html / app.js: 作成画面
- verify-package.cjs: 作成済みファイルを実Workerで計算・オフライン再計算する開発用検証

Python imageはdigest固定。ecCodes Python 2.48.0 / library 2.48.2 / NumPy 2.4.6を使用します。
Phase 0の保存GRIBを新変換器で変換し、weather.binのSHA-256完全一致を確認しました。
新規取得分でTawhiriとの追加の1m一致検証を行ったという意味ではありません。

実データ検証: GFS 2026-09-12 00 UTC、f3/f6/f9、北緯32〜35°・東経131〜135°。
出力1,497,348 bytes、実Workerで147点を計算し、オフライン再計算も一致。外部飛行予測APIは0件。
作業用GRIBとコンテナが残らないことも確認しました。
構文チェック68ファイル、Nodeテスト159件、ブラウザテスト28件が成功しています。

## 確認した公式資料

- [NOAA GRIB Filter](https://nomads.ncep.noaa.gov/info.php?page=gribfilter): 地域切り出しと10秒の取得間隔
- [NOAA 0.5度GFS](https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_0p50)
- [ecCodesの配布仕様](https://pypi.org/project/eccodes/2.48.0/)
- [公式Python image](https://hub.docker.com/_/python)
- [GitHub Pagesの仕様](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Pagesの制限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
