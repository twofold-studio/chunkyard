# Phase 1 — Server lifecycle and live console

## Goal

Run real Minecraft servers: create a server from a jar (downloaded from a URL or imported from a directory), start/stop/restart/kill it safely, clone and delete it, auto-start it on boot, restart it after crashes, and operate it through a live, colourised, resumable web console.

> **Limitation — native servers stop when mcm stops or restarts.** In P1–P9 every server is a native child of mcm: its stdio pipes belong to mcm and it receives `SIGTERM` via `PR_SET_PDEATHSIG` if mcm dies. Upgrading or restarting mcm therefore restarts all servers (auto-start ones come back). mcm cannot re-attach to a native process; `NativeSpawner::adopt()` returns `None` and kills verified orphans. The `shim` and `docker` runtimes in [P10](../10-isolation-limits/README.md) survive mcm restarts through the same `ProcessSpawner::adopt()` seam defined in [process-model.md](../../architecture/process-model.md#spawner-trait-single-definition).

## Scope

- New crates: `mcm-process` (supervisor, dedicated spawner thread, stdio, log ring, platform), `mcm-protocol` (VarInt, framing, handshake, SLP, RCON codec + client, `text::log_prefix` matchers), `mcm-download` (`SafeHttp` SSRF-safe client, `HttpDownloader`), `mcm-fs` (initial modules: `properties`, `copy`, `trash`, `eula`), `fake-mc-server` (test fixture).
- `servers` table; `ServerService`, `ServerRepo`, `ProcessSpawner` traits in `mcm-core`; implementations wired in `mcm-server`.
- Flavor `custom` only: `source.kind` `url` (admin) or `import` from an allow-listed directory (admin); `javaPath` from a detected system Java or an explicit path (admin). Request/response contract per [server-api.md](../../architecture/server-api.md).
- Game-port allocation with conflict detection. **RCON is not enabled or managed** (P5).
- Supervisor actor: state machine, flavour-aware chat-spoof-proof ready detection + SLP, stop sequence, kill, restart, crash detection with backoff budget, crash logs, `adopt()`-based orphan cleanup, auto-start with stagger, manager shutdown. mcm state in `<data>/state/<id>/`, server files in `<data>/servers/<id>/`.
- Clone (job), delete (job, trash), rename and lifecycle-policy edits.
- Console: `LogRing`, WS topic `console:<id>` with `{epoch, sinceSeq}` resume, `lagged`, `reset`; commands via WS op and REST; console.log rotation; xterm.js rendering; per-user command history (client-side).
- Minimal EULA: detect "must agree to EULA" exit, `POST /servers/{id}/eula`.
- UI: dashboard with server cards, create wizard (custom), overview page, console page.

## Non-goals

- server.properties editor, JVM/memory editing after creation, whitelist/ops/bans, file manager (phase 2).
- Managed JRE downloads and vendor installers (phase 3).
- Player counts, TPS, metrics, enabling RCON (P5) — the RCON client exists but is unused outside tests.
- Docker, shim runtime, cgroups (P10). Re-attaching to native processes (impossible; see the limitation above).
- Multi-node (P11, post-1.0): only the `node_id` column and the `ProcessSpawner`/`ServerService` seams exist.
- Windows.

## User stories

| ID | Story |
|---|---|
| P1-US-01 | As an admin I create a server by pasting a server jar URL (with optional SHA-256) and picking a detected Java. |
| P1-US-02 | As an admin I import an existing server directory from `/srv/minecraft/old-server` without re-downloading anything. |
| P1-US-03 | As an operator I start a server, watch the console stream in colour, and see it turn "Running" when it's ready. |
| P1-US-04 | As an operator I stop a server and it saves and exits cleanly; if it hangs, mcm escalates to SIGTERM then SIGKILL. |
| P1-US-05 | As an operator I type commands in the console with ↑/↓ history and see them echoed with my name. |
| P1-US-06 | As an operator my crashed server restarts automatically, but a crash loop stops after 3 tries and I'm told why. |
| P1-US-07 | As an operator my servers marked auto-start come back after the host reboots. |
| P1-US-08 | As an operator I clone a server to test changes, and delete servers I no longer need. |
| P1-US-09 | As an operator I'm told the EULA must be accepted and can accept it with one click. |
| P1-US-10 | As an operator I reload the console page and see the recent history without gaps or duplicates — even after mcm itself restarted. |
| P1-US-11 | As an operator I'm not fooled by a player typing a fake "Done" line in chat. |

## Dependencies

Phase 0 (auth, jobs, audit catalog, WS hub, AppState, testkit, `mcm-api-tests`).

## Exit checklist

- [ ] All P1 FRs implemented; all tests in [tests.md](tests.md) pass in CI without Java.
- [ ] `mcm-protocol` and `mcm-download::safe_http` ≥ 95 % line coverage; fuzz targets `varint_decode`, `handshake_parse`, `slp_response_parse`, `rcon_packet_decode`, `log_prefix_parse` in `fuzz-smoke`.
- [ ] Nightly smoke `smoke_p1_custom_jar_lifecycle` passes (URL source of the Mojang server jar; Java from `actions/setup-java` — the documented exception in [testing/e2e.md](../../testing/e2e.md#real-server-smoke-suite-opt-in) until P3 managed JREs).
- [ ] `native_spawn_survives_blocking_pool_thread_reaping` and `console_resume_after_manager_restart_resets` green.
- [ ] Backpressure test: 50k lines/s flood for 10 s with a stalled WS client → mcm RSS growth < 50 MiB, fake server never blocks on stdout.
- [ ] Manual check on a VM: `systemctl restart mcm` stops servers gracefully and auto-starts flagged ones; release notes and UI state the limitation.
- [ ] Axe clean on dashboard, create wizard, overview, console.

## Files

[requirements](requirements.md) · [api](api.md) · [ui](ui.md) · [tests](tests.md) · [fake-server-scope](fake-server-scope.md)
