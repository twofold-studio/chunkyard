# Phase 0 — Foundation

## Goal

A **releasable and tested** (not yet useful) secure shell: one `mcm` binary that serves the embedded SPA under a strict CSP, completes first-run setup, logs users in (with optional TOTP 2FA), lets them manage their sessions and API tokens, records audit entries, runs generic jobs, and exposes a WebSocket hub — with the workspace, CI, OpenAPI → TypeScript pipeline and test harness that every later phase builds on.

## Scope

- Cargo workspace with the crates needed now: `mcm-core`, `mcm-config`, `mcm-db`, `mcm-auth`, `mcm-api`, `mcm-server` (bin + lib `wiring`), `mcm-testkit`, `mcm-api-tests`, plus `xtask/`. Other crates (e.g. `mcm-download` with the shared SSRF-safe client, P1) are created by the phase that first needs them.
- `xtask check-deps` enforcing [workspace-layout rules](../../architecture/workspace-layout.md#rules-enforced-in-ci-by-cargo-xtask-check-deps).
- CI pipeline jobs from [testing/ci.md](../../testing/ci.md) that apply to this phase (all except fuzz targets not yet existing and `smoke-real`).
- Config loading (`mcm.toml` + env + CLI), validation, `mcm config check`.
- SQLite pool, WAL settings, migration `<NNNN>_p0_foundation.sql` for `users` (incl. TOTP columns), `sessions`, `api_tokens`, `totp_recovery_codes`, `audit_log`, `jobs`, `settings`.
- Master secret key creation and `SecretBox` (XChaCha20-Poly1305, AAD `table.column:row_id`).
- First-run setup with setup token and first-run CSRF rules; `public_url` required on non-loopback listen; login/logout/me; password change (re-auth → `403 auth.reauth_failed`); CSRF header + Origin check; rate limiting and (IP, username) login throttling.
- **TOTP 2FA** (enroll/confirm/disable, recovery codes, login challenge) and **session list/revoke** — moved here from P8.
- **Security headers and CSP** per [security.md](../../architecture/security.md#http-security-headers-and-csp-p0) — moved here from P8.
- API tokens CRUD (personal tokens of the current user).
- Jobs framework: `JobService`, persistence, progress events, cancel, restart recovery; WS `jobs` topic. Exercised by a `debug.sleep` job that exists only when `mcm-server` is built with the `test-hooks` feature.
- Audit catalog (`mcm_core::audit::Action`, [audit.md](../../architecture/audit.md)), allow-list scrubber, audit service; `GET /api/v1/audit` (admin, basic list with filters).
- WS hub: connect, auth, Origin check, subscribe/unsubscribe/ping, heartbeat, per-connection queue.
- `/healthz`, `/api/v1/system/info`, `/api/v1/openapi.json`.
- OpenAPI generation (`mcm openapi`), TS type generation, drift check.
- SPA: SvelteKit skeleton (`kit.csp` hash mode), shadcn-svelte, Tailwind v4, `@lucide/svelte`, `@tanstack/svelte-query` v6, theme toggle (`mode-watcher` + `/theme-init.js`), app shell with sidebar, `/setup`, `/login` (+ TOTP step), `/account` (password, 2FA, sessions, API tokens), `/admin/audit` (basic table).
- SPA embedding via `rust-embed` with fallback and cache headers.
- CLI: `serve`, `openapi`, `config check`, `migrate`, `user reset-password`, `version`.
- Packaging: systemd unit, Dockerfile, `CONTRIBUTING.md`.

## Non-goals

- Any Minecraft server functionality (phase 1).
- Creating additional users, roles UI, per-server permissions, owner-enforced 2FA for admins (P8). Only the owner exists; `admin`/`user` roles exist in the schema.
- The SSRF-safe outbound client (`mcm-download::SafeHttp`) — P0 makes no outbound HTTP calls; it arrives in P1.
- Notifications (P8), built-in TLS certificate generation (optional later; config `[http.tls]` with provided cert/key **is** in scope).
- OTLP export.

## User stories

| ID | Story |
|---|---|
| P0-US-01 | As an operator I install the binary, start it, and see a setup-token line in the log so only I can claim the instance. |
| P0-US-02 | As the owner I complete setup in the browser and land on an (empty) dashboard. |
| P0-US-03 | As the owner I log in/out, change my password, and other sessions are revoked when I do. |
| P0-US-04 | As the owner I create an API token with scopes and expiry, see it once, and revoke it later. |
| P0-US-05 | As an operator I lock myself out and reset my password offline with `mcm user reset-password`. |
| P0-US-06 | As the owner I see an audit list of logins, token changes and password changes. |
| P0-US-09 | As the owner I enable TOTP 2FA, save recovery codes, and need a code at every login. |
| P0-US-10 | As the owner I see my active sessions (device, IP, last seen) and revoke any of them. |
| P0-US-11 | As the owner, failed logins from an attacker's IP never lock me out from my own IP. |
| P0-US-07 | As a developer I run `just ci` locally and get the same result as CI. |
| P0-US-08 | As a developer I add an endpoint and the TS types regenerate from OpenAPI with zero hand-written types. |

## Dependencies

None.

## Exit checklist

- [ ] All P0 FRs implemented; every test in [tests.md](tests.md) passes in CI.
- [ ] `mcm` musl release binary ≤ 40 MiB, starts in < 1 s on an empty data dir.
- [ ] Coverage gates met (`mcm-auth` ≥ 95 %, `mcm-api` ≥ 90 %, workspace ≥ 85 %, web lib ≥ 80 %).
- [ ] `openapi-drift`, `deps-check`, `migrations` CI jobs green.
- [ ] Docker image runs with a volume at `/data`, healthcheck on `/healthz`.
- [ ] systemd unit tested manually on a Debian 12 VM (documented in PR).
- [ ] Axe: zero serious/critical violations on `/setup`, `/login`, `/account`, `/admin/audit`.
- [ ] Zero CSP violations on every page in E2E; `release-features` CI job confirms `test-hooks` absent from the release binary.
- [ ] CONTRIBUTING.md merged.

## Files

[requirements](requirements.md) · [api](api.md) · [ui](ui.md) · [tests](tests.md)
