# Recovering instance jobs

`GET /api/v1/jobs` accepts optional `serverId=<uuid>` and `activeOnly=true` filters in addition to `limit` and `cursor`. Authentication, setup, origin and paging behavior are unchanged. The response stays `{items:Job[],nextCursor:string|null}`. Invalid UUIDs/booleans and unknown parameters return 400 `validation`; UUID case is normalized. Server records need not still exist, so deleted-instance history remains accessible.

Filters run in SQLite before keyset pagination. Keep the same filters for subsequent cursor pages. `activeOnly` means `queued` or `running`; active lists naturally shrink as work completes and are not a transactionally frozen history. A new server/created-time expression index supports scoped lookups. These are additive query parameters; existing clients need no migration.

For a returning server page, request `/api/v1/jobs?serverId=<id>&activeOnly=true&limit=200` and reconnect to the returned relevant jobs using the existing `/jobs/{id}` endpoint. An empty response means no active job was observed, not that installation succeeded. The saved server installation/runtime state and archive list remain authoritative after completion. Never automatically resubmit an install, restart, export or delete while recovering state. A server page should link to Activity for failures and historical details.

The backend's global four-active-job limit bounds active recovery results today. Query active jobs after navigation/visibility changes and poll only while useful, with cancellation on navigation and no overlapping discovery requests. Preserve stream/poll cleanup, pending properties flush, unsaved file navigation protection and stopped-only mutation guards. An install can finish between discovery and polling; treat its terminal response normally. After an interrupted manager restart, the job reports `failed` with `job.interrupted`; do not imply it resumed automatically.

The server recovery UI and per-instance Activity tab use this contract. The existing Activity page's historical filters remain client-side over loaded records unless the UI explicitly changes their semantics and labels.
