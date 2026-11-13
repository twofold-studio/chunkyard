# Current backend HTTP API

Start with `cargo run -p mcm-server -- serve`, or run `mcm` without a subcommand. The default address is `http://127.0.0.1:8420`. This serves JSON only. The frontend is implemented separately in `web/`; see [frontend usage](frontend.md) for development and hosting instructions.

`mcm config check` prints effective configuration. Sources, in order: defaults, `--config`/`MCM_CONFIG` (or `/etc/mcm/mcm.toml` when present), environment, and CLI `--data-dir`/`serve --listen`. Unknown config keys fail validation. See `mcm.example.toml`.

Authentication is enabled by default. To run without login in a trusted local or VPN environment:

```sh
MCM_AUTH__ENABLED=false cargo run -p mcm-server -- serve
```

The setting is read at startup and overrides `[auth] enabled` in TOML. Disabled mode requires no owner, creates no setup token, and grants full control to callers who can reach the service. `/api/v1/setup/status` returns `{authEnabled:false, required:false}`; `/api/v1/auth/me` reports `principal.kind: "auth_disabled"` with `user:null`. Setup and login return 409 `auth.disabled`; logout simply clears the cookie. Jobs in this mode have `createdBy:null`. Host, origin, and CSRF protections remain active. Restart with `MCM_AUTH__ENABLED=true` to require login again; if no owner exists, first-run setup is required.

For VPN access, set `MCM_HTTP__LISTEN=0.0.0.0:8420` and `MCM_HTTP__PUBLIC_URL` to the URL used by your devices. Plain HTTP on that listener also needs `MCM_HTTP__ALLOW_INSECURE_HTTP=true`; HTTPS reverse proxies do not. These listener settings apply independently of the auth switch.

New setup/login requests use `email`, and user responses expose `email` instead of `username`. Emails are normalized for login. There is no email-delivery, verification, or password-reset-email service.

Read the initial token locally from `<data-dir>/setup-token`. Send it to `POST /api/v1/setup` with `{setupToken, email, password}`. A successful setup creates the owner, removes the token file, and sets the session cookie. Setup can only succeed once. Passwords use salted Argon2id with a bundled common-password blocklist. Hashing runs in a blocking worker pool limited to four concurrent operations.

Every mutation requires `X-MCM-CSRF: 1` and an `Origin` matching the backend origin (a matching `Referer` is also supported). Requests must use the configured public host. Cookie requests use `credentials: 'same-origin'`; there is no CORS allowance. Configure `http.public_url` when using a reverse proxy and preserve its Host header. Forwarded IP headers are currently ignored; login throttling uses the direct TCP peer.

Sessions use a 32-byte random token; only SHA-256 is stored. Cookies are HttpOnly, SameSite=Lax, and Secure when the public URL uses HTTPS. Local loopback HTTP works without TLS. Idle expiry is seven days; absolute expiry is thirty days. Logout revokes the database record immediately. The daemon limits sessions to 100 per account. Non-loopback HTTP requires an explicit insecure-HTTP opt-in; HTTPS is terminated by a reverse proxy in this increment.

| Method | Endpoint | Response |
|---|---|---|
| GET | `/healthz` | `{status: "ok"}` or 503 `{status: "db_unavailable"}` |
| GET | `/api/v1/setup/status` | `{required: boolean, authEnabled: boolean}` |
| POST | `/api/v1/setup` | 201 owner/session metadata and session cookie |
| POST | `/api/v1/auth/login` | `{kind: "session", me}` and session cookie; body `{email, password}` |
| GET | `/api/v1/auth/me` | Current owner/session metadata |
| POST | `/api/v1/auth/logout` | 204 and cleared cookie |
| GET | `/api/v1/java/runtimes` | `{items: JavaRuntime[]}` |
| POST | `/api/v1/java/runtimes/discover` | `{items: JavaRuntime[]}` |
| GET | `/api/v1/java/available` | `{lts: number[], all: number[], mostRecentLts: number}` |
| POST | `/api/v1/java/runtimes/install` | 202 `{job}`; body `{major: number}` |
| GET | `/api/v1/jobs?limit=50&cursor=...` | `{items: Job[], nextCursor: string | null}`; max limit 200 |
| GET | `/api/v1/jobs/{id}` | `Job` |

When authentication is enabled, setup, login, health, and setup status are public. The remaining endpoints require the owner session. Before setup, protected endpoints return 503 `setup_required`. Errors use `application/problem+json`, with stable `code` and sanitized `detail`. JSON bodies are limited to 1 MiB. All responses include no-store, security headers, and a generated request ID. The CSP currently applies to API responses only; SPA CSP/embedding remain pending backend integration.

`JavaRuntime` is the current core model: `{id, vendor, major, fullVersion, os, arch, path, managed, sha256}`. OS can be `linux`, `alpine-linux`, or `windows`. Planned fields such as `usedBy` and `installedAt` are not present yet. `java.allow_system_java = false` hides system runtimes and disables discovery.

`Job` follows the phase 0 shape: `{id, kind, serverId, state, progress, message, error, result, createdBy, createdAt, startedAt, finishedAt}`. Java install success has `result: {runtime}`. Progress is indeterminate during work and becomes 1 on success. Poll a job while its state is `queued` or `running`. Jobs survive restarts; interrupted work becomes failed with `job.interrupted`. There are at most four active jobs; excess submissions return 429 `job.busy`. A panicking task becomes failed with `job.panicked`. SIGINT/SIGTERM interrupts active jobs and flushes their final states before closing the database. Only one daemon may own a data directory.

This is a single-owner service. Email/password login and the optional authentication switch are the current auth scope; multi-user permissions, 2FA, and API tokens are deferred. WebSockets, OpenAPI generation, job cancellation/progress, and native process management remain pending. Initial Docker server lifecycle and console snapshots are implemented; see [Docker usage](docker.md). Older phase 0 specs describe a broader product than the current scope.

For an opt-in test with a real daemon and live Java 21 download:

```sh
cargo build -p mcm-server --locked
python3 scripts/smoke-backend.py
```

The smoke test uses temporary credentials/storage, checks owner setup and session authentication, installs Java through the HTTP job API, verifies the persisted inventory, and stops the daemon. Normal Rust tests use local fixtures and need no upstream downloads.

Server lifecycle and console routes are documented in [docker.md](docker.md). They use the same authentication and origin rules as the routes above.
