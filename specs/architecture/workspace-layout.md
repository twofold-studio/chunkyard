# Workspace layout

## Repository tree

```
.
├── Cargo.toml                 # [workspace], shared [workspace.dependencies], lints
├── rust-toolchain.toml        # channel = "stable" (MSRV recorded in Cargo.toml)
├── deny.toml                  # cargo-deny: licenses, advisories, bans
├── .sqlx/                     # sqlx offline query metadata (committed)
├── crates/
│   ├── mcm-core/              # domain types, ids, events, jobs, audit catalog, ALL cross-crate + repo traits
│   ├── mcm-config/            # composes per-crate config sub-structs; loading (file + env)
│   ├── mcm-db/                # sqlx pool, migrations/, Sqlite*Repo impls
│   ├── mcm-jobs/              # bounded persistent job execution, restart recovery
│   ├── mcm-auth/              # password hashing, sessions, TOTP, tokens, permission decisions
│   ├── mcm-protocol/          # LEAF: VarInt, SLP, handshake, RCON, Query, PROXY v2, log-line parsers
│   ├── mcm-download/          # SSRF-safe HTTP client, Downloader, content-addressed cache, Mojang profile client
│   ├── mcm-process/           # supervisor, spawner thread, stdio, log ring, platform module
│   ├── mcm-fs/                # sandboxed paths, file ops, archives, properties parser
│   ├── mcm-java/              # JRE discovery, Adoptium download, version → Java mapping
│   ├── mcm-installers/        # vanilla/paper/purpur/fabric/quilt/forge/neoforge/velocity/bungeecord/waterfall
│   ├── mcm-modplatforms/      # curseforge/modrinth/hangar clients + pack importers
│   ├── mcm-metrics/           # sampling, TPS probes, rollups
│   ├── mcm-backup/            # archive create/restore, retention, storage targets
│   ├── mcm-worlds/            # world discovery, upload/download, reset
│   ├── mcm-scheduler/         # cron engine, task step executor
│   ├── mcm-router/            # Minecraft hostname router (P7)
│   ├── mcm-portmap/           # UPnP IGD / NAT-PMP / PCP (P7)
│   ├── mcm-notify/            # Discord/webhook notifier (P8)
│   ├── mcm-tunnel-proto/      # LEAF: agent↔relay wire protocol (P9)
│   ├── mcm-tunnel/            # agent-side tunnel client (P9)
│   ├── mcm-relay/             # BINARY `mcm-relay` (P9)
│   ├── mcm-shim/              # BINARY `mcm-shim` + lib (shim socket protocol) (P10)
│   ├── mcm-api/               # axum routes, handlers, DTOs, OpenAPI, WS hub
│   ├── mcm-server/            # BINARY `mcm` + lib (`wiring`): composition root, SPA embedding, CLI
│   ├── mcm-node/              # primary↔agent RPC (P11, post-1.0)
│   ├── mcm-testkit/           # test helpers (dev-dependency only)
│   ├── mcm-api-tests/         # HTTP/WS integration tests only (publish = false, no lib code)
│   └── fake-mc-server/        # BINARY test fixture (dev/CI only, never shipped)
├── web/  e2e/  fuzz/  docker/  packaging/  xtask/  testdata/
└── specs/
```

## Crate responsibilities and dependencies

