# Fake Minecraft server (`fake-mc-server`)

A small Rust binary in `crates/fake-mc-server` (depends only on `mcm-protocol`, `tokio`, `clap`). It behaves enough like a Minecraft server that the manager cannot tell the difference in tests, so CI needs neither Java nor Mojang downloads.

## Invocation modes

| Mode | How | Purpose |
|---|---|---|
| Direct | `fake-mc-server --port 0 …` | Unit/integration tests of protocol clients |
| **Java shim** | Installed/symlinked as `bin/java` inside a `FakeJre`. When `argv[0]` file name is `java`, it parses Java-style args: skips `-X*`, `-D*`, `-XX:*`, honours `-jar <file>` / `@<argsfile>` and trailing `nogui` | End-to-end lifecycle through the real spawn path |
| Installer shim | `java -jar <forge|neoforge>-installer.jar --installServer [dir]` | Pretends to be a Forge/NeoForge installer: creates `libraries/net/<vendor>/<…>/<ver>/unix_args.txt`, `run.sh`, `user_jvm_args.txt`; exits 0 (or per behaviour file) |
| Quilt/Fabric installer shim | `java -jar quilt-installer.jar install server <mc> <loader> --download-server` | Creates `quilt-server-launch.jar` + `server.jar` stubs |
| `-version` | `java -version` | Prints `openjdk version "21.0.5" …` to stderr (version taken from `FAKE_JAVA_VERSION` env or the FakeJre's `release` file) — used by Java discovery |

The "jar" files the shim is pointed at are plain text files containing a TOML **behaviour profile** (see below), so tests control behaviour by writing `server.jar`.

## Behaviour profile (`server.jar` content or `--profile file.toml`)

```toml
version_name = "1.21.1"
protocol = 767
startup_delay_ms = 300            # time before "Done" line
done_line = true                   # print vanilla "Done (0.300s)! For help, type \"help\""
read_server_properties = true      # honour server-port, enable-rcon, rcon.port, rcon.password, max-players, motd, enable-query
require_eula = true                # if eula.txt lacks eula=true: print vanilla EULA message and exit(0)
players = ["Alice", "Bob"]         # online players for list/SLP/query
max_players = 20
stop_behaviour = "graceful"        # graceful | ignore | hang | slow:<ms>
crash_after_ms = 0                 # >0: exit(1) after N ms with a stack trace-like stderr
exit_code_on_crash = 1
spawn_child = false                # spawn a grandchild `sleep 3600` to test process-group kill
ignore_sigterm = false             # install SIGTERM handler that ignores it (tests SIGKILL escalation)
flood_lines_per_sec = 0            # emit N lines/sec to test backpressure
long_line_bytes = 0                # emit one line of N bytes to test truncation
ansi = true                        # colourise some output with ANSI codes
tps = 19.85                        # value reported by `tps`, `forge tps`, `tick query`
flavor = "paper"                   # affects log formats & tps command output
rcon_fragment_bytes = 0            # if >0, `fakebig` command returns this many bytes (tests 4096 fragmentation)
memory_mb = 256                    # allocate & touch this much RAM (tests RSS sampling); 0 = none
world_dir = "world"                # creates level.dat stub + region/ files on start
save_delay_ms = 50
```

## Behaviour details

| Feature | Behaviour |
|---|---|
| Log format | Exactly the family format for its `flavor` from [log-formats.md](../architecture/log-formats.md): vanilla/quilt `[HH:MM:SS] [Server thread/INFO]: …`, fabric `[HH:MM:SS] [Server thread/INFO] (Minecraft) …`, paper/purpur/velocity/waterfall `[HH:MM:SS INFO]: …`, forge/neoforge `[HH:MM:SS] [Server thread/INFO] [minecraft/DedicatedServer]: …`, bungeecord `HH:MM:SS [INFO] …`. Chat from `fakechat <name> <msg>` is logged in the flavour's chat format so spoof tests can run end-to-end. When the smoke suite captures real fixtures that differ, the fake is updated to match |
| stdin commands | `stop` (→ `Stopping the server`, saves, exit 0), `list`, `say <msg>` (→ `[Server] <msg>`), `save-all [flush]` (→ `Saving the game (this may take a moment!)` then `Saved the game`), `save-off` / `save-on` (→ `Automatic saving is now disabled/enabled`), `tps`, `mspt`, `tick query`, `forge tps`, `whitelist add/remove/list/reload`, `op`, `deop`, `ban`, `pardon`, `kick`, `fakejoin <name>` / `fakeleave <name>` (emit join/leave lines, mutate player list), `fakechat <name> <msg>`, `fakecrash`, `fakeflood <n>`, `fakebig`; unknown → `Unknown or incomplete command, see below for error` |
| Files | Reads `server.properties`; writes `whitelist.json`, `ops.json`, `banned-players.json`, `banned-ips.json` in vanilla JSON shape on the matching commands; writes `logs/latest.log` |
| SLP | Listens on `server-port`; full status + ping/pong; legacy `0xFE` response |
| RCON | Listens on `rcon.port` when `enable-rcon=true`; vanilla semantics: auth id `-1` on bad password; fragments at 4096; replies `Unknown request <hex type>` to unknown types |
| Query | UDP on `query.port` when `enable-query=true`; basic + full stat |
| Management protocol | When `management-server-enabled=true` and `version_name` ≥ 1.21.9: WebSocket JSON-RPC on `management-server-port` with bearer secret; `minecraft:players`, `minecraft:allowlist[/add|/remove]`, join/left notifications (P5) |
| Login | For router tests: accepts state 2 handshake then sends a Login Disconnect (`0x00` with JSON reason `"fake-mc: <server name>"`) so the router test can see which backend answered |
| PROXY v2 | `--accept-proxy-protocol` (or `proxy-protocol=true` in properties): parses a v2 header before the handshake and echoes the client address in the disconnect reason |
| Signals | SIGTERM → behaves like JVM shutdown hook (prints `Stopping server`, exits 143) unless `ignore_sigterm` |

## Control channel for assertions

`FAKE_MC_CONTROL=<path>` makes the fake append JSON lines describing received events (`{"ev":"stdin","line":"say hi"}`, `{"ev":"rcon_auth","ok":true}`, `{"ev":"proxy_header","src":"203.0.113.9:51234"}`) so tests can assert without scraping stdout.

## Tests for the fake itself

`crates/fake-mc-server/tests/`: `slp_roundtrip_with_mcm_protocol_client`, `rcon_auth_failure_returns_minus_one`, `rcon_fragmentation_over_4096`, `stop_command_exits_zero`, `eula_missing_exits_with_message`, `java_shim_parses_jar_and_ignores_jvm_flags`, `forge_installer_shim_creates_args_file`. The fake is also validated against reality: the nightly smoke suite runs the **same** scenario tests against real Paper/vanilla to catch drift (see [ci.md](ci.md)).
