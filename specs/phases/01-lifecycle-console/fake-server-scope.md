# Phase 1 — `fake-mc-server` scope

Full design: [testing/fake-server.md](../../testing/fake-server.md). Phase 1 creates the crate and implements the subset below; later phases extend it in their own specs.

## Implemented in phase 1

| Area | Items |
|---|---|
| Modes | Direct (`--profile`, `--port`, `--rcon-port`, `--rcon-password`), Java shim (`argv[0]` = `java`: skip `-X*`/`-D*`/`-XX:*`, `-jar <file>`, `@<argsfile>`, trailing `nogui`), `-version` (stderr `openjdk version "<v>" …`, version from `FAKE_JAVA_VERSION` or `../release`) |
| Profile keys | `version_name`, `protocol`, `startup_delay_ms`, `done_line`, `read_server_properties`, `require_eula`, `players`, `max_players`, `stop_behaviour` (graceful/ignore/hang/slow:ms), `crash_after_ms`, `exit_code_on_crash`, `spawn_child`, `ignore_sigterm`, `flood_lines_per_sec`, `long_line_bytes`, `ansi`, `flavor` (selects the log family), `rcon_fragment_bytes` |
| Log formats | Exact family formats from [log-formats.md](../../architecture/log-formats.md) for `vanilla`/`quilt`, `fabric`, `paper`/`purpur`, `forge`/`neoforge` (ready line, EULA line, join/leave, chat). Chat lines use the flavour's chat format (`<name> msg`, Paper may prefix `[Not Secure]`). |
| stdin | `stop`, `list`, `say`, `save-all [flush]`, `save-off`, `save-on`, `fakecrash`, `fakeflood <n>`, `fakebig`, `fakejoin`/`fakeleave` (console lines only), `fakechat <name> <msg>` (logs a chat line in the family's chat format — used by spoof tests), unknown-command message |
| Network | SLP (status + ping, legacy `0xFE` reply), RCON (auth, `-1` on bad password, 4096 fragmentation, `Unknown request <hex>` for unknown types) |
| Files | Reads `server.properties` (`server-port`, `enable-rcon`, `rcon.port`, `rcon.password`, `max-players`, `motd`) — RCON is exercised only by protocol tests in P1, since mcm doesn't enable it until P5 — reads `eula.txt`, writes `logs/latest.log` |
| Signals | SIGTERM → `Stopping server`, exit 143 unless `ignore_sigterm` |
| Control channel | `FAKE_MC_CONTROL` JSON-lines: `start`, `stdin`, `rcon_auth`, `rcon_exec`, `slp`, `exit` |

## Deferred

| Item | Phase |
|---|---|
| whitelist/ops/bans commands writing JSON files | 2 |
| Forge/NeoForge/Quilt installer shims | 3 |
| `memory_mb`, `tps`, `mspt`, `tick query`, `forge tps`, Query (UDP) | 5 |
| `world_dir`, `save_delay_ms` semantics for backups | 6 |
| `velocity`/`bungeecord`/`waterfall` families and stop commands (`shutdown`/`end`) | 3 |
| Management protocol (WebSocket JSON-RPC) | 5 |
| Login-state disconnect, PROXY v2 acceptance | 7 |

## Build integration

- When the smoke suite's captured fixtures ([log-formats.md § Fixtures](../../architecture/log-formats.md#fixtures)) differ from what the fake emits, the fake is updated (parity test `log_format_matches_family_fixture_for_each_flavor`).
- `crates/fake-mc-server` is a workspace member with `publish = false`; `chunkyard-testkit` locates it via `escargot` (builds once per test run, cached in `target/`), exposed as `FakeMc::path()`.
- E2E: CI builds it in `build-release` and passes `FAKE_MC_BIN`; the E2E fixture creates a FakeJava dir and creates servers with `javaPath` pointing at it and a `server.jar` profile file served by the upstream mock (URL source).
