# Phase 5 — Requirements

Conventions: [patterns.md](../../architecture/patterns.md). Sampling algorithms: [collection-reference.md](collection-reference.md). Protocols: [minecraft-protocols.md](../../architecture/minecraft-protocols.md), log matchers: [log-formats.md](../../architecture/log-formats.md).

## Crate structure and edges

`mcm-metrics` depends on `mcm-core` and `mcm-protocol` only ([workspace-layout.md](../../architecture/workspace-layout.md)). It never depends on `mcm-process` or `mcm-db`: server pid/pgid/start time and status come from core `ServerLookup` + `EventBus`; persistence goes through core repo traits (`MetricRepo`, `PlayerSessionRepo`, `StateHistoryRepo`; impls in `mcm-db`); properties through core `PropertiesEditor` (impl in `mcm-fs`, registry from P2-FR-12).

```
crates/mcm-metrics/src/
├── lib.rs, error.rs      # MetricsError + Classify (wraps mcm-protocol errors)
├── collector.rs          # MetricsCollector actor (ticks every sample_interval_s)
├── sample.rs             # ServerSample, HostSample, Snapshot
├── proc_sampler.rs       # ProcessSampler trait; LinuxProcSampler (/proc by pgid), SysinfoSampler fallback
├── disk.rs               # DiskUsageCache (periodic walk, spawn_blocking)
├── host.rs               # HostSampler
├── rcon_actor.rs         # RconActor/RconHandle per running server; implements core `RconExecutor`
├── mgmt_actor.rs         # ManagementActor: JSON-RPC over WebSocket client; implements core `ManagementClient`
├── managed_keys.rs       # P5 entries appended to the P2 managed-key registry
├── players.rs            # PlayerSource chain + PlayerTracker (sessions)
├── tps.rs                # TpsProbe per flavour, capability state
├── rollup.rs, availability.rs, prometheus.rs
```

