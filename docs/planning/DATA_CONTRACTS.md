# Phase 0: 共通データ契約

この文書はPhase 1以降の実装契約です。既存の保存データは直ちに削除せず、アダプターで読み込みながら段階移行します。

## 原則

- 保存形式には必ず `schemaVersion` を持たせる。
- API URL、予算、日時、乱数シードは実行開始時に固定する。
- 描画用Leaflet/Chartオブジェクト、Blob URL、DOM要素は保存しない。
- CSV/KMLは保存済みの構造化データから再生成する。
- `null`、`unknown`、通信失敗を0、陸、海へ暗黙変換しない。
- 自動保存は廃止せず、再開可能な安定境界で実行する。

## RunRecord v1

すべての通常予測、愛媛比較、自動探索、不確実性解析を共通の実行記録として扱います。

```javascript
{
  schemaVersion: 1,
  id: "run_<uuid>",
  type: "single | ehime_ensemble | auto_search | uncertainty",
  status: "draft | running | pause_requested | paused | completed | partial | failed | cancelled",
  title: "利用者向け表示名",
  createdAt: "ISO-8601 UTC",
  updatedAt: "ISO-8601 UTC",
  startedAt: "ISO-8601 UTC | null",
  finishedAt: "ISO-8601 UTC | null",

  input: {
    launch: {
      latitude: 0,
      longitude: 0,
      altitudeM: 0,
      datetimeUtc: "ISO-8601 UTC"
    },
    flight: {
      ascentRateMps: 0,
      descentRateMps: 0,
      burstAltitudeM: 0,
      profileId: "standard"
    },
    api: {
      endpointId: "sondehub | local",
      resolvedBaseUrl: "実行開始時に固定したURL",
      timeoutMs: 0,
      maxHttpAttempts: 0,
      concurrency: 0,
      minIntervalMs: 0
    },
    feature: {}
  },

  progress: {
    completedUnits: 0,
    totalUnits: 0,
    currentLabel: "",
    httpAttempts: 0,
    cacheHits: 0,
    retryCount: 0,
    requestedAction: "none | pause | cancel"
  },

  output: {
    trajectories: [],
    landings: [],
    metrics: {},
    candidates: [],
    warnings: []
  },

  provenance: {
    appCommit: "",
    predictorSource: "tawhiri | sondehub",
    landSeaClassifierVersion: "",
    randomSeed: null
  },

  error: null
}
```

`feature` の内容はtypeごとに異なります。

- `single`: 通常予測固有の表示設定。
- `ehime_ensemble`: Variant定義、完了Variant、比較指標。
- `auto_search`: 期間、間隔、地点、探索モード、下限・上限条件、粗探索結果。
- `uncertainty`: サンプラー、分布、シード、最小/最大サンプル、停止判定。

## 状態遷移

```text
draft → running → completed
             ├→ partial
             ├→ failed
             └→ pause_requested → paused → running
draft/running/paused → cancelled
```

- 中断ボタンは即座に `pause_requested` を保存する。
- 進行中の1リクエスト、1Variant、1候補、または1サンプルを完了した境界で `paused` にする。
- `partial` は上限到達や一部失敗があっても有用な結果を保存できた状態とする。
- `failed` は結果を構成できない状態で、エラーと診断情報を保持する。
- 完了済みRunを直接再開しない。再実行時は新しいidを作り、`sourceRunId` で元Runへ関連付ける。

## RequestContext

通信処理へグローバル値を直接読ませず、すべての実行が次を受け取ります。

```javascript
{
  runId: "",
  endpointId: "",
  resolvedBaseUrl: "",
  timeoutMs: 30000,
  maxHttpAttempts: 100,
  concurrency: 1,
  minIntervalMs: 0,
  pauseController: {},
  diagnostics: {},
  cachePolicy: {
    ttlMs: 10800000
  }
}
```

- `fetch` はWindowへ正しく束縛した関数、または明示的に注入した実装だけを使う。
- HTTP再試行も `maxHttpAttempts` に数える。
- 上限到達後は新しいHTTP試行を開始しない。
- キャッシュヒットはHTTP試行数へ数えず、別の指標にする。
- URLはRun開始後に共有グローバルへ書き戻さない。

## TrajectorySeries

高度・風速グラフ、地図、CSV/KMLが同じ系列を参照します。

```javascript
{
  id: "series_<uuid>",
  runId: "run_<uuid>",
  variantId: "BASE | ASC- | ... | null",
  label: "BASE",
  color: "#RRGGBB",
  visible: true,
  points: [
    {
      timeUtc: "ISO-8601 UTC",
      latitude: 0,
      longitude: 0,
      altitudeM: 0,
      horizontalSpeedMps: null,
      verticalSpeedMps: null,
      phase: "ascent | descent"
    }
  ]
}
```

