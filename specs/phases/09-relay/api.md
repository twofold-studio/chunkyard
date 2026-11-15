# Phase 9 — API, WebSocket, config, migration

Conventions: [api-conventions.md](../../architecture/api-conventions.md). Paths under `/api/v1`. Handlers in `chunkyard-api/src/routes/relays.rs`; DTOs in `chunkyard-api::dto::relay`. All relay endpoints are admin-only (bearer tokens need the `admin` scope, [auth.md](../../architecture/auth.md#api-tokens)).

## DTOs

```ts
RelayConnection = { id, name, endpoint, fingerprint: string|null /* null = CA-validated */, enabled,
                    status: "disconnected"|"connecting"|"connected"|"error", lastError: string|null,
                    agentName: string|null, assignment: { hostnames: string[], ports: number[], maxStreams: number } | null,
                    publicAddrs: string[], connectedSince: string|null, streamsActive: number, bytesIn: number, bytesOut: number }
// Additive fields on the P7 Route DTO:
Route += { relayId: string|null, relayTarget: { kind: "hostname" } | { kind: "port", port: number } | null,
           relayState: "none"|"pending"|"accepted"|"rejected", relayReason: string|null }
// Additive ExposureEntry.kind value: "relay"
ProbeResult = { ok: boolean, latencyMs: number|null, error: string|null }
```

## Relay connections (admin)

| Method | Path | Request | Response | Audit |
|---|---|---|---|---|
| GET | `/relays` | — | `{ items: RelayConnection[] }` | — |
| POST | `/relays` | `{ name, pairing: "mcmrelay://…" }` | `201 RelayConnection` | `relay.connection.create` |
| GET | `/relays/{id}` | — | `RelayConnection` | — |
| PATCH | `/relays/{id}` | `{ name?, enabled?, pairing? }` (new pairing = re-pair) | `RelayConnection` | `relay.connection.update` |
| DELETE | `/relays/{id}` | — | `204` (routes using it get `relayId = null`) | `relay.connection.delete` |

`pairing` is write-only; the token is never returned or logged.

## Route binding (extends P7)

`POST /servers/{id}/routes` and `PATCH /routes/{routeId}` accept `relayId` and `relayTarget` (admin required when setting `relayId`). Validation: relay exists (`422 proxy.relay_not_found`); `relayTarget.port` must be in the relay's assignment when connected (else stored and reported as `relayState = rejected` after announce). Audit `proxy.route.update`.

## Probe (extends P7 port mapping)

| Method | Path | Request | Response | Audit |
|---|---|---|---|---|
| POST | `/network/portmap/mappings/{id}/probe` | `{ relayId }` | `ProbeResult` (blocks ≤ 10 s) | `portmap.probe` |

## WebSocket

Topic `network` gains (admin only):

| `data` | When |
|---|---|
| `{ type: "relay", relay: RelayConnection }` | Status change, assignment/announce result, and every 5 s while connected (counters) |

`server:<id>` `exposure` payloads include `relay` entries.

## Events

`RelayStatusChanged { relay_id, status, reason }` — consumed by P8 notifications (event `relay.disconnected`, emitted after 60 s continuously disconnected).

## Config (`[relay_client]`, crate `chunkyard-tunnel`)

| Key | Default | Meaning |
|---|---|---|
| `heartbeat_s` | 15 | Control `Ping` interval; 3 missed → reconnect |
| `reconnect_min_s` / `reconnect_max_s` | 1 / 60 | Backoff bounds (jittered) |
| `connect_timeout_s` | 10 | TCP + TLS + Hello |
| `max_streams` | 1024 | Local cap on concurrent data streams across relays |

The relay binary's own config is `relay.toml` ([relay.md](relay.md#relaytoml)).

## Error codes

| Code | Status | When |
|---|---|---|
| `relay.pairing_invalid` | 422 | Unparseable pairing string (`errors[]` names the part: scheme, host, fp, token) |
| `relay.name_taken` | 409 | Duplicate connection name |
| `relay.not_connected` | 409 | Probe without a connected relay |
| `relay.probe_rate_limited` | 429 | More than 1 probe per 30 s |
| `proxy.relay_not_found` | 422 | `relayId` unknown |
| `relay.fingerprint_mismatch`, `relay.auth_failed`, `relay.version` | — | Status reasons (not HTTP errors) |

## Migration

`crates/chunkyard-db/migrations/<NNNN>_p9_relay_connections.sql` (number assigned at merge):

```sql
CREATE TABLE relay_connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, endpoint TEXT NOT NULL,   -- host:port
  cert_fingerprint TEXT,                -- NULL = webpki validation
  token_enc BLOB NOT NULL,              -- XChaCha20-Poly1305, AAD "relay_connections.token_enc:<id>"
  enabled INTEGER NOT NULL DEFAULT 1,
  last_error TEXT, last_connected_at INTEGER, created_at INTEGER NOT NULL
);
-- SQLite allows ADD COLUMN with REFERENCES when the default is NULL.
ALTER TABLE proxy_routes ADD COLUMN relay_id TEXT REFERENCES relay_connections(id) ON DELETE SET NULL;
ALTER TABLE proxy_routes ADD COLUMN relay_target TEXT;   -- JSON {"kind":"hostname"} | {"kind":"port","port":25570}
CREATE INDEX proxy_routes_relay ON proxy_routes(relay_id);
```

`relayState`/`relayReason` are runtime state held by the tunnel actor (not persisted).

Relay-side schema (separate DB, own migrations in `crates/chunkyard-relay/migrations/`): [relay.md § State](relay.md#state-sqlite-relaydb-own-sqlx-migrations-in-cratesmcm-relaymigrations).
