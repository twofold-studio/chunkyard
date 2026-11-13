# mcm — Minecraft server manager: specifications

## Vision

A self-hosted Minecraft server manager shipped as **one Rust binary** with an embedded web UI. Install it on a Linux box, open the browser, and create, run, mod, monitor, back up and expose any number of Java Edition servers — without installing Java yourself and without opening router ports. Comparable to Pterodactyl, Crafty Controller, AMP and MCSManager, but with no PHP/Python/Node runtime, no separate daemon/panel split until multi-node is needed, and a test suite that runs without Java or internet.

## How to read the specs

1. [architecture/overview.md](architecture/overview.md) — system shape and technology choices.
2. [architecture/patterns.md](architecture/patterns.md) — **binding conventions**; every phase follows them.
3. [architecture/workspace-layout.md](architecture/workspace-layout.md) — crates and dependency rules.
4. [testing/strategy.md](testing/strategy.md) — what "tested" means and the definition of done.
5. Then the phase you're implementing: its `README.md` first, then `requirements.md`, `api.md`, `ui.md`, `tests.md`.

A phase spec plus the architecture docs is sufficient to implement that phase. When a phase contradicts an architecture file, the architecture file wins unless the phase explicitly says "overrides".

### Phase directory template

| File | Contains |
|---|---|
| `README.md` | Goal, scope, non-goals, user stories, dependencies, exit checklist |
| `requirements.md` | Numbered functional requirements `Pn-FR-xx` (each names crates, permission, audit action, events), edge cases & failure modes, security considerations |
| `api.md` | REST endpoints, WebSocket messages, DB migration, events |
| `ui.md` | Screens, components, states |
| `tests.md` | Named test cases with crate/location, mapped to FR IDs |
| extra files | Phase-specific references (e.g. external API details) |

### ID conventions

