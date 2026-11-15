# Phase 10 — API (public + node), stream, migration

## Public API additions (`/api/v1`, primary)

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/nodes` | admin | — | `200 {items: Node[]}` (includes implicit `local`) | — |
| POST | `/nodes` | admin | `{name, pairing: string}` | `201 Node` | `422 node.pairing_invalid`, `502 node.unreachable`, `409 node.fingerprint_mismatch`, `409 node.version_skew`, `403 node.bound_elsewhere` |
| GET | `/nodes/{nodeId}` | admin | — | `200 NodeDetail` | `404 node.not_found` |
| PATCH | `/nodes/{nodeId}` | admin | `{name?, url?, pairing?}` | `200 Node` | as POST |
| DELETE | `/nodes/{nodeId}?force=` | admin | — | `204` | `409 node.not_empty` |
| POST | `/nodes/{nodeId}/orphans/{serverId}/adopt` | admin | `{name?}` | `201 ServerDto` | `404` |
| DELETE | `/nodes/{nodeId}/orphans/{serverId}` | admin | — | `202 {job}` | — |
| GET | `/nodes/summary` | authenticated | — | `200 {items: {id, name, status}[]}` (for server pages) | — |
| POST | `/servers` (phase 1, extended) | `server.create` | `+ nodeId?: string|null` | unchanged | `503 node.offline`, `409 node.capacity` (memory) |
| POST | `/servers/{serverId}/migrate` | admin | `{targetNodeId: string|null, keepSource?: false, startAfter?: true}` | `202 {job}` | `409 server.busy`, `503 node.offline`, `422 node.same` |
| POST | `/servers/{serverId}/clone` (phase 1, extended) | as before | `+ targetNodeId?` | unchanged | `503 node.offline` |

`ServerDto` gains `nodeId: string|null`, `node: {id, name, status}|null`, `configRev`, `state` may be `"unknown"` or `"missing"`, `lastKnown?: Status`.

```ts
type Node = { id: string; name: string; url: string; status: "online"|"offline"|"incompatible"|"unbound";
  lastSeenAt: string|null; version: string|null; protocolVersion: number|null; serverCount: number;
  host: { cpus: number; totalMemoryMb: number; freeMemoryMb: number; diskFreeBytes: number; os: string; arch: string } | null };
type NodeDetail = Node & { fingerprint: string; capabilities: IsolationCapabilities /* phase 9 */;
  orphans: { serverId: string; slug: string; status: string }[]; clockSkewMs: number|null; lastError: string|null };