Pure parsers (`list`, `tps`, log prefixes/matchers) live in `mcm-protocol::text`; JSON-RPC message types and method/notification names live in `mcm-protocol::mgmt` (serde only, no I/O). The WebSocket transport (`tokio-tungstenite`) lives in `mcm-metrics::mgmt_actor`, keeping the leaf crate free of a WS dependency (the relay and fake server don't need it).

## Functional requirements

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P5-FR-01 | `MetricsCollector` actor samples every `metrics.sample_interval_s` (default 10, min 5) for each server in `Starting`/`Running`/`Stopping`, plus the host. Servers sampled concurrently with a 2 s per-server budget; a slow source yields `null` for that field and never delays others. | metrics, server (wiring) | — | — | `MetricsSampled` (internal) |
| P5-FR-02 | CPU % and RSS summed over **all processes in the server's process group** (pgid + start time via `ServerLookup`) using `/proc/<pid>/stat` + `statm`; CPU % relative to one core (200 % = two cores); host core count reported alongside. `sysinfo` fallback on non-Linux dev hosts. | metrics, core | — | — | — |
| P5-FR-03 | Disk usage of `servers/<id>/`: full walk at most every `disk_walk_interval_s` (default 300) in `spawn_blocking`, never following symlinks, bounded by 60 s (partial → `approx`). Cached with `diskMeasuredAt`; stopped servers walked on demand at most every 10 min. mcm state (`<data>/state/<id>/`) is outside the dir and not counted. | metrics | — | — | — |
| P5-FR-04 | **RCON is enabled here for the first time.** P5 appends managed keys to the P2 registry: `enable-rcon=true`, `rcon.port` (allocated from `process.rcon_port_range`, stored `servers.rcon_port`), `rcon.password` (random 32 chars, stored `servers.rcon_password_enc`, schema type `secret`), `broadcast-rcon-to-ops=false` — applied by `PropertiesEditor::apply_managed` before each start, **unless `rconDisabled`** (P5-FR-19). Existing servers get RCON at their next start. | metrics, core, fs | — | — | — |
| P5-FR-05 | One `RconActor` per running server: connects after `Running`, keeps a **single persistent** connection (vanilla logs each new connection), serialises commands, reconnects with backoff (1 s → 60 s), stops on server stop. Uses the `mcm-protocol` RCON client, which sends the fragmentation sentinel **only after the first response fragment arrives** ([minecraft-protocols.md](../../architecture/minecraft-protocols.md#rcon-source-rcon-over-tcp)). Auth failure → `RconAuthFailed`, no retry until properties change or restart. | metrics, protocol | — | — | `RconAuthFailed`, `RconStateChanged` |
| P5-FR-06 | Players source chain per sample: **management protocol** `minecraft:players` (P5-FR-20, when connected) → RCON `list` → SLP (`online`, `max`, `sample` flagged `partial`) → Query full stat (if `enable-query=true`). Source reported as `playersSource`. | metrics, protocol | — | — | `PlayersChanged` |
| P5-FR-07 | Player sessions: `PlayerTracker` records joins/leaves into `player_sessions` from (1) management-protocol notifications `minecraft:notification/players/joined` / `…/left` when connected, else (2) console lines via the flavour-aware, prefix+source-anchored `join`/`leave`/`uuid` matchers from [log-formats.md](../../architecture/log-formats.md) — chat lines (`<Mallory> Bob left the game`) can never open/close a session. Reconciles with each authoritative list (management/RCON; never SLP `partial`). Stop/crash closes open sessions at stop time; on mcm start, dangling sessions close at the last sample `ts`. | metrics, protocol, core (`PlayerSessionRepo`) | — | — | `PlayerJoined`, `PlayerLeft` |
| P5-FR-08 | TPS/MSPT via **RCON-only** probes chosen by flavour ([collection-reference.md](collection-reference.md#tps-probes)); probe interval `tps_interval_s` (30 s). `Unsupported` or 3 consecutive parse failures disable the probe for 30 min for that server. Spark (if detected) takes precedence. Never sent via stdin. With RCON disabled, TPS is `null` (`tpsSource: null`). | metrics, protocol | — | — | — |
| P5-FR-09 | Host sample: CPU % (0–100), memory used/total, swap, load 1/5/15, filesystem used/total for `data_dir` (statvfs), mcm's own RSS. | metrics | — | — | — |
| P5-FR-10 | Samples written to `metric_samples` at resolution 10 (`server_id = 'host'` for host) via `MetricRepo`, batched per tick in one transaction. | metrics, core (`MetricRepo`), db (impl) | — | — | — |
| P5-FR-11 | Rollups: every 60 s aggregate complete 60 s buckets from 10 s rows; hourly 3600 s from 60 s. `cpu_pct` avg, `rss_mb` avg + `rss_max_mb`, `disk_mb` last, `players` max, `tps` avg, `mspt` avg + `mspt_max`. Idempotent upsert. Retention per [data-model.md](../../architecture/data-model.md#retention). | metrics, core (`MetricRepo`) | — | — | — |
| P5-FR-12 | History API auto-picks resolution (≤ 6 h → 10 s, ≤ 7 d → 60 s, else 3600 s), downsamples to ≤ `maxPoints` (default 720, max 2000), returns gaps as explicit `null` points. | metrics, api | `server.view` | — | — |
| P5-FR-13 | Live snapshot endpoint (latest values, uptime, RCON + management state, RCON exposure, probe capabilities). WS `metrics:<id>` publishes each sample; `players:<id>` on change; `host` publishes host samples (percentages to any authenticated user, absolute bytes to admins). | metrics, api | `server.view` | — | — |
| P5-FR-14 | State history: `ServerStatusChanged` events recorded in `server_state_history` by a subscriber in `mcm-metrics`; uptime = now − `started_at` while Running; availability = Running ÷ (Running + Crashed + Starting beyond `start_timeout_s`); intentional stops excluded; `null` if never ran in window. | metrics, core (`StateHistoryRepo`, events) | `server.view` | — | — |
| P5-FR-15 | Players API: online list (name, uuid, joinedAt, sessionDuration), session history (paging, name filter), top players by playtime over a range. | metrics, api | `server.view` | — | — |
| P5-FR-16 | Prometheus `GET /metrics` (outside `/api/v1`), disabled by default (`metrics.prometheus = true`). Requires a bearer API token whose scopes include the global scope **`metrics.read`** ([auth.md](../../architecture/auth.md#permission-catalog-per-server)); admin tokens with `*` are accepted until P8, `*`+`admin` after P8. Gauges per server (labels `server_id`, `server_name`, `flavor`) and host, from the in-memory snapshot only. | metrics, api, auth | `metrics.read` | — | — |
| P5-FR-17 | Budget: ≤ 1 DB transaction per tick; `/proc` reads only for the group's pids; disk walks serialised globally; ≤ `max_concurrent_probes` (16) RCON/management requests in flight. | metrics | — | — | — |
| P5-FR-18 | Metrics, sessions and state history of a deleted server are deleted by the server-delete job (service cascade; `metric_samples` has no FK for write speed). | metrics, core | — | — | — |
| P5-FR-19 | **RCON exposure and `rconDisabled`.** `rconExposure` = `loopback` iff `server-ip` is `127.0.0.1`/`::1` (router-only exposure, P7) or the runtime does not publish the port (Docker, P10); else `public`. `public` → snapshot field + persistent UI warning "RCON is reachable on all interfaces" with firewall guidance and a one-click **Disable RCON**. `rconDisabled` (column `servers.rcon_disabled`, PATCH field `rconDisabled: boolean`) means: mcm writes `enable-rcon=false`, stops managing `rcon.*`, runs no `RconActor`; players come from management protocol → SLP → Query; TPS is unavailable. Takes effect at next start (`restart_required` warning). | metrics, core, api, fs | `server.settings` | `server.settings.update` | `RconStateChanged` |
| P5-FR-20 | **Server Management Protocol** (vanilla ≥ 1.21.9; also fabric/quilt on ≥ 1.21.9; other flavours only if a connect probe succeeds — to verify). P5 manages `management-server-enabled=true`, `management-server-host=127.0.0.1`, `management-server-port` (allocated, `servers.management_port`), `management-server-secret` (random 40 alphanumerics, `servers.management_secret_enc`, type `secret`), `management-server-allowed-origins=` (empty), `management-server-tls-enabled=false`. `ManagementActor` connects with `Authorization: Bearer <secret>` after `Running`, one persistent connection, backoff 1 s → 60 s; subscribes to join/left notifications. It is the **preferred** source for players (FR-06), sessions (FR-07), and — from P5 on — the P2 allowlist endpoints while the server is running (`minecraft:allowlist`, `/add`, `/remove`), falling back to console commands. | metrics, protocol, core (`ManagementClient`), api | — | — | `ManagementStateChanged` |

## Edge cases and failure modes

| Case | Handling |
|---|---|
| Server `Starting` (RCON/management not up) | CPU/RAM sampled; players/TPS `null` |
| pid reuse | Sampler validates `/proc/<pid>/stat` starttime against `ServerLookup` |
| Short-lived children in group | Per-pid CPU deltas; new pids contribute from first sight |
| CPU counter wrap / pid restart | Negative delta → 0, reset baseline |
| RCON port taken by another process | Auth fails → `RconAuthFailed`; UI explains |
| User edits RCON keys by hand | Managed keys re-applied at next start; `rconDisabled` is the supported off switch |
| Management port/secret rejected (401) | `ManagementStateChanged{auth_failed}`; fall back to RCON/SLP |
| MC < 1.21.9 or unsupported flavour | Management keys not written; `management: "unsupported"` |
| `list` format differences | 1.13+ and pre-1.13 parsed; unparsable → next source |
| SLP `sample` fake/formatted names | `partial`, never used for sessions |
| Chat or `/say` mimicking join/leave/ready lines | Anchored matchers reject ([log-formats.md](../../architecture/log-formats.md)); tests per family |
| Custom join-message plugins | Console sessions miss them; reconciliation repairs within one sample |
| Clock jump | `Clock::now()`; rollups keyed on bucket start; upserts |
| DB busy | Retry once; then drop sample (`metrics_dropped_samples`) |
| 50+ servers | Concurrency cap 16; tick overrun → skip next tick, `warn` |
| 100 GB worlds | Walk bounded 60 s; `approx`; interval doubles if > 30 s |

## Security considerations

- RCON and management secrets are random per server, encrypted at rest (AAD per [security.md](../../architecture/security.md#secrets-storage)), marked `secret` in the properties schema and redacted for principals without `console.write` (P2-FR-32). mcm connects only via loopback.
- RCON cannot be bound separately from the game port in vanilla; `public` exposure is surfaced with a warning and one-click disable (FR-19). The management protocol is always bound to `127.0.0.1` and TLS-less only because it is loopback-only.
- `broadcast-rcon-to-ops=false` keeps monitoring commands out of in-game chat.
- Player data (names, UUIDs, sessions) is personal data: `server.view` only; retention `metrics.player_session_retention_days` (400).
- `/metrics` disabled by default, token-gated; no player names in labels.
- External avatar images off by default ([ui.md](ui.md#player-avatars)).