- Requirements: `P<phase>-FR-<nn>` (e.g. `P1-FR-07`). Non-functional: `P<phase>-NFR-<nn>`.
- Migrations: named by description in specs (`p1_servers.sql`); the numeric prefix is assigned at merge time ([patterns.md §3](architecture/patterns.md#3-repository-pattern)).
- Audit actions: only names from [audit.md](architecture/audit.md).
- Tests: Rust `snake_case` names, TS `describe › it` strings; each listed with the FR(s) it covers.
- Error codes: dotted (`server.busy`), catalogued in each phase `api.md` and [architecture/errors-and-logging.md](architecture/errors-and-logging.md).

## Index

| Area | Files |
|---|---|
| Architecture | [overview](architecture/overview.md) · [workspace-layout](architecture/workspace-layout.md) · [patterns](architecture/patterns.md) · [process-model](architecture/process-model.md) · [log-formats](architecture/log-formats.md) · [server-api](architecture/server-api.md) · [audit](architecture/audit.md) · [data-model](architecture/data-model.md) · [api-conventions](architecture/api-conventions.md) · [auth](architecture/auth.md) · [security](architecture/security.md) · [errors-and-logging](architecture/errors-and-logging.md) · [config](architecture/config.md) · [filesystem-layout](architecture/filesystem-layout.md) · [frontend](architecture/frontend.md) · [minecraft-protocols](architecture/minecraft-protocols.md) |
| Testing | [strategy](testing/strategy.md) · [fake-server](testing/fake-server.md) · [fixtures](testing/fixtures.md) · [frontend](testing/frontend.md) · [e2e](testing/e2e.md) · [ci](testing/ci.md) |
| Phases | see table below |

## Phases

Each phase is independently shippable: after it, the product is releasable and tested. Phase 0 is releasable and tested but not yet useful on its own; from phase 1 on, every phase adds user value. **1.0 = phases 0–10.** Phase 11 is post-1.0; earlier phases only keep the seams it needs ([patterns.md §4](architecture/patterns.md#4-services-and-dependency-injection)).

| # | Directory | Delivers | Main crates | Depends on |
|---|---|---|---|---|
| 0 | [00-foundation](phases/00-foundation/README.md) | Workspace, CI, config, DB, setup wizard, login, **TOTP 2FA, session list/revoke, security headers + CSP**, API tokens, jobs, audit log, SPA shell, OpenAPI/TS pipeline | core, config, db, auth, api, server, testkit, api-tests | — |
| 1 | [01-lifecycle-console](phases/01-lifecycle-console/README.md) | Create (custom jar + system Java), start/stop/restart/kill, delete, clone, auto-start, crash restart, live console. **Native servers stop when mcm restarts** | process, protocol, download, fs, api, fake-mc-server | 0 |
| 2 | [02-settings-files](phases/02-settings-files/README.md) | server.properties editor, JVM/memory, EULA, whitelist/ops/bans, file manager, chunked upload, zip/unzip, CodeMirror editor | fs, download, api | 1 |
| 3 | [03-java-installers](phases/03-java-installers/README.md) | Managed JREs (Adoptium), Java auto-selection, installers: vanilla, Paper, Purpur, Fabric, Quilt, Forge, NeoForge, **Velocity, BungeeCord, Waterfall**; version switch | java, installers, download | 2 |
| 4 | [04-modpacks-content](phases/04-modpacks-content/README.md) | CurseForge server packs + client-pack conversion, manual-download flow, Modrinth `.mrpack`, mod/plugin browse & install (CF, Modrinth, Hangar) | modplatforms | 3 |
| 5 | [05-monitoring](phases/05-monitoring/README.md) | CPU/RAM/disk/TPS/MSPT/players, RCON + management protocol + SLP, history graphs, uptime, player sessions | metrics, protocol | 2 |
| 6 | [06-backups-scheduler-worlds](phases/06-backups-scheduler-worlds/README.md) | Backups (local/S3, retention, restore), cron schedules, world upload/download/reset | backup, scheduler, worlds | 2, 5 |
| 7 | [07-network-exposure](phases/07-network-exposure/README.md) | Hostname router + PROXY v2, UPnP/NAT-PMP/PCP port mapping | router, portmap, protocol | 1, 2 |
| 8 | [08-users-audit-notifications](phases/08-users-audit-notifications/README.md) | Multi-user, roles, per-server grants (native single-trust rules), audit UI, Discord/webhook notifications | auth, notify | 0–7 |
| 9 | [09-relay](phases/09-relay/README.md) | Self-hostable `mcm-relay` with TLS tunnel; alternatives (frp, playit.gg, WireGuard) documented | relay, tunnel, tunnel-proto | 7 |
| 10 | [10-isolation-limits](phases/10-isolation-limits/README.md) | Docker runtime, `mcm-shim` runtime (servers survive mcm restarts), delegated cgroup v2 limits | process, shim | 1, 3, 8 |
| 11 | [11-multi-node](phases/11-multi-node/README.md) | **Post-1.0.** Remote nodes running `mcm agent`, controlled by a primary | node, server, api | 0–10 |

## Glossary

| Term | Meaning |
|---|---|
| **mcm** | The manager binary (and the product) |
| **Server** | One managed Minecraft Java Edition server instance (directory + config + process) |
| **Flavor** | Server software: vanilla, paper, purpur, fabric, quilt, forge, neoforge, velocity, bungeecord, waterfall, custom |
| **Loader** | Mod loader (Forge, NeoForge, Fabric, Quilt) |
| **LaunchSpec** | How to start a server: jar path, args file, or custom args |
| **Supervisor** | Per-server actor owning the child process |
| **Ring / LogRing** | Bounded in-memory console buffer per server |
| **Job** | Persisted long-running operation with progress and cancellation |
| **SandboxRoot** | Path resolver that confines file operations to a server directory |
| **SLP** | Server List Ping (status protocol over the game port) |
| **RCON** | Remote console protocol (TCP, Source-style) |
| **Router** | mcm's Minecraft-protocol hostname router (P7) |
| **Relay** | `mcm-relay`, public server that accepts agent tunnels (P9) |
| **Agent** | An `mcm` instance connected to a relay (P9) or primary (P11) |
| **Runtime** | How a server process is hosted: `native` (P1), `shim` or `docker` (P10) |
| **Epoch** | Per-run id of the mcm process; console `seq` numbers are only comparable within one epoch |
| **Single-trust** | Native-runtime rule: code-execution permissions are admin-only ([security.md](architecture/security.md#native-runtime-is-single-trust)) |
| **Management protocol** | Vanilla 1.21.9+ JSON-RPC/WebSocket server API (`management-server-*` properties) |
| **Pack** | Modpack (CurseForge zip with `manifest.json`, or Modrinth `.mrpack`) |
| **Server pack** | A CurseForge file flagged as server-side distribution of a pack |
| **Content** | Mods, plugins, datapacks installed on a server |
| **Target** | Backup storage destination (local dir, S3 bucket) |

## Cross-cutting open questions

Collected from all files; each is repeated where it matters.

| Topic | Question | Where |
|---|---|---|
| Paper API | Final status of `api.papermc.io/v2` deprecation vs `fill.papermc.io/v3`; implement v3 with v2 fallback | phase 3 |
| RCON | Reply type for unknown packet types (sentinel technique) | minecraft-protocols |
| TPS formats | `mspt`, `tick query`, `neoforge tps`, `spark tps` | minecraft-protocols |
| Java mapping | Required Java for year-versioned releases (26.x) — rely on `javaVersion` in Mojang version JSON | phase 3 |
| Log formats | Fabric/Forge/NeoForge/BungeeCord console prefixes — captured by smoke suite | log-formats |
| Management protocol | Availability on non-vanilla flavours; method names beyond players/allowlist | minecraft-protocols |
| CurseForge | Reliability of environment tags in `gameVersions` for client-only detection | phase 4 |
