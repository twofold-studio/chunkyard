# Phase 5 — API, WebSocket, migration

Conventions: [api-conventions.md](../../architecture/api-conventions.md). Handlers in `api/src/routes/{metrics,players,host,prometheus}.rs`.

## DTOs

```ts
interface ServerSample { ts: string; cpuPct: number | null; rssMb: number | null; diskMb: number | null;
  players: number | null; tps: number | null; mspt: number | null }
interface MetricsSnapshot extends ServerSample {
  serverId: string; state: ServerState; uptimeS: number | null; startedAt: string | null;
  memoryMaxMb: number;                 // configured -Xmx, reference line
  hostCores: number; diskMeasuredAt: string | null; diskApprox: boolean;
  playersMax: number | null; playersSource: "management" | "rcon" | "slp" | "query" | null;
  rcon: "disabled" | "connecting" | "connected" | "auth_failed" | "unavailable";
  rconExposure: "loopback" | "public" | null;          // null when RCON disabled (P5-FR-19)
  management: "unsupported" | "connecting" | "connected" | "auth_failed" | "unavailable";
  tpsSource: "spark" | "paper" | "vanilla_tick" | "forge" | "neoforge" | null;  // null = unsupported
}
interface HostSample { ts: string; cpuPct: number; memUsedPct: number; diskUsedPct: number;
  load1: number; load5: number; load15: number; cores: number;
  memUsedBytes?: number; memTotalBytes?: number; swapUsedBytes?: number;      // admin only
  diskUsedBytes?: number; diskTotalBytes?: number; mcmRssBytes?: number }       // admin only
interface OnlinePlayer { name: string; uuid: string | null; joinedAt: string | null; sessionS: number | null }
interface PlayerSession { id: number; name: string; uuid: string | null; joinedAt: string; leftAt: string | null; durationS: number | null }
```

## Endpoints

