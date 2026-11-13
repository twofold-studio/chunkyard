# Testing strategy

Everything is tested. A feature is not done until its tests in the phase `tests.md` exist and pass in CI.

## Test pyramid

| Layer | Tool | Lives in | Runs in CI | Needs network/Java |
|---|---|---|---|---|
| Rust unit | `cargo nextest` | inline `#[cfg(test)]` | every push | no |
| Rust property | `proptest` | inline or `tests/prop_*.rs` | every push (256 cases), nightly (10k) | no |
| Rust integration (crate) | `cargo nextest` | `crates/<c>/tests/*.rs` | every push | no |
| API integration | `mcm-testkit::TestApp` + reqwest/tungstenite | `crates/mcm-api-tests/tests/*.rs` | every push | no (fake-mc + wiremock) |
| Snapshot | `insta` | alongside tests | every push | no |
| Fuzz | `cargo-fuzz` (libFuzzer) | `fuzz/fuzz_targets/*.rs` | PR: 60 s/target smoke; nightly: 15 min/target | no |
| Frontend unit | Vitest | `web/src/**/*.test.ts` | every push | no |
| Frontend component | Vitest + `@testing-library/svelte` + jsdom | co-located | every push | no |
| E2E | Playwright against the real `mcm` binary + fake-mc | `e2e/tests/*.spec.ts` | every push (Chromium), nightly (Chromium+Firefox+WebKit) | no |
| Real-server smoke | `cargo nextest -p mcm-server --features smoke` | `crates/mcm-server/tests/smoke_*.rs` | nightly + manual; opt-in locally `MCM_SMOKE=1` | **yes** (downloads JRE + real jars) |
| Relay soak | custom bin | `crates/mcm-relay/benches/` | nightly (phase 7+) | no |

## Principles

1. **No real external network in default tests.** All HTTP clients take a `base_url`; tests point them at `wiremock` servers with recorded fixtures ([fixtures.md](fixtures.md)). A test that touches the internet must be in the smoke suite.
2. **No Java in default tests.** The [fake Minecraft server](fake-server.md) stands in for `java`.
3. **Real I/O, temp dirs.** Integration tests use real SQLite files and real filesystems in `tempfile::TempDir`; no mocking of the filesystem.
4. **Deterministic time where it is pure logic.** Services take `Arc<dyn Clock>`; `FakeClock` / `tokio::time::pause()` are used **only** for pure-logic tests (backoff math, cron, retention, rollups, actors driven by a fake spawner). Tests involving real processes (fake-mc-server, installers) use real time with short configured timeouts and `wait_until` polling; paused time with real child processes is forbidden (it auto-advances while awaiting I/O and causes false timeouts).
5. **Parallel-safe.** Each test gets its own data dir, DB, and OS-assigned ports (bind to `127.0.0.1:0`). No global state; no fixed ports.
6. **Test through public interfaces.** Crate integration tests use only `pub` API; API tests use only HTTP/WS.
7. **Every FR maps to ≥ 1 named test**, and every documented error code is produced by ≥ 1 test.
8. **Security-critical code** (sandbox, archive extraction, auth decisions, protocol parsers, PROXY header, relay auth) must have unit + property tests + a fuzz target.

## `mcm-testkit` (crate)

| Helper | Purpose |
|---|---|
| `TestApp::spawn(opts)` | Builds `AppState` via the real composition root (`mcm-server` built with `test-hooks`) with temp data dir, binds `127.0.0.1:0`, returns base URL, typed client, and handles to fakes |
| `TestApp::login_owner()` | Runs setup + login; returns an authenticated `reqwest::Client` (cookie jar + CSRF header) |
| `TestApp::token(scopes)` | Creates an API token |
| `TestApp::ws()` | Connects to `/api/v1/ws`, helpers `subscribe`, `next_event_matching(pred, timeout)` |
| `FakeMc::path()` | Path to the built `fake-mc-server` binary (`env!("CARGO_BIN_EXE_fake-mc-server")` via a build-dependency trick, or `escargot`) |
| `FakeJre::build(dir, major)` | Produces a `.tar.gz` that looks like a Temurin JRE whose `bin/java` is the fake server (for Java runtime and installer tests) |
| `Upstreams::start()` | Starts wiremock servers for Mojang, Paper, Fabric, Quilt, Forge maven, NeoForge maven, Adoptium, CurseForge, Modrinth, Hangar, Discord with default fixtures mounted |
| `FakeClock` | Manual clock |
| `assert_problem(resp, status, code)` | Asserts problem+json shape |
| `wait_until(pred, timeout)` | Polling helper (never bare sleeps) |
| `capture_logs()` | tracing subscriber capturing output for `no_secrets_in_logs` assertions |

## Coverage

Measured with `cargo llvm-cov nextest --workspace` (excludes `fake-mc-server`, `mcm-testkit`, `mcm-api-tests`, `xtask`) and Vitest `--coverage` (v8).

| Scope | Line coverage gate |
|---|---|
| Workspace overall | ≥ 85 % |
| `mcm-fs::sandbox`, `mcm-fs::archive`, `mcm-auth`, `mcm-protocol` (incl. `text::log_prefix`), `mcm-download::safe_http`, `mcm-router`, `mcm-tunnel-proto` | ≥ 95 % |
| `mcm-api` handlers (measured via `mcm-api-tests`) | ≥ 90 % |
| `web/src/lib/**` (excluding `components/ui`, generated api) | ≥ 80 % |

CI fails if coverage drops below gate or decreases > 1 % vs `main`.

## Definition of done (per feature)

- [ ] FRs implemented as specified; deviations recorded in the phase spec.
- [ ] Unit tests for pure logic; integration tests for every endpoint (happy path, auth failure, permission failure, validation failure, documented conflict cases).
- [ ] WS messages covered by API tests asserting exact payload shape (snapshot).
- [ ] Frontend component tests for new components; at least one E2E path per user story.
- [ ] OpenAPI regenerated; TS types regenerated; `insta` snapshot of OpenAPI updated deliberately.
- [ ] Audit entry asserted for every mutating endpoint.
- [ ] Error codes documented and tested.
- [ ] Migration tested (`migrations_apply_cleanly_from_previous_release`); numbered monotonically at merge time.
- [ ] Every audit action used is in the catalog ([audit.md](../architecture/audit.md)).
- [ ] Coverage gates met; clippy/fmt/eslint/prettier/svelte-check clean.
- [ ] Docs: user-facing doc page updated if behaviour visible.

## Related

[fake-server](fake-server.md) · [fixtures](fixtures.md) · [frontend](frontend.md) · [e2e](e2e.md) · [ci](ci.md)
