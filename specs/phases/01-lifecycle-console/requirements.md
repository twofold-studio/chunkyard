# Phase 1 — Requirements

References (binding): [process-model.md](../../architecture/process-model.md), [log-formats.md](../../architecture/log-formats.md), [server-api.md](../../architecture/server-api.md), [minecraft-protocols.md](../../architecture/minecraft-protocols.md), [security.md](../../architecture/security.md), [patterns.md §5](../../architecture/patterns.md#5-actor--handle-pattern-per-server-supervisor).

Permissions from [auth.md](../../architecture/auth.md#permission-catalog-per-server); audit actions from the [catalog](../../architecture/audit.md), recorded on success and failure. System-initiated starts (auto-start, crash restart) are audited as `server.start` with `actor = null` and `details.trigger`.

## Protocol crate (`chunkyard-protocol`, leaf)

| ID | Requirement | Crates |
|---|---|---|
| P1-FR-01 | `varint`: `read_varint`/`write_varint` (i32, ≤ 5 bytes), `read_varlong`/`write_varlong` (≤ 10), sync (`&[u8]` → `(value, consumed)`) and async (`AsyncRead`). Errors `VarIntTooLong`, `UnexpectedEof`. | protocol |
| P1-FR-02 | `packet`: frame reader with caller-supplied max length; `Handshake { protocol, address, port, next_state }` codec (address ≤ 1024 bytes, `NextState::{Status, Login, Transfer, Unknown(i32)}`); `Handshake::normalized_host()` (text before first `\0`, trailing `.` stripped, lowercase). | protocol |
| P1-FR-03 | `slp`: `StatusResponse` model (`version`, `players{max, online, sample?}`, `description` as `TextComponent` with `to_plain()`, `favicon?`, unknown fields in `extra`), `async fn ping(addr, timeout) -> (StatusResponse, Duration)` (handshake protocol `-1` → status → response ≤ 256 KiB → ping/pong RTT). Server-side encoder for the fake server. | protocol |
| P1-FR-04 | `rcon`: codec (LE i32 length/id/type, body + 2 NULs, received length 10…4110) and `RconClient` (auth id `-1` → `AuthFailed`; `exec` sends the sentinel **after the first response fragment arrives**, reassembles until the sentinel reply, 300 ms idle fallback; commands > 1400 bytes rejected). Implemented and tested in P1 (the fake server needs the codec); **mcm does not enable or use RCON until P5**. | protocol |
| P1-FR-05 | `text::log_prefix` per [log-formats.md](../../architecture/log-formats.md): families `vanilla`, `fabric`, `paper`, `forge`, `bungee`; anchored prefix parsing, source checks, chat-marker rejection; matchers `ready`, `eula`, `save_done`, `saving_disabled/enabled`, `join`, `leave`, `uuid` (later phases consume the last five). Flavour → family table; `custom` defaults to `vanilla`. | protocol |

## Downloads (`chunkyard-download`, created in P1)

| ID | Requirement | Crates |
|---|---|---|
| P1-FR-06 | `SafeHttp` — the only outbound HTTP client of mcm ([security.md](../../architecture/security.md#outbound-http-ssrf)): custom resolver rejecting loopback, RFC 1918, CGNAT, link-local, ULA, multicast, unspecified and IPv4-mapped forms unless `security.allow_private_targets`; **connects to the vetted IP** (no re-resolution → DNS-rebinding safe); redirects followed manually (≤ 5) with per-hop scheme + IP validation; HTTPS only (HTTP only to `test-hooks` base URLs); connect timeout 10 s. `HttpDownloader::download(url, dest_tmp, {max_bytes, sha256?, progress})` streams to `<data>/tmp`, verifies hash, checks `Content-Length` vs cap before writing. Errors `download.blocked_target`, `download.too_large`, `download.hash_mismatch`, `download.failed`. | download |

## Server model and creation

| ID | Requirement | Crates | Permission | Audit |
|---|---|---|---|---|
| P1-FR-07 | Domain `Server` in `chunkyard-core` mirrors the `servers` table; `LaunchSpec` enum `Jar{path}`, `ArgsFile{path}`, `Custom{args}` (serde tag `kind`); `ServerRepo` trait in `chunkyard-core::repo`, `SqliteServerRepo` in `chunkyard-db`. | core, db | — | — |
| P1-FR-08 | `POST /servers` per [server-api.md](../../architecture/server-api.md#create--post-servers): P1 accepts `source.kind ∈ {url, import}`, `javaPath`, and the other P1 fields; any later-phase field (`java`, `acceptEula`, `runtime`, `source.kind=installer|pack`) is an unknown field → `422`. Validates; derives a unique `slug` (display handle only); allocates the game port (FR-10); inserts the row (`flavor = "custom"`); creates `<data>/servers/<id>/` and `<data>/state/<id>/`; writes managed properties (FR-11); submits job `server.create` (FR-09). Response `202 {server, job, warnings}`; state `installing` during the job. Admins supplying `jvmArgs` get warning `jvm_args_admin_freeform` (the non-admin allow-list arrives with P2 editing). | core, fs, api, server | `server.create` (+ admin for url/import/custom launch) | `server.create` |
| P1-FR-09 | Sources (both admin-only). **url** — via `HttpDownloader` (FR-06), max 512 MiB, renamed into `servers/<id>/server.jar` (or `fileName`, `^[\w.-]{1,128}\.jar$`); `sha256` mismatch fails the job. **import** — `path` must canonicalize inside one of `process.import_roots` (empty ⇒ `422 import.disabled`; outside ⇒ `422 import.outside_roots`); copied with `chunkyard-fs::copy` (preserve mtimes, skip symlinks with warning, abort on special files) or moved when `move: true` (same filesystem only). Any `.mcm/` directory in the imported tree is copied as ordinary user data and never read. Launch jar: `jarPath` else the single top-level `*.jar`, else job fails `import.jar_ambiguous` listing candidates. | download, fs, server | admin | — |
| P1-FR-10 | Port allocation (game port only): explicit `port` validated per server-api.md, unique among servers (`409 server.port_taken`), bindable (bind probe on `0.0.0.0:port`, `409 server.port_in_use`); else lowest free+bindable port in `process.port_range`. Serialized by a mutex in `ServerService`. No RCON port is allocated in P1. | server | — | — |
| P1-FR-11 | Managed properties: at creation and before every start, `chunkyard-fs::properties` merges only `server-port=<port>` into `server.properties` (creating it if missing), preserving other keys, comments and order; idempotent. **RCON keys are not touched in P1** (P5 owns them); `query.port`, `server-ip`, `management-server-*` likewise belong to later phases. | fs, process | — | — |
| P1-FR-12 | Java (P1): `java_path` absolute, executable, and `java -version` (5 s, via `CommandRunner`) parses. `GET /java/detected` lists candidates from `$JAVA_HOME/bin/java`, `PATH`, `/usr/lib/jvm/*/bin/java`, `/opt/java/*/bin/java` with `{path, version, major, vendor, source}` (cached 60 s). | process, server | `server.create` | — |
| P1-FR-13 | Validation per the P1 rows of the [server-api.md validation table](../../architecture/server-api.md#validation-table) plus create-only rules: memory 256 ≤ min ≤ max ≤ 1 048 576 MiB (defaults 1024/2048 only when unset); `launch.custom` admin-only; count ≤ `limits.max_servers` (`409 server.limit`). Errors `422 validation` with field list. | api, core | — | — |

## Supervisor and lifecycle

| ID | Requirement | Crates | Permission | Audit |
|---|---|---|---|---|
| P1-FR-14 | `ServerRegistry` holds one `ServerHandle` per server (startup + create; removed on delete). Supervisor actor per process-model with `Cmd::{Start, Stop, Restart, Kill, Send(line), UpdateSpec(Server), Shutdown}`; mpsc 32; caller timeout 5 s → `503 supervisor.unavailable`. Uses the `ProcessSpawner` trait **as defined in [process-model.md](../../architecture/process-model.md#spawner-trait-single-definition)** (not redefined here); P1 provides `NativeSpawner`. | process, server | — | — |
| P1-FR-15 | **Dedicated spawner thread**: `NativeSpawner` performs every `Command::spawn` on one long-lived OS thread `chunkyard-spawner` (started at boot, never exits before process shutdown) fed by a channel, because `PR_SET_PDEATHSIG` fires when the forking *thread* exits. `pre_exec`: `prctl(PR_SET_PDEATHSIG, SIGTERM)`, then `_exit(1)` if `getppid()` ≠ mcm's pid; `process_group(0)`; env cleared + allow-list. No spawn from tokio workers or `spawn_blocking`. | process | — | — |
| P1-FR-16 | Start: preconditions — state ∈ {Stopped, Crashed}; no job holds the server lock (`409 server.busy`); launch target exists (`409 server.launch_missing`); java executable (`409 server.java_missing`); game port bindable (`409 server.port_in_use`). Applies FR-11; spawns via FR-15 with cwd `servers/<id>`; writes `state/<id>/pid` as `<pid> <starttime> <epoch>`. Start while Running → `409 server.running`. | process | `server.power` | `server.start` |
| P1-FR-17 | Ready detection: the flavour-aware `ready` matcher (FR-05) for the server's `log_family` (default `vanilla` for custom; editable via PATCH `logFamily`), with `ready_pattern` replacing only the body regex; prefix/source anchoring means chat such as `<Alice> Done (1.0s)! For help, type "help"` never marks a server ready. In parallel from +5 s, SLP every 5 s on `127.0.0.1:<port>`; first success → `Running`. `start_timeout_s` elapsing emits `Event::ServerStartSlow` once and keeps waiting. | process, protocol | — | — |
| P1-FR-18 | Stop: stop command → `stop_timeout_s` → `killpg SIGTERM` → 15 s → `killpg SIGKILL`; each escalation written as a `System` console line. Stop when Stopped → `204` no-op. Stop during Starting allowed. | process | `server.power` | `server.stop` |
| P1-FR-19 | Kill: `killpg SIGKILL`; state → Stopped, `exit.reason="killed"`. Restart: stop sequence then start inside the actor; queued commands processed in order. | process | `server.power` | `server.kill`, `server.restart` |
| P1-FR-20 | Exit classification → `ExitInfo { code, signal, reason, at }`, `reason ∈ {requested, killed, crashed, eula_required, start_failed, crash_loop}`. `eula_required` when the `eula` matcher fired during the run (no restart). `start_failed` when spawn errors (ENOENT, EACCES). | process | — | — |
| P1-FR-21 | Crash handling: unexpected exit in Starting/Running → `Crashed`; last 200 ring lines + exit info to `state/<id>/crash-<ts>.log` (keep newest 20); restart with backoff 5 s × 3ⁿ (cap 300 s; base configurable in `RestartPolicy` for tests) while within `max_restarts`/`restart_window_s`, cancellable by user stop; else `Stopped` + `crash_loop` + `Event::ServerCrashLoop`. | process | — | `server.start` (trigger `crash_restart`) |
| P1-FR-22 | Auto-start: after adoption (FR-23), start `auto_start=1` servers sequentially with `process.autostart_stagger_s`, skipping (logged + event) those whose preconditions fail. | server, process | — | `server.start` (trigger `autostart`) |
| P1-FR-23 | Startup adoption via the **single mechanism** in [process-model.md](../../architecture/process-model.md#manager-startup-and-orphans): `NativeSpawner::adopt()` reads `state/<id>/pid`; a process is a verified orphan only if `/proc/<pid>` exists **and** start time matches **and** `/proc/<pid>/cwd` resolves to `servers/<id>`; verified orphans get SIGTERM to the group, 30 s, SIGKILL; `adopt()` returns `Ok(None)`. Stale pid files are removed. | process | — | — |
| P1-FR-24 | Manager shutdown: stop all running servers in parallel (bounded 8); deadline `max(stop_timeout_s)+20 s` then SIGKILL groups; `last_state` persisted on every transition. | process, server | — | — |
| P1-FR-25 | Status: `watch` + `Event::ServerStatusChanged`; WS topics `server:<id>` and `servers` (filtered by `server.view`). `Status` is additive (process-model). | process, api | `server.view` | — |

## Server management

| ID | Requirement | Crates | Permission | Audit |
|---|---|---|---|---|
| P1-FR-26 | List/get servers with status embedded; list filtered by `server.view`, sorted by name; `ServerDto.myPermissions`. | api | `server.view` | — |
| P1-FR-27 | `PATCH /servers/{id}`: P1 rows of the server-api.md validation table (`name`, `autoStart`, `restartOnCrash`, `maxRestarts`, `restartWindowS`, `stopCommand`, `stopTimeoutS`, `startTimeoutS`, `readyPattern`) plus `logFamily` (`vanilla|fabric|paper|forge|bungee|null`). Unknown fields → `422`. Response `200 {server, warnings}`. `Cmd::UpdateSpec`; policy fields apply immediately, others on next start. | api, process | `server.settings` | `server.update` (details: changed field names) |
| P1-FR-28 | Clone `POST /servers/{id}/clone {name}`: source Stopped/Crashed (`409 server.running`); job `server.clone` locks both; copies `servers/<src>` excluding `logs/`, `crash-reports/`, `cache/`, `*.lock` (the source `state/` dir is **not** copied); new id, slug, port; managed properties rewritten; `auto_start=0`. Failure trashes the partial destination and deletes the row. Response `202 {server, job, warnings}`. | fs, server | `server.view` (source) + `server.create` | `server.clone` |
| P1-FR-29 | Delete `DELETE /servers/{id}?force=bool` → `202 {job}`: Running without `force` → `409 server.running`; with force → kill first. Job `server.delete`: remove handle; move `servers/<id>` and `state/<id>` to `tmp/delete-<id>-<ts>/`; delete the row (cascades); delete the server's **other** jobs, **keeping its own job row** as the record; purge asynchronously (startup purges leftovers). | fs, server | `server.delete` | `server.delete` |
| P1-FR-30 | EULA: `POST /servers/{id}/eula {accept:true}` writes `eula.txt` (`#Accepted via mcm by <username> at <RFC3339>\neula=true\n`); `accept:false` → `422`. `ServerDto.eulaAccepted` parsed from the file (untrusted input: parse failure = false). | fs, api | `server.settings` | `server.eula.accept` |

## Console

| ID | Requirement | Crates | Permission | Audit |
|---|---|---|---|---|
| P1-FR-31 | Pipeline per process-model: reader never awaits consumers; 16 KiB line cap; lossy UTF-8; `ConsoleLine { epoch, seq, ts, stream, text, user? }`. **`epoch`** = mcm run id (UUIDv7 generated at startup, exposed in `system/info.epoch`); `seq` monotonic per server within an epoch; a `System` line `[mcm] process started (pid N)` marks each start. | process, core | — | — |
| P1-FR-32 | `LogRing` bounded by `console_ring_lines` and `console_ring_bytes`; `snapshot_since(seq) -> {Lines, Evicted(full ring)}`. | process | — | — |
| P1-FR-33 | WS `console:<id>`: subscribe with `{epoch?, sinceSeq?}`; ack carries current `epoch`. Same epoch and `sinceSeq` still in ring → replay `lines` then live; **epoch mismatch** (mcm restarted), evicted `sinceSeq`, or absent → `reset` (full ring, current epoch) then live. Batching 50 ms / 256 lines; `lagged` on broadcast lag then replay of what remains. | api, process | `console.read` | — |
| P1-FR-34 | Commands: WS `{op:"command", serverId, line}` and `POST /servers/{id}/command {line}`. `409 server.not_running` unless Starting/Running/Stopping; `422 console.invalid_command` when empty, > 1024 bytes, or containing C0 controls. Echo `stream=Input` with `user`. Rate limit 20/s per user per server (`429`). | process, api | `console.write` | `console.command` (details `{line}` truncated to 256) |
| P1-FR-35 | Console file `state/<id>/console.log` via bounded writer (mpsc 1024, drop + counter), format `<RFC3339> <stream> <text>`, rotate 10 MiB keep 5. `GET /servers/{id}/console/log` streams it; `GET /servers/{id}/console?epoch&sinceSeq&limit≤5000` REST fallback with the same reset semantics. | process, api | `console.read` | — |
| P1-FR-36 | Crash logs: `GET /servers/{id}/crashes` lists `{name, at, size, exit}` from `state/<id>/`; `GET /servers/{id}/crashes/{name}` (name `^crash-\d+\.log$`). | api | `console.read` | — |

## Fake server and testkit

| ID | Requirement | Crates |
|---|---|---|
| P1-FR-37 | `fake-mc-server` implements the P1 subset in [fake-server-scope.md](fake-server-scope.md), emitting the **real per-family log format** of its `flavor` and supporting `fakechat <name> <msg>`. | fake-mc-server |
| P1-FR-38 | `chunkyard-testkit`: `FakeMc::path()`, `FakeJava::install(dir)` (`<dir>/bin/java` → fake), `TestApp::create_server(profile)`, `TestApp::restart()` (same data dir, new epoch). | testkit |

## Edge cases and failure modes

| Case | Expected |
|---|---|
| mcm restarts (upgrade, crash, `systemctl restart`) | **Native servers stop** (graceful on clean shutdown; PDEATHSIG + orphan kill otherwise); auto-start servers come back. See README limitation. |
| Spawn requested from a `spawn_blocking` context | Routed to `chunkyard-spawner`; child survives the blocking thread's reaping (FR-15). |
| Player types `Done (0.1s)! For help, type "help"` in chat during startup | Not matched (prefix/source anchoring); SLP still decides. |
| Browser reconnects after mcm restart with old `{epoch, seq}` | `reset` with full ring; never mixes seqs across epochs. |
| Output faster than WS clients read | Ring + broadcast lag; `lagged`; Java never blocks. |
| Line > 16 KiB | Truncated + `…`. |
| Process ignores `stop` / SIGTERM | SIGTERM after timeout, SIGKILL after 15 s; console shows escalation. |
| Grandchildren | `killpg` kills the group; a grandchild that `setsid`s escapes (documented; P10 Docker solves). |
| Port grabbed before start | `server.port_in_use` with port in detail. |
| `java_path` deleted | `server.java_missing`. |
| URL resolves to private IP, or first public then private (rebinding) | `download.blocked_target`; the connection uses the first vetted IP only. |
| Redirect to private IP / > 5 redirects | Rejected per hop / `download.failed`. |
| Disk full | Job fails `fs.no_space` (507); partial files removed. |
| Imported tree contains a forged `.mcm/pid` | Ignored; mcm reads pid files only from `state/<id>/`. |
| Delete during clone | `409 server.busy`. |
| Two rapid starts | Second `409 server.running` (checked inside the actor). |

## Security considerations

- **Native runtime is single-trust** ([security.md](../../architecture/security.md#native-runtime-is-single-trust)): every server runs as the mcm OS user, so jar sources, `java_path`, custom launch, JVM args and (from P2) file writes are code execution as mcm. In P1 all of these are admin-only; P8 enforces the rule for delegated grants; P10 Docker is required for real isolation.
- Import roots canonicalized at config load; symlinks inside imported trees are not copied.
- Child env cleared except allow-listed variables; `CHUNKYARD_*` never inherited.
- No mcm state in the server dir; nothing under `servers/<id>` is trusted (process-model "State directory").
- RCON is untouched in P1 — no password to leak, no port exposed.
- All outbound fetches through `SafeHttp` (SSRF, rebinding, redirect validation).
- Console commands are audited (truncated) — players may type secrets into auth plugins; documented.
