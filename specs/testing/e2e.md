# End-to-end tests (Playwright)

## Setup

- Located in `e2e/` (own `package.json`, `playwright.config.ts`).
- Tests run against the **real release-mode `mcm` binary** with the embedded UI, never against Vite.
- Global setup builds nothing; CI passes `MCM_BIN` (path to built binary) and `FAKE_MC_BIN`.
- Each worker launches its own `mcm` via a fixture:

```ts
// e2e/fixtures/mcm.ts
export const test = base.extend<{ mcm: McmInstance }>({
  mcm: async ({}, use) => {
    const inst = await McmInstance.start({   // temp data dir, port 0, allow_insecure_http
      upstreams: await Upstreams.start(),    // node-side mock server serving the same JSON fixtures as Rust
      fakeJre: true,                          // pre-registers a FakeJre as the default Java runtime
    });
    await use(inst); await inst.stop();       // also asserts no ERROR lines in mcm log
  },
});
```

- Upstream mocks: a small Node HTTP server (`e2e/upstreams/`) that serves the fixture JSON from `crates/*/tests/fixtures` so Rust and E2E share data. `mcm` is pointed at it through config overrides (`MCM_INTEGRATIONS__*_BASE_URL`, test-only keys enabled by `MCM_TEST_MODE=1`, rejected in release builds unless that env is set).
- Auth: `storageState` produced by a setup project that completes `/setup` and logs in.

## Conventions

- One spec file per user story group: `e2e/tests/<phase>-<area>.spec.ts` (e.g. `p1-lifecycle.spec.ts`).
- Page objects in `e2e/pages/` (`ServerPage`, `ConsolePage`, `FileManagerPage`).
- Never `waitForTimeout`; use web-first assertions and WS-driven UI state.
- Traces, screenshots, video on failure uploaded as CI artifacts.
- Accessibility smoke: `@axe-core/playwright` on each main page; zero serious/critical violations.
- **CSP**: the `mcm` fixture collects `securitypolicyviolation` events (init script) and console CSP errors on every page; any violation fails the test (`csp_no_violations` assertion in the shared fixture teardown).

## Matrix

| Trigger | Browsers |
|---|---|
| PR / push | Chromium |
| Nightly | Chromium, Firefox, WebKit |

## Real-server smoke suite (opt-in)

Rust tests in `crates/mcm-server/tests/smoke_*.rs`, compiled only with `--features smoke`, run only when `MCM_SMOKE=1`:

| Test | Does |
|---|---|
| `smoke_vanilla_latest` | Download Temurin via Adoptium, install latest vanilla, accept EULA, start, wait ready, SLP, RCON `list`, stop gracefully |
| `smoke_paper_latest` | Same with Paper; `tps` parse |
| `smoke_fabric_1_20_1` | Fabric server launch jar, start/stop |
| `smoke_forge_1_20_1` | Forge installer `--installServer`, args file launch |
| `smoke_forge_1_21` | Forge ≥ 1.20.3: LaunchSpec derived by **parsing** generated `run.sh` (never executed), start/stop |
| `smoke_neoforge_latest` | NeoForge install + launch |
| `smoke_legacy_1_12_2_java8` | Java 8 selection, start/stop |
| `smoke_curseforge_server_pack` | Requires `MCM_CURSEFORGE_API_KEY`; imports a small known pack |
| `smoke_mrpack_import` | Imports a small Modrinth pack |
| `smoke_capture_log_fixtures` | For vanilla, paper, fabric, forge, neoforge, velocity: start, run `say Done (1.0s)! For help, type "help"` and `say Alice joined the game` (spoof attempts via the `[Server]` broadcast path), `save-all flush`, stop; write the console output to `target/log-fixtures/<flavour>-<ver>.log` for review and commit into `crates/mcm-protocol/tests/fixtures/logs/`. Player-chat lines (needs a real client) are added by hand from a manual session and marked `# manual` in the fixture |
| `smoke_fake_parity` | Runs the shared lifecycle scenario against real Paper and asserts identical observable events as with fake-mc |

Runtime budget ≈ 30 min; uses a persistent download cache in CI (`actions/cache` keyed by week).

Java for the smoke suite: from P3 on, JREs are installed by mcm itself. **Exception:** the P1/P2 smoke tests (`smoke_p1_custom_jar_lifecycle`, before managed JREs exist) use `actions/setup-java` (Temurin 21) and pass its path as `javaPath`.
