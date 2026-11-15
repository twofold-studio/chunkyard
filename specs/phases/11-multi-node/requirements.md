# Phase 10 — Requirements

Conventions: [patterns.md](../../architecture/patterns.md). "Primary" = mcm with UI; "agent" = `mcm agent`.

## Agent mode

| ID | Requirement | Crates | Perm | Audit |
|---|---|---|---|---|
| P11-FR-01 | `mcm agent init [--listen] [--advertise-host]` creates `<data>/agent/{tls.key,tls.crt,node.token.hash}` (ECDSA P-256 self-signed cert, 10-year validity, SAN = advertise host/IP), prints the pairing string once. `mcm agent rotate-token` prints a new string (old token invalid). | server, auth | (CLI) | — |
| P11-FR-02 | `mcm agent` (serve): no SPA, no `/api/v1`, no users/setup; serves `/node/v1/*` over TLS on `agent.listen` and `/healthz`. Uses its own SQLite (`<data>/mcm.db`, agent subset of tables: `server_specs`, `jobs`, `java_runtimes`, `backups` (local), `agent_state`). Runs supervisors, job runner (registered node-side handlers), metric sampler, disk sampler. | server, api::node, db | — | — |
| P11-FR-03 | Agent binding: first authenticated call to `POST /node/v1/hello` stores the primary's `instance_id`; subsequent calls from another instance id → `403 node.bound_elsewhere` (reset with `mcm agent unbind`). | api::node | node token | — |
| P11-FR-04 | Agent-local audit is not kept; every node call carries `X-MCM-Actor` (`userId`, `ip`) for logging only. The primary writes the audit row (single audit trail). | api::node | — | — |

## Enrollment and node management (primary)

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P11-FR-05 | `POST /nodes {name, pairing}`: parse `mcmnode://` string; connect with fingerprint pinning (custom rustls `ServerCertVerifier` comparing SHA-256 of the end-entity DER; hostname not checked); call `hello`; store `nodes` row (token encrypted). Failure → `422 node.pairing_invalid` / `502 node.unreachable` / `409 node.fingerprint_mismatch`. | node, api, db | admin | `node.create` | `NodeAdded` |
| P11-FR-06 | `PATCH /nodes/{id}` (name, url, re-pair with new string), `DELETE /nodes/{id}` only when it has no servers (`409 node.not_empty`) unless `?force=true` which removes server rows on primary but leaves files on the agent. | node, api | admin | `node.update`, `node.delete` | — |
| P11-FR-07 | Health: `NodeSupervisor` actor per node keeps the stream WS open; WS ping every 10 s; offline after 30 s without pong or on disconnect; reconnect backoff 1 s → 30 s. `GET /nodes` returns `status: online|offline|incompatible|unbound`, `lastSeenAt`, `version`, `protocolVersion`, host facts (`cpus, totalMemoryMb, freeMemoryMb, disk, os, arch, capabilities` incl. phase 9 isolation). | node | admin (server users see node name only) | — | `NodeOnline`, `NodeOffline` |
| P11-FR-08 | Version skew: node protocol version integer `NODE_PROTO`; primary accepts agents with `NODE_PROTO ∈ [P-1, P]`; otherwise `incompatible` and all calls refused (`409 node.version_skew`). Additive fields only within a protocol version; DTOs use `#[serde(default)]` for new fields. Release notes state the proto version. | node | — | — | — |

## Remote service routing

