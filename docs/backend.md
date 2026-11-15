# Backend development

Chunkyard runs Minecraft in Docker. Java is supplied by each server's container image; the manager does not discover, install or execute Java on the host. Managed installers choose the Java image required by the selected Minecraft version or mod loader.

```sh
cargo run -p mcm-server -- serve
cargo run -p mcm-server -- config check
cargo run -p mcm-server -- migrate
```

Build the UI with `pnpm --dir web build` to serve it on the same origin. Set `CHUNKYARD_HTTP__UI_DIR=` for API-only development. Use `--data-dir` or `CHUNKYARD_DATA_DIR` to choose storage. Commands print JSON to stdout and diagnostics to stderr.

The REST contract is in [http-api.md](http-api.md), Docker settings in [docker.md](docker.md), and integration authentication in [integrations-contract.md](integrations-contract.md). The [implementation status](implementation-status.md) records the current product scope.

## Migrating from host Java management

The `java` CLI subcommand, `/api/v1/java/*` routes and `[java]` configuration are removed. Remove `[java]` from TOML and `CHUNKYARD_JAVA__ALLOW_SYSTEM_JAVA` from the environment; unknown settings fail validation. Existing Docker instances and their image choices are unchanged. Historical inventory database tables/migrations and existing downloaded runtime files are preserved, but unused. Remove old `<data-dir>/runtimes/java` files manually if you no longer need them.

## Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
```

On NixOS, use `nix shell nixpkgs#rustfmt nixpkgs#clippy -c` when those tools are unavailable. Tests use temporary data and local fixtures. Real Docker/download/storage tests are opt-in and must use disposable instances.
