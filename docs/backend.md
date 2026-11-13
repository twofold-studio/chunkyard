# Backend development

The backend includes Java runtime management, strict configuration, owner/session authentication, a JSON HTTP service, and persistent install jobs. Start it with `cargo run -p mcm-server -- serve`. Build the UI with `pnpm --dir web build` first to serve it on the same address, or use `CHUNKYARD_HTTP__UI_DIR=` for API-only development. See [the current HTTP API](http-api.md) for setup and integration. The first frontend slice is implemented in `web/`; see [frontend usage](frontend.md) for its screens and development setup.

```sh
cargo run -p mcm-server -- java discover
cargo run -p mcm-server -- java releases
cargo run -p mcm-server -- java install 8
cargo run -p mcm-server -- java install 21
cargo run -p mcm-server -- java list
cargo run -p mcm-server -- java select 8 --strict
cargo run -p mcm-server -- java inspect /path/to/bin/java
```

Use `--data-dir /path/to/data` or `CHUNKYARD_DATA_DIR` to choose storage. The default is `./data`. Commands print JSON to stdout and diagnostics to stderr. Runtime IDs stay stable across discovery and repeated installations. A future server record can pin this ID; `mcm_java::select` handles automatic selection.

Discovery checks `JAVA_HOME`, `PATH`, and common vendor directories on Windows and Linux. Executable aliases are deduplicated, probes run four at a time, each with a ten-second timeout and bounded output. JVM injection environment variables are not inherited. System runtimes are never modified. Only trusted administrators should invoke discovery or inspect: probing runs local executables.

Downloads use Temurin JREs from Adoptium for the host OS and architecture (x86-64 or ARM64). Availability depends on the upstream version/platform catalog; arbitrary historical Java releases are not guaranteed. Linux glibc, Alpine Linux, and Windows have separate assets. The host determines the download, independently of the manager binary's libc.

Managed installations live under `runtimes/java/`. Downloads stream to a private staging directory, verify SHA-256 and size, extract with size/path/link limits, and verify the executable before an atomic rename. A per-major OS file lock excludes concurrent installers for the same major; another install returns a busy error. Old versions remain available for pinned servers. Interrupted downloads do not enter the inventory; a completed rename interrupted before the database commit is recovered on retry. A process crash can leave `.install-*` staging directories; automatic cleanup is pending. Removal and automatic installation on server start will arrive with lifecycle integration. Managed installs are now also available through the HTTP job API.

The downloader uses separate fixed HTTPS allowlists for Adoptium/GitHub Java downloads and official Mojang/Paper software downloads, validates redirects, and connects using validated public DNS addresses. It is intentionally unsuitable for user-provided modpack or webhook URLs. Archive extraction requires a fresh private destination. Tar supports existing internal symlink targets; ZIP symlinks, hardlinks, special files, path traversal, and escaping links are rejected.

| Crate | Responsibility |
|---|---|
| `mcm-core` | Runtime domain types, repository interface |
| `mcm-db` | SQLite WAL, migrations, atomic inventory refresh |
| `mcm-download` | Restricted HTTPS, streaming integrity checks |
| `mcm-fs` | Bounded tar.gz and ZIP extraction |
| `mcm-process` | Docker lifecycle, container hardening, console I/O and server orchestration |
| `mcm-java` | Discovery, probing, Adoptium, installation, selection |
| `mcm-install` | Official Vanilla/Paper version catalogs, stable build selection and verified JAR preparation |
| `mcm-auth` | Password hashing, setup tokens, sessions, login throttling |
| `mcm-config` | Strict file/environment configuration and origin validation |
| `mcm-jobs` | Bounded job execution, persistence, recovery, shutdown |
| `mcm-api` | HTTP routes, session/origin checks, problem responses |
| `mcm-server` | CLI and dependency wiring |

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
```

On NixOS without formatting/lint tools in PATH, prefix their commands with `nix shell nixpkgs#rustfmt nixpkgs#clippy -c`.

Tests use temporary directories and local fixtures, without requiring installed Java or external network access. The CI workflow targets Linux and Windows and checks the declared Rust 1.88 minimum separately. Local real-download smoke tests exercised Java 8 and 21 on Linux; Windows execution has not been checked locally.

Docker lifecycle and console snapshots are now implemented; see [Docker usage](docker.md). Lightweight Docker resource sampling and OpenAPI documentation are implemented; see [monitoring](monitoring.md). Vanilla/Paper installers and version/build catalogs are implemented through the REST API; their UI is deferred. Next backend work includes modpack/loader installers, configuration editing, and live WebSocket console streaming. Authentication stays scoped to one owner with email/password and an environment-controlled bypass. The phase specifications remain design targets; [http-api.md](http-api.md) records the currently implemented subset.