| ID | Requirement | Crates |
|---|---|---|
| P11-FR-09 | `AppState` services become **routers**: `ServerServiceRouter { local: Arc<dyn ServerService>, remotes: NodeRegistry }` dispatching by `servers.node_id` (NULL = local). Same for `FileService`, `ConsoleService`, `JavaRuntimeService` (per node), installer/content job submission, `BackupService` (execution), `MetricsSource`. `chunkyard-api` handlers are unchanged. | node, api (wiring in server) |
| P11-FR-10 | Config push: on any change to a remote server's config, primary increments `servers.config_rev` and `PUT /node/v1/servers/{id}/spec` (`ServerSpec` = everything the agent needs: launch, java, memory, jvm args, env, ports, restart policy, runtime/limits, auto_start). Agent rejects stale revs (`409 node.stale_rev`). | node, api::node |
| P11-FR-11 | Reconciliation on (re)connect: agent `GET /node/v1/servers` returns `{id, configRev, status}`; primary pushes newer specs; agent servers unknown to primary are reported as `orphaned` in node detail (admin can adopt → creates primary row, or delete). Servers in primary but missing on agent → `missing` state with error. | node |
| P11-FR-12 | Offline semantics: while a node is offline its servers show `state: "unknown"` (last known status kept as `lastKnown`), all mutating calls and console/file reads return `503 node.offline`; schedules targeting them record `schedule_runs.outcome=failed, detail=node.offline` and emit `schedule.failed`. Agents continue running servers and applying their own crash/auto-start policies. | node, scheduler |
| P11-FR-13 | Commands, power actions, properties/player lists, Java/installer/content operations are forwarded as HTTP calls; errors from the agent are problem+json and passed through with the same `code` (agent codes are the same code space). | node |

## Streaming

| ID | Requirement | Crates |
|---|---|---|
| P11-FR-14 | Node stream WS (`/node/v1/stream`): agent pushes `status`, `console` (batched lines with `seq`), `metrics` samples, `players`, `job` updates, `event` (domain events needed by notifier: crash, crash_loop, oom, backup results, disk quota). Primary republishes them on its `EventBus` so browser topics, notifications, and metrics storage work unchanged. | node, api::node |
| P11-FR-15 | Console subscription with `sinceSeq` is forwarded: primary subscribes per (node, server) on first browser subscriber, unsubscribes 30 s after last; the primary keeps a mirror `LogRing` per remote server fed by the stream so new browser subscribers are served locally. | node, process (LogRing reuse) |
| P11-FR-16 | Metrics buffering: agent keeps an outbound buffer (≤ 1 h of 10 s samples per server, ring) while disconnected; on reconnect sends `metrics_backfill` batches; primary inserts with `INSERT OR IGNORE` on `(server_id, resolution, ts)`. | node, metrics |
| P11-FR-17 | Jobs: primary creates the `jobs` row with `node_id`; agent runs it under the same `JobId` and streams updates; cancel forwarded. If the node goes offline mid-job, the job stays `running` with message `node offline`; on reconnect agent reports the final state; if the agent restarted, it reports `job.interrupted`. | node, core |

## Files and transfers

| ID | Requirement | Crates |
|---|---|---|
| P11-FR-18 | File endpoints for remote servers are proxied by streaming: request bodies piped to the agent via `reqwest::Body::wrap_stream`, responses piped back via `axum::body::Body::from_stream`; headers `Range`, `If-Match`, `ETag`, `Content-Disposition`, `Content-Length` preserved. No buffering beyond 64 KiB chunks; client disconnect aborts the upstream request. Sandbox enforcement happens on the agent (agent `SandboxRoot`) **and** path validity (`RelPath`) is pre-checked on primary. | node, api |
| P11-FR-19 | Chunked uploads (phase 2 protocol): session created on the agent; each chunk forwarded as received; resume queries forwarded. | node |

## Migration

| ID | Requirement | Crates | Perm | Audit |
|---|---|---|---|---|
| P11-FR-20 | `POST /servers/{id}/migrate {targetNodeId|null, keepSource: bool, startAfter: bool}` → job `server.migrate`: (1) mark server busy; (2) graceful stop if running; (3) target prepares: ensures Java runtime (download via chunkyard-java on target) and allocates port (P11-FR-22); (4) source streams `tar.zst` of the server dir (excluding `.mcm/console*`) → primary → target (single pass, sha256 computed on both ends, must match); (5) target writes spec with new port/RCON port and rewrites `server.properties` `server-port`/`rcon.port`/`query.port`; (6) primary updates `servers.node_id`, `config_rev`; (7) source deletes dir unless `keepSource`; (8) start if `startAfter` and was running. Failure at any step before (6) leaves the source authoritative and cleans up target. | node, fs, api | admin | `server.migrate` |
| P11-FR-21 | Migration progress reports bytes transferred / estimated total (from source disk usage). Cancel before step 6 is supported. | node | | |

