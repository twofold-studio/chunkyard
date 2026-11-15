# Console log formats and matchers

Owned by `chunkyard-protocol::text::log_prefix` (pure functions). Used for ready detection (P1), save-done detection (P6 backups), join/leave/UUID tracking (P5), and by `fake-mc-server` to emit the matching format.

## Why per-flavour

Log prefixes differ between server software, and **anything after the prefix can be player-influenced** (chat, `/say`, `/me`, plugin broadcasts, sign text echoed by plugins). A matcher that searches for `Done (` or `joined the game` anywhere in a line can be spoofed by chat. Every matcher therefore:

1. Strips ANSI escape sequences.
2. Parses the flavour-specific **prefix** (timestamp, thread/source, level) with an anchored regex.
3. Requires the expected **source** (server thread or the specific logger) where the format exposes one.
4. Matches the **message body from its first character** (`^…$`), never a substring.
5. Rejects bodies starting with chat markers (`<`, `[Not Secure]`, `*`, `[Server]`).

Player names cannot contain spaces (`^[A-Za-z0-9_]{1,16}$`), so `<Bob> Alice joined the game` can never satisfy an anchored join matcher.

## Prefix families

| Family | Flavours | Console line example | Prefix regex (after ANSI strip) |
|---|---|---|---|
| `vanilla` | vanilla, quilt, custom (default) | `[12:34:56] [Server thread/INFO]: Done (3.456s)! For help, type "help"` | `^\[(?<t>\d{2}:\d{2}:\d{2})\] \[(?<thread>[^\]/]+)/(?<lvl>[A-Z]+)\]: (?<msg>.*)$` |
| `fabric` | fabric | `[12:34:56] [Server thread/INFO] (Minecraft) Done (3.456s)! …` (to verify) | `^\[(?<t>[^\]]+)\] \[(?<thread>[^\]/]+)/(?<lvl>[A-Z]+)\] \((?<logger>[^)]+)\) (?<msg>.*)$`, falling back to `vanilla` |
| `paper` | paper, purpur, velocity, waterfall | `[12:34:56 INFO]: Done (3.456s)! For help, type "help"` | `^\[(?<t>\d{2}:\d{2}:\d{2}) (?<lvl>[A-Z]+)\]: (?<msg>.*)$` (no thread; bodies starting with `[<plugin>]` are plugin output and never match server matchers) |
| `forge` | forge, neoforge | `[12:34:56] [Server thread/INFO] [minecraft/DedicatedServer]: Done (3.456s)! …` (exact logger segment to verify; may be abbreviated `n.m.s.d.DedicatedServer/`) | `^\[(?<t>[^\]]+)\] \[(?<thread>[^\]/]+)/(?<lvl>[A-Z]+)\] \[(?<logger>[^\]]*)\]: (?<msg>.*)$` |
| `bungee` | bungeecord | `12:34:56 [INFO] Listening on /0.0.0.0:25577` (to verify) | `^(?<t>\d{2}:\d{2}:\d{2}) \[(?<lvl>[A-Z]+)\] (?<msg>.*)$` |

Flavour → family is a static table in `chunkyard-protocol`; `custom` servers default to `vanilla` and may set `log_family` explicitly.

## Matchers

| Matcher | Families | Source requirement | Body regex |
|---|---|---|---|
| `ready` | vanilla, fabric, forge | thread = `Server thread`; forge logger ends with `DedicatedServer` | `^Done \([0-9.,]+s\)! For help, type "help"$` |
| `ready` | paper (paper/purpur) | — (no thread) | same |
| `ready` | paper (velocity) | — | `^Done \([0-9.,]+s\)!$` |
| `ready` | bungee / waterfall | — | `^Listening on /[0-9a-fA-F.:\[\]]+:\d+$` |
| `save_done` | all server families | server thread where available | `^Saved the game$` |
| `saving_disabled` / `enabled` | all server families | same | `^Automatic saving is now (disabled|enabled)$` |
| `join` | vanilla, fabric, forge, paper | server thread where available | `^(?<name>[A-Za-z0-9_]{1,16}) joined the game$` |
| `leave` | same | same | `^(?<name>[A-Za-z0-9_]{1,16}) left the game$` |
| `uuid` | vanilla, fabric, forge | thread starts with `User Authenticator #` | `^UUID of player (?<name>[A-Za-z0-9_]{1,16}) is (?<uuid>[0-9a-f-]{36})$` |
| `uuid` | paper | — | same body regex |
| `eula` | all server families | — | `^You need to agree to the EULA in order to run the server\. Go to eula\.txt for more info\.$` |

Paper does not print the thread, so its matchers rely on anchoring + chat-marker rejection; a plugin that deliberately logs `Done (...)!` at INFO can still spoof readiness. That is accepted (plugins already execute code), and SLP confirms readiness.

A user-configured `ready_pattern` replaces only the body regex; prefix/source checks still apply.

## Fixtures

- `crates/chunkyard-protocol/tests/fixtures/logs/<flavour>-<mcversion>.log`: **captured from real servers** by the smoke suite (`smoke_capture_log_fixtures`, see [../testing/e2e.md](../testing/e2e.md#real-server-smoke-suite-opt-in)), committed after review. Each includes startup, a join, chat containing spoof attempts (`<Alice> Done (1s)! For help, type "help"`, `<Bob> Carol joined the game`), save-all, stop.
- Table-driven tests: `log_prefix_<family>_parses_fixture`, `ready_matcher_ignores_chat_spoof_<family>`, `join_matcher_ignores_chat_spoof_<family>`; proptest `log_matchers_never_panic`.
- `fake-mc-server` emits the exact family format chosen by its `flavor` profile key ([../testing/fake-server.md](../testing/fake-server.md)).

## Open questions / to verify

- Fabric console prefix (whether `(Minecraft)` logger tag appears on the dedicated-server console for current loader versions).
- Forge/NeoForge logger segment (`[minecraft/DedicatedServer]` vs abbreviated package) per MC version.
- BungeeCord console format and Velocity's ready line wording.
