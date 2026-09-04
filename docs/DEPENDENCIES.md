# 依存関係とライセンス

本体コードはGPLv3です。ブラウザ実行時のライブラリはPWAのオフライン起動と再現性のためリポジトリへ同梱し、`vendor-dependencies.json` にバージョン、ライセンス、配布元、SHA-256を固定しています。

## ブラウザ実行時

| ライブラリ | バージョン | ライセンス | 用途 |
|---|---:|---|---|
| jQuery | 3.3.1 | MIT | 既存DOM・イベント互換 |
| jQuery UI | 1.12.1 | MIT | 既存UIウィジェット |
| Leaflet | 1.3.1 | BSD-2-Clause | 地図・レイヤー |
| Moment.js | 2.24.0 | MIT | 日時変換 |
| Chart.js | 4.4.1 | MIT | 高度・風速グラフ |
| html2canvas | 1.4.1 | MIT | 結果画像出力 |
| Tipsy | legacy snapshot | upstream MIT、再配布前に要確認 | 既存ツールチップ |
| Jookie | 1.0 | MIT | 旧保存地点Cookie |

`js/jquery.form.js` 2.43（MIT OR GPL-2.0-or-later）はリポジトリに残っていますが実行時には読み込みません。

同梱物を更新するときは、機能変更と分けて行い、`vendor-dependencies.json` のSHA-256、バージョン、ライセンス、runtimeフラグを同時に更新してください。

## 開発時

| パッケージ | バージョン | ライセンス | 用途 |
|---|---:|---|---|
| `@playwright/test` | 1.62.1 | Apache-2.0 | Chromium E2E |

Node.jsの実行時依存はありません。Playwrightとブラウザバイナリは開発・CIでのみ使用し、`node_modules/` はコミットしません。正確な解決バージョンとintegrityは `package-lock.json` を正本とします。

## 地理データ

| データ | 利用条件 | 用途 |
|---|---|---|
| Natural Earth `ne_10m_land` 日本周辺クリップ | Public domain | 陸域判定 |
| 国土数値情報 湖沼データ W09-05 | 国土数値情報利用約款 | 内水面判定 |

国土数値情報は「国土数値情報（湖沼データ、2005年）国土交通省を加工して作成」です。配布元、利用条件URL、元ZIPと生成GeoJSONのSHA-256、加工条件は `data/land-sea-datasets.json` に記録しています。

## 外部サービス

SondeHub/Tawhiri、Open-Meteo、各地図タイルは同梱依存ではありません。利用時は各サービスの規約、レート制限、帰属表示に従ってください。E2Eではこれらへ通信せず固定レスポンスを使用します。

## 更新確認

```powershell
npm ci
npm audit
npm test
npm run test:e2e
```

ブラウザ同梱ライブラリは `npm audit` の対象外なので、`vendor-dependencies.json` の配布元を個別に確認します。特に古いjQuery系・Leaflet系の更新はCookie、イベント、地図描画への影響が大きいため、専用変更として全E2Eと手動確認を実施してください。
