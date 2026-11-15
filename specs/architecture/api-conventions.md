# API conventions

Owned by `chunkyard-api`. Applies to every endpoint in every phase.

## REST

| Rule | Detail |
|---|---|
| Base path | `/api/v1`. Breaking changes → `/api/v2`; additive changes don't bump. |
| Format | JSON, `camelCase` fields (`#[serde(rename_all = "camelCase")]` on DTOs). |
| IDs | Path params are entity IDs (`/servers/{serverId}`), never slugs. |
| Timestamps | RFC 3339 strings in UTC in JSON (`2026-11-11T10:00:00.123Z`). |
| Create | `POST /collection` → `201` + body + `Location`. Async creates → `202` + `{ job }`. |
| Update | `PATCH` with partial body (absent = unchanged, `null` = clear where nullable). Full replace (`PUT`) only for documents (`server.properties`, file contents). |
| Delete | `204` when synchronous; **`202 { job }`** when deletion is a job (servers, backups on remote targets, worlds). The resource is hidden from lists immediately and the job removes it. |
| Actions | `POST /resource/{id}/<verb>` (`/servers/{id}/start`). Return `202` when the effect is async. |
| Lists | `GET /collection?limit=50&cursor=<opaque>` → `{ items: [...], nextCursor: string|null }`. Max limit 200. Small bounded lists (e.g. Java runtimes) return `{ items }` without paging. |
| Filtering | Explicit query params (`?serverId=&action=`); no generic query language. |
| Concurrency | Documents (properties, files, settings) return `ETag`; writes accept `If-Match` → `412` on mismatch. |
| Idempotency | `Idempotency-Key` header honoured on job-creating POSTs (24 h, per user). |
| Errors | `application/problem+json` (see [errors-and-logging.md](errors-and-logging.md)). |
| Content limits | JSON bodies ≤ 1 MiB; file writes via editor ≤ 5 MiB; uploads use the chunked protocol (phase 2). |

## OpenAPI and client generation

1. Handlers annotated with `#[utoipa::path(...)]`; DTOs derive `ToSchema`. Routes registered with `utoipa_axum::router::OpenApiRouter` so path list and router cannot drift.
2. `mcm openapi > web/src/lib/api/openapi.json` (CLI subcommand, no server start).
3. `pnpm --dir web gen:api` runs `openapi-typescript openapi.json -o src/lib/api/schema.d.ts`.
4. CI fails if regenerated files differ from committed (`git diff --exit-code`).
5. Swagger UI is **not** embedded; `GET /api/v1/openapi.json` serves the spec (authenticated).
6. WS message types are included in the OpenAPI document as components (`WsClientMsg`, `WsServerMsg`) via a dummy registration, so TS gets them from the same pipeline.

## WebSocket

Single multiplexed socket per browser tab: `GET /api/v1/ws` (upgrade). Auth via the session cookie (browser) or `Authorization: Bearer` (API clients). `Origin` must match configured `public_url` origin(s).

### Envelope

```jsonc
// client → server
{ "op": "subscribe",   "id": 1, "topic": "console:<serverId>", "epoch": "<mcm run id>", "sinceSeq": 1200 }
{ "op": "unsubscribe", "id": 2, "topic": "console:<serverId>" }
{ "op": "command",     "id": 3, "serverId": "<id>", "line": "say hi" }   // phase 1
{ "op": "ping",        "id": 4 }

// server → client
{ "op": "ack",   "id": 1 }                                  // or
{ "op": "error", "id": 1, "problem": { ...problem+json... } }
{ "op": "event", "topic": "console:<id>", "data": { ... } }
{ "op": "pong",  "id": 4 }
```

### Topics (cumulative)

| Topic | Payload `data` | Permission | Phase |
|---|---|---|---|
| `server:<id>` | `{ type: "status", status }`; later additive payload types `schedule_run`, `maintenance` (P6), `exposure` (P7) | `server.view` | 1 |
| `servers` | status changes for all visible servers | — (filtered) | 1 |
| `console:<id>` | `{ type: "lines", lines: ConsoleLine[] }` / `{ type: "lagged", skipped }` / `{ type: "reset" }` | `console.read` | 1 |
| `jobs` | `{ type: "job", job }` (only jobs the user can see) | — | 0 |
| `metrics:<id>` | `{ type: "sample", sample }` on every sample (default 10 s) | `server.view` | 5 |
| `host` | host CPU/RAM/disk samples | admin | 5 |
| `players:<id>` | `{ type: "players", online, max, list }` | `server.view` | 5 |
| `network` | router/UPnP status (P7), relay status (P9) | `proxy.manage` / admin | 7 |
| `notifications` | in-app toasts for the user | — | 8 |

### Behaviour

- Server batches console lines: flush every 50 ms or 256 lines.
- Subscribing with `{epoch, sinceSeq}` replays from the ring. If `epoch` differs from the current mcm run id (mcm restarted) or `sinceSeq` was evicted, the server sends `{type:"reset", epoch}` followed by the full ring. The `ack` for every console subscribe carries the current `epoch`.
- Heartbeat: server sends WS ping every 20 s; connection closed after 60 s of silence.
- Per-connection outbound queue 1024 messages; overflow → for console, drop & send `lagged`; for others, close with code 1013 and let the client reconnect.
- Permission revocation (P8) closes affected subscriptions with an `error` frame.
- Client: exponential reconnect (0.5 s → 10 s, jitter), resubscribes with last seen `{epoch, seq}`.
- Server create/update contract (additive `source.kind`, `{server, warnings}` responses, PATCH validation table): [server-api.md](server-api.md).

## Pagination cursor

Opaque base64url of `(sort_key, id)`; never parsed by clients.

## Rate limiting

`tower_governor`-style limiter keyed by IP for unauthenticated routes (`/auth/*`: 10/min), by principal for authenticated (600/min default). Exceed → `429` problem with `Retry-After`.

## Health

- `GET /healthz` (no auth): `200 {"status":"ok"}` once DB is reachable.
- `GET /api/v1/system/info` (auth): version, git sha, uptime, data dir usage, platform, feature flags.