| Method | Path | Perm | Query / body | Response |
|---|---|---|---|---|
| GET | `/servers/{id}/metrics` | `server.view` | — | `MetricsSnapshot` |
| GET | `/servers/{id}/metrics/history` | `server.view` | `from` (RFC 3339, default now−24h), `to` (default now), `metrics` (csv subset of `cpuPct,rssMb,diskMb,players,tps,mspt`), `maxPoints` (≤ 2000, default 720), `resolution?` (`10s`/`1m`/`1h`, overrides auto) | `{ resolution: "10s"|"1m"|"1h", points: ServerSample[] }` (gaps as null-valued points) |
| GET | `/servers/{id}/availability` | `server.view` | `windows` (csv of `24h,7d,30d`, default all) | `{ items: [{ window, availabilityPct: number | null, runningS, crashedS, crashes }] }` |
| GET | `/servers/{id}/state-history` | `server.view` | `from`, `to`, `cursor`, `limit` | `{ items: [{ ts, state, reason }], nextCursor }` |
| GET | `/servers/{id}/players` | `server.view` | — | `{ online: OnlinePlayer[], max: number | null, source, partial: boolean }` |
| GET | `/servers/{id}/players/sessions` | `server.view` | `from?, to?, name?, cursor?, limit?` | `{ items: PlayerSession[], nextCursor }` |
| GET | `/servers/{id}/players/top` | `server.view` | `from`, `to`, `limit ≤ 50` | `{ items: [{ name, uuid, playtimeS, sessions }] }` |
| GET | `/servers/metrics/summary` | (filtered by `server.view`) | — | `{ items: MetricsSnapshot[] }` — dashboard cards in one call |
| GET | `/host/metrics` | authenticated | — | `HostSample` (absolute fields admin-only) |
| GET | `/host/metrics/history` | authenticated | `from, to, maxPoints` | `{ resolution, points: HostSample[] }` |
| PATCH | `/servers/{id}` (extended) | `server.settings` | `{ rconDisabled: boolean }` | `200 { server, warnings }` (`restart_required`) — field added to the [server-api.md](../../architecture/server-api.md) validation table by this phase |
| GET | `/metrics` (root, not `/api/v1`) | token with global scope `metrics.read` | — | Prometheus text ([collection-reference.md](collection-reference.md#prometheus-exposition)); `404` when disabled |

Validation: `from < to`, range ≤ 400 days, `maxPoints` 10–2000 → `422 validation`.

## WebSocket topics

| Topic | Payload `data` | Cadence | Perm |
|---|---|---|---|
| `metrics:<serverId>` | `{ type: "sample", sample: MetricsSnapshot }` | each sample (default 10 s) | `server.view` |
| `players:<serverId>` | `{ type: "players", online: OnlinePlayer[], max, source, partial }` | on change + every 60 s | `server.view` |
| `players:<serverId>` | `{ type: "joined" | "left", player: OnlinePlayer }` | on console join/leave | `server.view` |
| `host` | `{ type: "sample", sample: HostSample }` | each sample | authenticated (absolute fields admin-only) |

Subscribing to `metrics:<id>` immediately sends the latest snapshot (no wait for next tick).

## Events (`chunkyard_core::events::Event`)

`MetricsSampled { server_id, sample }` (internal, high-frequency, not forwarded to notifier), `PlayersChanged { server_id, online }`, `PlayerJoined { server_id, name, uuid }`, `PlayerLeft { server_id, name, session_s }`, `RconStateChanged { server_id, state }`, `RconAuthFailed { server_id }`, `ManagementStateChanged { server_id, state }`.

## Config additions (`[metrics]`, `mcm_metrics::MetricsConfig`, composed by `chunkyard-config`)

```toml
[metrics]
sample_interval_s = 10
tps_interval_s = 30
disk_walk_interval_s = 300
prometheus = false
player_session_retention_days = 400
max_concurrent_probes = 16
```

## Auth additions

Uses the global token scope `metrics.read` defined in [auth.md](../../architecture/auth.md#permission-catalog-per-server) (allows only `GET /metrics`). Before P8, an admin's `["*"]` token is also accepted; from P8, `*` must be combined with `admin`.

## Migration `crates/db/migrations/<NNNN>_p5_metrics.sql`

Number assigned at merge time. Extends the [data-model.md](../../architecture/data-model.md#phase-5--metrics) sketch with max columns, state history and management-protocol columns. Repos: `MetricRepo`, `PlayerSessionRepo`, `StateHistoryRepo` (traits in `chunkyard-core`, impls in `chunkyard-db`).

```sql
CREATE TABLE metric_samples (
  server_id TEXT NOT NULL,                 -- server id or 'host'; no FK (write path); service cascades delete
  resolution INTEGER NOT NULL CHECK (resolution IN (10, 60, 3600)),
  ts INTEGER NOT NULL,                     -- bucket start, unix ms
  cpu_pct REAL, rss_mb REAL, rss_max_mb REAL, disk_mb REAL,
  players INTEGER, tps REAL, mspt REAL, mspt_max REAL,
  PRIMARY KEY (server_id, resolution, ts)
) WITHOUT ROWID;

CREATE TABLE player_sessions (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL, player_uuid TEXT,
  joined_at INTEGER NOT NULL, left_at INTEGER,
  close_reason TEXT CHECK (close_reason IN ('left','server_stopped','reconciled','mcm_restart'))
);
CREATE INDEX player_sessions_server_joined ON player_sessions(server_id, joined_at);
CREATE INDEX player_sessions_open ON player_sessions(server_id) WHERE left_at IS NULL;

CREATE TABLE server_state_history (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  state TEXT NOT NULL,                     -- stopped|starting|running|stopping|crashed|installing
  reason TEXT                              -- requested|crash|crash_loop|mcm_shutdown|...
);
CREATE INDEX server_state_history_server_ts ON server_state_history(server_id, ts);

-- rcon_port / rcon_password_enc exist since P1 (unused until now)
ALTER TABLE servers ADD COLUMN rcon_disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN management_port INTEGER;
ALTER TABLE servers ADD COLUMN management_secret_enc BLOB;   -- AAD "servers.management_secret_enc:<id>"
```

`server_state_history` is written by a subscriber to `ServerStatusChanged` (in `chunkyard-metrics`, via `StateHistoryRepo`), not by `chunkyard-process`, preserving the crate graph. Retention: 400 days.

## Error codes

| Code | Status | When |
|---|---|---|
| `validation` | 422 | Bad range/maxPoints/metrics list |
| `server.not_found` | 404 | Unknown or invisible server |
| `metrics.disabled` | 404 | `/metrics` when Prometheus disabled |
| `auth.required` / `auth.forbidden` | 401 / 403 | `/metrics` without/insufficient token |