| Crate | Owns | May depend on (internal) | Notable external deps |
|---|---|---|---|
| `mcm-core` | IDs, domain models, `Event`, `Job`, `audit::Action` catalog, `ErrorKind`/`Classify`, `Clock`, **all repo traits** (`ServerRepo`, `JobRepo`, …) and **all cross-crate service traits** (`ServerService`, `ServerLookup`, `ServerCommandSink`, `CommandRunner`, `ProcessSpawner`, `PropertiesEditor`, `BackupService`, `RconExecutor`, `Downloader`, …) | — | serde, thiserror, uuid, time, tokio-util, async-trait |
| `mcm-config` | `Config` = composition of each crate's `*Config` sub-struct; loading, validation | core + every crate that exports a `*Config` | figment |
| `mcm-db` | Pool, migrations, `Sqlite*Repo` impls of core repo traits | core | sqlx |
| `mcm-jobs` | Bounded persistent job execution, restart recovery, shutdown | core | tokio, tokio-util |
| `mcm-auth` | `AuthService`, argon2, TOTP, token gen, `authorize()` | core | argon2, rand, totp-rs |
| `mcm-protocol` | Codecs + async clients: SLP, RCON, Query, handshake, PROXY v2; pure parsers `text::{log_prefix, list, tps, join_leave}` | — (leaf) | tokio (io), bytes, serde_json |
| `mcm-download` | `SafeHttp` (SSRF-safe resolver with IP pinning, shared by **every** outbound fetch), `HttpDownloader` (hash verify, resume, cache), Mojang profile client | core | reqwest, sha1, sha2 |
| `mcm-process` | `Supervisor` actor, `ServerHandle`, `LogRing`, spawner thread, `NativeSpawner`, `DockerSpawner` (P10), `ShimSpawner` (P10), `CommandRunner` impl, platform | core, protocol, shim (P10, lib only) | tokio, nix, bollard (P10) |
| `mcm-fs` | `SandboxRoot`, file ops, zip/tar, `.properties` & JSON list editors, trash | core | zip, tar, zstd, cap-std |
| `mcm-java` | `JavaRuntimeService`, Adoptium client, version → major mapping, `VersionMetaSource` trait | core, fs, download | — |
| `mcm-installers` | `Installer` trait + one module per flavour, `LaunchSpec`, run-script parser | core, fs, java, download | — |
| `mcm-modplatforms` | `ModPlatform` trait, CF/Modrinth/Hangar clients, pack importers | core, fs, installers, download | murmur2 |
| `mcm-metrics` | Collector, `TpsProbe` per flavour, rollups | core, protocol | sysinfo |
| `mcm-backup` | `BackupService` impl, `StorageTarget` (local, S3), retention | core, fs | object_store |
| `mcm-worlds` | `WorldService` impl | core, fs | — |
| `mcm-scheduler` | Cron engine, step executor | core | croner, chrono-tz |
| `mcm-router` | `McRouter`, synthetic responses, wake-on-join | core, protocol | — |
| `mcm-portmap` | `PortMapper` (UPnP/NAT-PMP/PCP), external IP classification | core | igd-next |
| `mcm-notify` | `Notifier`, Discord/webhook senders | core, download | hmac |
| `mcm-tunnel-proto` | Frames/codec for agent↔relay | — (leaf) | serde, postcard, bytes |
| `mcm-tunnel` | Tunnel client actor; hands data streams to `mcm-router`'s connection handler | core, tunnel-proto, router | rustls, yamux |
| `mcm-relay` | Relay binary | protocol, tunnel-proto | rustls, yamux, sqlx (own DB) |
| `mcm-shim` | Shim binary + client lib (unix-socket protocol) | — (leaf) | tokio |
| `mcm-api` | Router, handlers, DTOs, `ApiError`, OpenAPI, WS hub, `AppState` | core, auth, config (domain crates only for **types**, never constructing services) | axum, utoipa |
| `mcm-server` | `main`, `wiring::build_state`, SPA embed, CLI | everything | clap, rust-embed |
| `mcm-node` | Node RPC (post-1.0) | core, protocol | reqwest, tokio-tungstenite |
| `mcm-testkit` | `TestApp`, fakes, wiremock helpers, fake-mc launcher | core, db, server, protocol | wiremock, tempfile |
| `mcm-api-tests` | `tests/*.rs` only | dev: testkit, server, protocol | reqwest, tokio-tungstenite |
| `fake-mc-server` | Test fixture binary | protocol | clap |

## Dependency graph

```mermaid
flowchart BT
  core[mcm-core]
  protocol[mcm-protocol]
  tproto[mcm-tunnel-proto]
  shim[mcm-shim]
  db[mcm-db] --> core
  auth[mcm-auth] --> core
  download[mcm-download] --> core
  process[mcm-process] --> core
  process --> protocol
  process -. P10 .-> shim
  fs[mcm-fs] --> core
  java[mcm-java] --> fs
  java --> download
  inst[mcm-installers] --> java
  modp[mcm-modplatforms] --> inst
  metrics[mcm-metrics] --> core
  metrics --> protocol
  backup[mcm-backup] --> fs
  worlds[mcm-worlds] --> fs
  sched[mcm-scheduler] --> core
  router[mcm-router] --> protocol
  router --> core
  portmap[mcm-portmap] --> core
  notify[mcm-notify] --> download
  tunnel[mcm-tunnel] --> router
  tunnel --> tproto
  config[mcm-config] --> core
  api[mcm-api] --> auth
  api --> config
  server[mcm-server] --> api
  server --> db
  relay[mcm-relay] --> protocol
  relay --> tproto
  fake[fake-mc-server] --> protocol
  testkit[mcm-testkit] --> server
  apitests[mcm-api-tests] -. dev .-> testkit
```