- 地図、表、グラフで同じ `id`、`label`、`color` を使う。
- 速度がAPIから得られない場合は `null` とし、推定した場合は由来をmetricsへ記録する。
- 比較画面は最大5系列を同時表示し、それ以上は利用者に入れ替えを求める。

## LandingResultとLandSeaResult

```javascript
{
  seriesId: "series_<uuid>",
  latitude: 0,
  longitude: 0,
  timeUtc: "ISO-8601 UTC | null",
  nearestSupportPoint: {
    id: "",
    distanceKm: 0
  },
  landSea: {
    classification: "land | sea | inland_water | unknown",
    confidence: "high | medium | low | unknown",
    source: "local_dataset | external_detail | unavailable",
    coastDistanceKm: null,
    dataVersion: "",
    reason: ""
  }
}
```

- `inland_water` は海上率のseaに含めない。
- `unknown` はseaにもlandにも含めず、unknown率として表示する。
- 自動探索の海上率条件は下限値以上で合格とする。
- unknownを含む場合は、海上率を満たしても最終表示を「要確認」にする。
- 外部詳細判定を使った場合も、元のローカル判定と外部判定を診断ログへ残す。

## HistoryEntry

履歴一覧はRunRecord全体を複製せず、検索用の索引を持ちます。

```javascript
{
  schemaVersion: 1,
  runId: "run_<uuid>",
  type: "single | ehime_ensemble | auto_search | uncertainty",
  status: "completed | partial | failed | paused | cancelled",
  title: "",
  launchDatetimeUtc: "",
  launchPointLabel: "",
  updatedAt: "",
  pinned: false,
  summary: {
    landingCount: 0,
    seaRate: null,
    unknownRate: null,
    nearestSupportDistanceKm: null
  }
}
```

既定保持方針は次の通りです。

- 進行中またはpausedのRunは自動削除しない。
- 完了履歴は端末内で直近50件を保持する。
- pinした履歴は自動削除しない。
- 上限超過時はpinされていない古い完了履歴から削除する。
- 削除は履歴UIから確認後に行い、実行中Runを削除できないようにする。

## 保存先と所有者

| データ | 保存先 | 所有モジュール |
|---|---|---|
| RunRecord本体 | IndexedDB | `RunRepository` |
| HistoryEntry | IndexedDB | `RunRepository` |
| APIキャッシュ | IndexedDB + メモリ | `PredictionApiClient` |
| 前回フォーム・プリセット | localStorage | `SettingsRepository` |
| テーマ・サイドバー | localStorage | `AppShell` |
| 旧保存地点Cookie | Cookie | 移行アダプター |
| Leaflet/Chart表示状態 | ページ内メモリ | `MapLayerRegistry` / `ChartController` |

UIから `localStorage`、`indexedDB`、Cookieを直接操作しません。保存は各Repositoryを経由します。

## 自動保存境界

| Run種別 | 保存する境界 |
|---|---|
| single | API結果の正規化完了時 |
| ehime_ensemble | 1Variantの正規化完了時 |
| auto_search | 気象取得完了、粗探索1候補完了、精密探索1候補完了時 |
| uncertainty | 1サンプル完了時。描画だけの変更では保存しない |

保存失敗時も計算結果をメモリから直ちに破棄せず、診断へエラーを出してCSV/KML出力の機会を残します。

## 既存データ移行

1. 既存localStorage、Cookie、`pred-job-store.js` のsnapshotを読み取り専用アダプターで検出する。
2. 変換可能なデータをRunRecord v1へコピーする。
3. 変換元キーと変換日時をmigration記録へ保存する。
4. 変換後も旧データを自動削除しない。
5. 1リリース以上の互換期間と手動確認後にのみ旧書込みを停止する。
6. 不明な旧データは破棄せず、診断に「移行対象外」と表示する。

## エラーと診断

共通エラーは次を持ちます。

```javascript
{
  code: "PREDICTION_HTTP_ERROR",
  userMessage: "予測APIへ接続できませんでした。",
  technicalMessage: "",
  retryable: true,
  phase: "prediction | weather | land_sea | persistence | rendering",
  runId: "",
  timestamp: "ISO-8601 UTC",
  cause: {}
}
```

利用者向け通知は `userMessage` を表示し、診断ドロワーで技術情報、HTTP試行、URL種別、キャッシュ、再試行を確認できるようにします。秘密情報やレスポンス本文全体は保存しません。