## Ports, scheduling, backups, network

| ID | Requirement | Crates |
|---|---|---|
| P11-FR-22 | Port allocation per node: uniqueness of `(node, port)`; each node advertises its `port_range`/`rcon_port_range` in `hello`; allocation happens on primary using DB + a bind probe on the agent (`POST /node/v1/ports/probe`). Fixes the NULL-node uniqueness gap with an expression index (see api.md migration). | db, node |
| P11-FR-23 | Scheduler stays on primary; steps execute via the routed services. "Only when running" checks use the last known status; unknown → step skipped with outcome `skipped_node_offline`. | scheduler |
| P11-FR-24 | Backups: execution on the server's node. Local targets are **node-local** (`storage_targets.node_id`, NULL = primary); S3 targets are usable from any node: primary sends target config with decrypted credentials in the job params over TLS; agent holds them in memory only (never persisted, never logged; `Secret<T>`). Downloads of node-local backups are streamed via primary (P11-FR-18 mechanism). | backup, node |
| P11-FR-25 | Router/relay (phase 7) for remote servers dial `<node advertise host>:<server port>`; the "router-only exposure" loopback rule does not apply to remote servers (they must listen on the node's LAN address); the UI warns that the port is reachable on the node's network. | proxy |
| P11-FR-26 | Server creation (`POST /servers`) accepts `nodeId`; UI suggests nodes with enough free memory. Clone across nodes is a create + migrate-style copy job (`server.clone` with `targetNodeId`). | api, node |

## Edge cases & failure modes

| Case | Behaviour |
|---|---|
| Agent cert regenerated (reinstall) | Fingerprint mismatch → node `offline` with `node.fingerprint_mismatch`; admin re-pairs |
| Agent token rotated without updating primary | `401` from agent → node status `unbound`, admin re-pairs |
| Primary DB restored from old backup | `config_rev` on agent may be higher → agent reports, primary shows conflict; admin chooses "push primary" (forces rev = agent rev + 1) |
| Network partition during migration step 4 | Transfer fails, target cleaned, source unchanged, server restarted if it was running |
| Two primaries pointed at one agent | Second gets `403 node.bound_elsewhere` |
| Agent disk full during migration | Target reports `507 fs.quota_exceeded`/IO error; abort, source authoritative |
| Clock skew between nodes | Agent timestamps used for console/metrics; skew > 5 s shown as node warning (from `hello` server time) |
| Agent restarts while primary offline | Agent auto-starts servers from local specs; primary reconciles later |

## Security considerations

- Agent API is never reachable without TLS; node token compared in constant time; stored hashed on agent and encrypted on primary.
- Agent trusts the primary fully (it can run arbitrary Java on the agent) — documented; node token is effectively root-of-service for that host.
- The agent re-validates all paths (`SandboxRoot`) and JVM-arg rules; it does **not** trust primary-side validation alone (defence in depth in case of primary bugs).
- Forwarded secrets (S3 creds, CF API key for installs) only in job params, `Secret<T>`, never written to agent DB.
- `X-MCM-Actor` is informational only; agent makes no authorization decisions based on it.

## Open questions / to verify

- Agent-initiated reverse connection (yamux over TLS like the relay) to support agents behind NAT without VPN.
- Direct agent→agent transfer for large migrations (halves traffic through primary).
- Whether to share the relay's `chunkyard-tunnel-proto` for node streaming to unify transports.
- axum WebSocket over HTTP/2 (RFC 8441) support — we use HTTP/1.1 upgrade for the stream WS to avoid depending on it.