(`mcm-config` → domain crates for `*Config` types and `mcm-server` → every crate are omitted from the graph for readability.)

## Rules (enforced in CI by `cargo xtask check-deps`)

1. **No cycles, no undeclared edges.** A crate may only depend on crates in its row. Adding an edge requires updating this file.
2. **Only `mcm-api` and `mcm-server` depend on `axum`, `tower`, `utoipa`.** DTOs with `ToSchema` live in `mcm-api::dto`.
3. **Leaves** (`mcm-protocol`, `mcm-tunnel-proto`, `mcm-shim`) depend on no `mcm-*` crate. They are exempt from the `Classify` rule ([patterns.md §1](patterns.md#1-errors)); consuming crates map leaf errors into their own error enums.
4. **Repo traits live in `mcm-core`.** Only `mcm-db` (and `mcm-relay`, for its own DB) depend on `sqlx`. No domain crate depends on `mcm-db`.
5. **Cross-area behaviour goes through `mcm-core` traits**, injected by `mcm-server::wiring`. Examples: scheduler → `BackupService`/`ServerService`; backup → `ServerCommandSink` (save-off/on) instead of `mcm-process`; metrics → `ServerLookup` + `RconExecutor` instead of `mcm-process`; router → `ServerService` (wake-on-join) + `PropertiesEditor`.
6. **Every external HTTP API sits behind a trait** in the consuming crate (`MojangApi`, `PaperApi`, `AdoptiumApi`, `CurseForgeApi`, …), built on `mcm_download::SafeHttp` with a configurable `base_url`.
7. **Config:** each crate defines its own `XxxConfig` (`Deserialize + Default`, `deny_unknown_fields`) and receives only that; `mcm-config` composes them. Domain crates never depend on `mcm-config`.
8. **No `anyhow` in library crates** (allowed in binaries' `main.rs`, `fake-mc-server`, tests).
9. **Test-only crates** (`mcm-testkit`, `mcm-api-tests`, `fake-mc-server`) are never normal dependencies of shipped binaries (`cargo tree -e normal -p mcm-server`). HTTP/WS integration tests live in `mcm-api-tests` so `mcm-api`/`mcm-server` need no dev-dependency on `mcm-testkit` (avoids the dev-dependency cycle and duplicate-crate type mismatches).
10. Workspace lints: `unsafe_code = "deny"` (exceptions with `// SAFETY:` only in `mcm-process::platform`), `clippy::unwrap_used = "deny"` outside tests, `missing_docs = "warn"`.

## Feature flags

| Crate | Feature | Default | Effect |
|---|---|---|---|
| `mcm-server` | `embed-ui` | on | Embed `web/build` (off for the Vite dev loop, see [frontend.md](frontend.md#embedding-and-dev-loop)) |
| `mcm-server` | `test-hooks` | **off; never enabled in release builds** | Upstream base-URL overrides, debug/no-op job route, fake clock injection. CI release job asserts the feature is absent (`mcm version --features`) |
| `mcm-backup` | `s3` | on | `object_store/aws` |
| `mcm-process` | `docker` | off until P10 | `DockerSpawner` via `bollard` |
| `mcm-portmap` | `upnp` | on | `igd-next` |

## Build outputs

- `mcm`, `mcm-relay`, `mcm-shim` — static musl binaries for x86_64 and aarch64.
- OCI image `ghcr.io/<org>/mcm` (debian-slim base because Adoptium JREs are glibc-linked; see [process-model.md](process-model.md#java-runtimes-and-libc)).

Current implementation note: Docker lifecycle is being implemented ahead of native/shim runtimes. The initial managed-JAR API and its limits are documented in `docs/docker.md`; the complete P1/P10 specs remain future targets.
