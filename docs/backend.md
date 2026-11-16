# Backend development

Rust packages and directories use the `chunkyard-` prefix (`chunkyard-core`, `chunkyard-api`, `chunkyard-server`, etc.); Rust imports use `chunkyard_core`, `chunkyard_api`, etc. Existing source integrations must update their Cargo package/import names. The executable remains `mcm`, and this source rename does not migrate databases, instance directories, cookies or Docker ownership labels.

Chunkyard runs Minecraft in Docker. Java is supplied by each server's container image; the manager does not discover, install or execute Java on the host. Managed installers choose the Java image required by the selected Minecraft version or mod loader.

## Development shell

With Nix installed, run `nix develop`. For automatic activation, enable direnv's shell hook and run `direnv allow` once in this checkout; `.envrc` uses the same flake shell. `flake.lock` pins the tool versions. Outside Nix, `rust-toolchain.toml` selects stable Rust.

The shell provides the Rust compiler, Cargo, rustfmt, Clippy, rust-analyzer, Node.js 24, pnpm, Changie, SQLite and Docker client tools. On Linux it also provides Chromium and sets `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for the browser tests. Other platforms can install Playwright's browser with `pnpm --dir web exec playwright install chromium`.

Entering the shell does not run dependency installs, start Docker or load `.env` files. Run `pnpm --dir web install --frozen-lockfile` yourself; Docker integration checks need a host Docker engine and permission to use its socket. No host Java installation is needed.

Release builds use optimization level 3, one code-generation unit, thin LTO and stripped symbols. Build with `cargo build --release -p chunkyard-server`; these settings trade longer compilation for optimization opportunities without changing panic unwinding.

## Running the backend

```sh
cargo run -p chunkyard-server -- serve
cargo run -p chunkyard-server -- config check
cargo run -p chunkyard-server -- migrate
```

Build the UI with `pnpm --dir web build` to serve it on the same origin. Set `CHUNKYARD_HTTP__UI_DIR=` for API-only development. Use `--data-dir` or `CHUNKYARD_DATA_DIR` to choose storage. Commands print JSON to stdout and diagnostics to stderr.

The REST contract is in [http-api.md](http-api.md), Docker settings in [docker.md](docker.md), and integration authentication in [integrations-contract.md](integrations-contract.md). The [implementation status](implementation-status.md) records the current product scope.

## Migrating from host Java management

The `java` CLI subcommand, `/api/v1/java/*` routes and `[java]` configuration are removed. Remove `[java]` from TOML and `CHUNKYARD_JAVA__ALLOW_SYSTEM_JAVA` from the environment; unknown settings fail validation. Existing Docker instances and their image choices are unchanged. Historical inventory database tables/migrations and existing downloaded runtime files are preserved, but unused. Remove old `<data-dir>/runtimes/java` files manually if you no longer need them.

## Checks

`node scripts/check-architecture.mjs` enforces the current workspace dependency boundaries and a 400-line budget for Rust source and test files. The policy is in `scripts/architecture-policy.json`; size exceptions need a documented reason and an explicit budget, and stale exceptions fail. Static schemas and recorded non-Rust fixtures are outside this limit. This is a review guardrail: preserve cohesive ownership and readable functions rather than compressing code to satisfy a counter.

The production dependency graph keeps shared contracts in `chunkyard-core`, SQLite implementations in `chunkyard-db`, and HTTP transport in `chunkyard-api`/`chunkyard-server`. The server crate assembles concrete implementations; internal modules remain private unless another crate needs their interface. Test-only packages cannot become production dependencies.

`chunkyard_server::wiring::build_state` assembles production services. Tests use `build_state_with_dependencies` to supply a runtime and software provider before assembly, so HTTP, background operations and shutdown share the same service instances. Export operations acquire a guarded instance interface that retains admission and task leases through snapshotting and publication.

The `chunkyard-api-tests` package is retained as a test-only system suite. Related scenarios are nested modules under the `contracts`, `instances`, `streams` and `storage` test targets; real Docker targets remain separate and opt-in. This compiles shared fixtures fewer times while retaining independent temporary databases and runtimes. CI uses four test threads to bound simultaneous fixture work; use `RUST_TEST_THREADS=4` locally on constrained machines.

```sh
node --test scripts/check-architecture.test.mjs
node scripts/check-architecture.mjs
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
```

For a focused HTTP/WS run, use `cargo test -p chunkyard-api-tests --test instances` or filter a nested module, such as `cargo test -p chunkyard-api-tests --test contracts api_keys_mcp::`.

On NixOS, use `nix shell nixpkgs#rustfmt nixpkgs#clippy -c` when those tools are unavailable. Tests use temporary data and local fixtures. Real Docker/download/storage tests are opt-in and must use disposable instances.