```

## Node API (`/node/v1`, agent; TLS; `Authorization: Bearer mcmn_…`)

Agent routes live in `chunkyard-api::node`; documented in a separate OpenAPI document (`mcm openapi --node`). Shapes reuse phase DTOs unless noted.

| Method | Path | Purpose |
|---|---|---|
| POST | `/node/v1/hello` | `{primaryInstanceId, primaryVersion, protocolVersion}` → `{agentVersion, protocolVersion, instanceId, serverTime, host, capabilities, portRanges}` |
| GET | `/node/v1/servers` | `{items: {id, configRev, status}[]}` (reconciliation) |
| PUT | `/node/v1/servers/{id}/spec` | `ServerSpec` + `configRev` → `204` / `409 node.stale_rev` |
| DELETE | `/node/v1/servers/{id}` | Stop + delete dir (job) |
| POST | `/node/v1/servers/{id}/{start|stop|restart|kill}` | Power |
| POST | `/node/v1/servers/{id}/command` | `{line, actor}` |
| GET | `/node/v1/servers/{id}/console?sinceSeq=` | Ring snapshot |
| GET/PUT | `/node/v1/servers/{id}/properties`, `/players/*`, `/eula` | Settings (phase 2 shapes) |
| * | `/node/v1/servers/{id}/files/*` | Mirror of phase 2 file routes (streaming) |
| POST | `/node/v1/jobs` | `{id: JobId, kind, serverId?, params}` → `202` — runs a registered handler under the given id |
| POST | `/node/v1/jobs/{id}/cancel` | Cancel |
| GET | `/node/v1/java` · POST `/node/v1/java/install` | Runtimes on that node |
| POST | `/node/v1/ports/probe` | `{ports: number[]}` → `{free: number[]}` |
| GET | `/node/v1/transfer/{serverId}/export` | Streams `application/x-tar+zstd` of server dir; header `X-MCM-Size-Estimate` |
| PUT | `/node/v1/transfer/{serverId}/import` | Receives stream; trailer/response `{sha256, bytes}` |
| GET | `/node/v1/stream` | WebSocket (below) |
| GET | `/healthz` | No auth |

Agent errors: problem+json with the shared code space; additional `node.bound_elsewhere`, `node.stale_rev`, `node.unauthorized`.

## Stream WebSocket (`/node/v1/stream`)

Envelope identical to the browser WS ([api-conventions.md](../../architecture/api-conventions.md#websocket)); topics:

| Direction | Message | Notes |
|---|---|---|
| P→A | `{op:"subscribe", topic:"console:<id>", sinceSeq}` / `unsubscribe` | Console forwarding (P11-FR-15) |
| A→P | `{op:"event", topic:"status", data:{serverId, status}}` | Always sent (no subscription) |
| A→P | `{op:"event", topic:"console:<id>", data:{type:"lines"|"lagged"|"reset", …}}` | |
| A→P | `{op:"event", topic:"metrics", data:{samples: Sample[]}}` | Every sample interval, all servers batched |
| A→P | `{op:"event", topic:"metrics_backfill", data:{samples}}` | After reconnect, batches of ≤ 5 000 |
| A→P | `{op:"event", topic:"players", data:{serverId, online, max, list}}` | |
| A→P | `{op:"event", topic:"job", data: Job}` | |
| A→P | `{op:"event", topic:"domain", data: NodeDomainEvent}` | crash, crash_loop, oom_killed, backup_succeeded/failed, disk_quota_*, player joined/left |
| both | WS ping/pong every 10 s | 30 s timeout → offline |

## DB migrations

Primary: `crates/chunkyard-db/migrations/<NNNN>_p11_nodes.sql`

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, url TEXT NOT NULL,
  token_enc BLOB NOT NULL, cert_fingerprint TEXT NOT NULL,
  last_seen_at INTEGER, version TEXT, protocol_version INTEGER, host_facts TEXT, last_error TEXT,
  created_at INTEGER NOT NULL
);
ALTER TABLE servers ADD COLUMN config_rev INTEGER NOT NULL DEFAULT 1;
-- node_id already exists (phase 1, NULL = local); fix uniqueness: NULLs are distinct in SQLite UNIQUE indexes
DROP INDEX IF EXISTS servers_port;
CREATE UNIQUE INDEX servers_node_port ON servers(IFNULL(node_id, ''), port);
ALTER TABLE jobs ADD COLUMN node_id TEXT;
ALTER TABLE storage_targets ADD COLUMN node_id TEXT;   -- NULL = primary-local or remote-capable (s3)
```

Agent: `crates/chunkyard-db/migrations-agent/<NNNN>_agent_init.sql` (separate migrator, `sqlx::migrate!("migrations-agent")`)

```sql
CREATE TABLE agent_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- primary_instance_id, node_token_hash
CREATE TABLE server_specs (server_id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, config_rev INTEGER NOT NULL,
  spec TEXT NOT NULL, last_state TEXT NOT NULL DEFAULT 'stopped', updated_at INTEGER NOT NULL);
-- plus the phase 0 jobs table, phase 3 java_runtimes, phase 6 backups (local target rows) — same DDL as primary
```

## Config additions

```toml
[agent]                      # only used by `mcm agent`
listen = "0.0.0.0:8421"
advertise_host = ""          # hostname/IP put in the cert SAN and pairing string
metrics_buffer_minutes = 60

[primary]
run_local_servers = true     # primary can also host servers
node_request_timeout_s = 30
```

## Error codes introduced

`node.not_found` (404), `node.offline` (503), `node.unreachable` (502), `node.pairing_invalid` (422), `node.fingerprint_mismatch` (409), `node.version_skew` (409), `node.bound_elsewhere` (403), `node.not_empty` (409), `node.stale_rev` (409), `node.capacity` (409), `node.same` (422), `node.unauthorized` (401, agent side).

## Audit actions

`node.create`, `node.update`, `node.delete`, `node.orphan_adopt`, `node.orphan_delete`, `server.migrate` — recorded on primary; remote server actions keep their phase action names with `details.nodeId`.
