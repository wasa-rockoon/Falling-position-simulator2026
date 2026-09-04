# コントリビューションガイド

Falling Position Simulator 2026は、通常予測を維持しながら、愛媛13条件、自動探索、ガス計算、不確実性解析、履歴・再開機能を統合した静的Webアプリです。変更は機能単位に分け、実装、テスト、生成物、文書を同じ意図で更新してください。

詳しい設計は[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、開発・運用手順は[docs/OPERATIONS.md](docs/OPERATIONS.md)、手動確認項目は[docs/MANUAL_CHECKLIST.md](docs/MANUAL_CHECKLIST.md)を参照してください。

## 開発環境

- Node.js 20以上
- npm
- Chromium（Playwright E2E用）
- Windows PowerShell（PWAアイコン・jQuery UI画像を再生成する場合のみ）
- ローカルAPIを使う場合はTawhiriサーバー

初回セットアップ:

```powershell
npm install
npx playwright install chromium
```

ローカル画面を起動します。

```powershell
node cors-proxy.js
```

既定URLは`http://localhost:3100/`です。`cors-proxy.js`はローカル開発専用であり、GitHub Pagesでは実行されません。

## 推奨ワークフロー

1. 作業前に`git status --short`で既存変更を確認する。
2. 一つの目的に必要なファイルだけを変更する。
3. 必要な生成物を再生成する。
4. Nodeテストと影響範囲のE2Eを実行する。
5. `git diff`で意図しない変更や生成物の混入がないか確認する。
6. Pull Requestには目的、変更点、確認結果、UI変更時の画像を記載する。

既存の未コミット変更は他の作業者のものとして扱い、無関係な修正を含めないでください。

## ビルドと生成物

通常ビルド:

```powershell
npm run build
```

これは次を実行します。

1. 正本KMLから`ports.json`を再生成
2. HTMLとローカル資産から`sw.js`を再生成
3. 実行対象JavaScriptの構文検査

個別コマンド:

```powershell
npm run build:data            # ports.json
npm run build:sw              # sw.js
npm run check                 # JavaScript構文検査
npm run build:icons:windows   # PWAアイコン。必要時のみ
npm run build:ui-assets:windows # jQuery UI画像。必要時のみ
```

- `漁船・回収地点位置関係マップ.kml`が支援・回収地点の正本です。`ports.json`を直接編集しないでください。
- `sw.js`は生成ファイルです。アプリシェルを変更したら再生成してください。
- `ports.json`と`sw.js`は実行に必要なためコミット対象です。
- PWAアイコンとjQuery UI画像は通常の`npm run build`では再生成されません。

## テスト

```powershell
npm test            # Node単体・統合テスト
npm run test:e2e    # 固定APIによるChromium E2E
npm run ci          # build、Nodeテスト、E2Eを一括実行
```

E2Eは実際のSondeHub、Open-Meteo、地図タイルへ通信しません。実APIの可用性と予測妥当性は[手動確認チェックリスト](docs/MANUAL_CHECKLIST.md)で確認してください。

## 維持する仕様

- 自動探索の海上率は「下限以上」で合格する。
- 全候補精密モードは、粗探索で不合格でも候補を除外しない。
- 中断は進行中のAPI呼び出しまたは候補・サンプルを保存した境界で反映し、次へ進まない。
- 自動探索と不確実性解析の自動保存・再開を維持する。
- 開始前に論理API要求数、再試行を含む最悪HTTP試行数、概算時間を表示する。
- API接続先はRequestContextへ固定し、非同期処理中に共有グローバルURLを書き換えない。
- `land`、`sea`、`inland_water`、`unknown`を区別し、通信失敗や不明を暗黙の合格・不合格へ変換しない。
- 表示クリアと保存履歴の削除を混同しない。
- 旧設定キー、旧保存地点、旧愛媛履歴の互換読込を壊さない。

## コードレビューの観点

- 通常予測、愛媛13条件、自動探索、不確実性解析の実行状態とAPI予算が干渉していないか。
- 再読み込み、中断、再開、一部完了、完了済み履歴が区別されているか。
- 画面初期化やイベント登録が二重になっていないか。
- 大量処理で同一要求の統合、再試行上限、同時数、最小間隔が維持されているか。
- 地図レイヤー、グラフ、履歴、CSV/KMLが同じRunRecordを参照しているか。
- UI変更がデスクトップ、モバイル、キーボード操作、PWA更新へ影響していないか。
- 利用者向けエラーと技術診断が分離され、URLやログの秘密情報がマスクされているか。

## コミットしないもの

- `node_modules/`
- 生成CSV、ログ、Playwrightレポート、テスト結果
- Office一時ファイル
- Phase 0や一時調査の資料
- 一時スクリプト、パッチ、デバッグ用ファイル
- APIキー、token、個人情報、秘密情報

コミット前に必ず次を確認してください。

```powershell
git status --short
git diff --check
```

## GitHub Pages

アプリ本体は静的ファイルとしてGitHub Pagesへ公開する想定です。公開版ではSondeHubを標準接続先とし、ローカルTawhiriは`node cors-proxy.js`で開いたローカル画面から使用します。

CIはビルドとテストを行う仕組みであり、Pagesへのデプロイとは別です。公開ブランチへマージする前にCI成功を確認し、公開後は実URLで静的資産、Service Worker、SondeHub通常予測を確認してください。
