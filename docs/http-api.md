# Current backend HTTP API

Compressed instance exports and the private S3/RustFS connection are documented in [the export contract](exports-contract.md). `PATCH /api/v1/servers/{id}/resources` changes `{memoryMinMb,memoryMaxMb,cpus}` while stopped and returns `{server}`. Heap bounds must satisfy `128 <= min <= max <= 262144` MiB; CPU must be finite and between 0.1 and 256. The owned stopped container is removed, preserving files; next start uses the new limits.

Start with `cargo run -p mcm-server -- serve`, or run `mcm` without a subcommand. The default address is `http://127.0.0.1:8420`. It serves the built UI from `web/build/` alongside the JSON API when available; see [frontend usage](frontend.md) for build and hosting instructions. Set `CHUNKYARD_HTTP__UI_DIR=` for API-only operation.

`mcm config check` prints effective configuration. Sources, in order: defaults, `--config`/`CHUNKYARD_CONFIG` (or `/etc/mcm/mcm.toml` when present), environment, and CLI `--data-dir`/`serve --listen`. Unknown config keys fail validation. See `mcm.example.toml`.

Authentication is enabled by default. To run without login in a trusted local or VPN environment:

```sh
CHUNKYARD_AUTH__ENABLED=false cargo run -p mcm-server -- serve
```

The setting is read at startup and overrides `[auth] enabled` in TOML. Disabled mode requires no owner, creates no setup token, and grants full control to callers who can reach the service. `/api/v1/setup/status` returns `{authEnabled:false, required:false}`; `/api/v1/auth/me` reports `principal.kind: "auth_disabled"` with `user:null`. Setup and login return 409 `auth.disabled`; logout simply clears the cookie. Jobs in this mode have `createdBy:null`. Host, origin, and CSRF protections remain active. Restart with `CHUNKYARD_AUTH__ENABLED=true` to require login again; if no owner exists, first-run setup is required.

For VPN access, set `CHUNKYARD_HTTP__LISTEN=0.0.0.0:8420` and `CHUNKYARD_HTTP__PUBLIC_URL` to the URL used by your devices. Plain HTTP on that listener also needs `CHUNKYARD_HTTP__ALLOW_INSECURE_HTTP=true`; HTTPS reverse proxies do not. These listener settings apply independently of the auth switch.

New setup/login requests use `email`, and user responses expose `email` instead of `username`. Emails are normalized for login. There is no email-delivery, verification, or password-reset-email service.

Read the initial token locally from `<data-dir>/setup-token`. The setup UI first sends it to `POST /api/v1/setup/verify-token` with `{setupToken}`. A valid token returns 204 without creating an account, issuing a session, or consuming the token. Step two sends the original token to `POST /api/v1/setup` with `{setupToken, email, password}`; that final request checks it again. Existing clients may still submit the final request directly. A successful setup creates the owner, removes the token file, and sets the session cookie. Setup can only succeed once. Passwords use salted Argon2id with a bundled common-password blocklist. Hashing runs in a blocking worker pool limited to four concurrent operations.

Every mutation requires `X-MCM-CSRF: 1` and an `Origin` matching the backend origin (a matching `Referer` is also supported). Requests must use the configured public host. Cookie requests use `credentials: 'same-origin'`; there is no CORS allowance. Configure `http.public_url` when using a reverse proxy and preserve its Host header. Forwarded IP headers are currently ignored; login throttling uses the direct TCP peer.

Sessions use a 32-byte random token; only SHA-256 is stored. Cookies are HttpOnly, SameSite=Lax, and Secure when the public URL uses HTTPS. Local loopback HTTP works without TLS. Idle expiry is seven days; absolute expiry is thirty days. Logout revokes the database record immediately. The daemon limits sessions to 100 per account. Non-loopback HTTP requires an explicit insecure-HTTP opt-in; HTTPS is terminated by a reverse proxy in this increment.

| Method | Endpoint | Response |
|---|---|---|
| GET | `/healthz` | `{status: "ok"}` or 503 `{status: "db_unavailable"}` |
| GET | `/api/v1/setup/status` | `{required: boolean, authEnabled: boolean}` |
| POST | `/api/v1/setup/verify-token` | 204 if the bootstrap token is valid; body `{setupToken}`; no state change |
| POST | `/api/v1/setup` | 201 owner/session metadata and session cookie |
| POST | `/api/v1/auth/login` | `{kind: "session", me}` and session cookie; body `{email, password}` |
| GET | `/api/v1/auth/me` | Current owner/session metadata |
| POST | `/api/v1/auth/logout` | 204 and cleared cookie |
| GET | `/api/v1/software` | `{items: [{id, name, available, reason}]}`; Vanilla, Paper, CurseForge (requires key), custom |
| GET | `/api/v1/software/{kind}/versions` | `{items: [{id, stable}]}`; kind `vanilla` or `paper`; releases newest first |
| GET | `/api/v1/software/paper/versions/{version}/builds` | `{items: [{id, stable}]}`; stable build IDs are strings, newest first |
| POST | `/api/v1/servers/{id}/install` | 202 `{job}`; empty body or optional installer overrides; installs the persisted software selection |
| GET | `/api/v1/modpacks/curseforge?query=&index=0` | Minecraft modpack search/popular results with pagination |
| GET | `/api/v1/modpacks/curseforge/{id}/files` | Recent client releases with linked server packs |
| GET / PATCH | `/api/v1/servers/{id}/launch` | Detected/current launch profile and stopped-instance overrides |
| DELETE | `/api/v1/servers/{id}?deleteFiles=false` | 202 `{job}`; stopped instance only; retains files by default |
| GET | `/api/v1/servers/{id}/network` | `{port,publishIp,effectivePublishIp,boundPublishIp,boundPort,restartRequired,status}` |
| PATCH | `/api/v1/servers/{id}/network` | 200 `{server}`; body `{port,publishIp}`; stopped only, null bind uses manager default |
| GET/PUT | `/api/v1/servers/{id}/properties` | Desired content, etag, saved/applied version and restart state; PUT `{content,etag}` works while running |
| GET | `/api/v1/servers/{id}/properties/versions?limit=50&before=...` | Immutable revision metadata, newest first; `{items,nextBefore}` |
| GET | `/api/v1/servers/{id}/properties/versions/{version}` | One prior revision including content |
| POST | `/api/v1/servers/{id}/properties/restore` | Body `{version,etag}` creates a new desired revision without restarting |
| GET (WebSocket) | `/api/v1/servers/{id}/console/stream` | Authenticated same-origin console frames; matching `Origin` required |
| GET | `/api/v1/servers/{id}/files?path=` | `{path,entries,truncated,canWrite}`; empty path lists instance root |
| GET | `/api/v1/servers/{id}/files/content?path=...` | `{path,content,etag,size,readOnly,canWrite}`; UTF-8 text up to 1 MiB |
| PUT | `/api/v1/servers/{id}/files/content?path=...` | `{path,etag,size}`; body `{content,etag}`; null etag creates only |
| GET | `/api/v1/servers/{id}/files/download?path=...` | Streaming attachment for one regular file |
| POST | `/api/v1/servers/{id}/files/upload?path=...&overwrite=false` | 201 `{entry}`; raw binary body up to 128 MiB |
| POST | `/api/v1/servers/{id}/files/mkdir` | 201 `{entry}`; body `{path}`; parent must exist |
| POST | `/api/v1/servers/{id}/files/move` | `{entry}`; body `{from,to}`; rename/move without overwrite |
| POST | `/api/v1/servers/{id}/files/copy` | `{entry}`; body `{from,to}`; bounded directory/file copy without overwrite |
| POST | `/api/v1/servers/{id}/files/delete` | 204; body `{path,recursive}`; permanent deletion |
| GET | `/api/v1/java/runtimes` | `{items: JavaRuntime[]}` |
| POST | `/api/v1/java/runtimes/discover` | `{items: JavaRuntime[]}` |
| GET | `/api/v1/java/available` | `{lts: number[], all: number[], mostRecentLts: number}` |
| POST | `/api/v1/java/runtimes/install` | 202 `{job}`; body `{major: number}` |
| GET | `/api/v1/jobs?limit=50&cursor=...&serverId=...&activeOnly=true` | `{items: Job[], nextCursor: string | null}`; max limit 200; optional server UUID / queued-running filters |
| GET | `/api/v1/jobs/{id}` | `Job` |

When authentication is enabled, setup, token verification, login, health, setup status, and the optional version/changelog metadata are public. The remaining endpoints require the owner session. Before setup, protected endpoints return 503 `setup_required`. Errors use `application/problem+json`, with stable `code` and sanitized `detail`. JSON bodies are limited to 1 MiB, except the editor's 8 MiB envelope for escaped text up to 1 MiB. API responses include no-store, a restrictive CSP, security headers, and a generated request ID. Static UI pages have a separate page CSP and assets have cache policies; see [frontend hosting](frontend.md). Unknown `/api` routes return JSON problem responses even when UI hosting is enabled.

## Instance files

Generic file mutations require a stopped instance and use the same lock as installation, lifecycle, network changes and instance deletion. Reads/downloads work while running; listing `canWrite` becomes false. If Docker is unavailable, listing and reading still work with generic writes disabled. Versioned `server.properties` has its own editing rules below. Filesystem workers retain the lock until work actually finishes even if the browser disconnects.

Paths are relative POSIX names inside one instance. Root listing uses an empty path; no operation may replace or delete root. Dot segments, absolute paths, backslashes, control characters and Windows device/alternate-stream names are rejected. Paths are limited to 1024 bytes, 32 components and 255 bytes per component. Directory capabilities and no-follow opens prevent symbolic-link traversal, including linked instance roots. `.chunkyard-*` components are hidden/protected. Root `eula.txt` is readable but changes use the separate EULA action.

The text editor supports UTF-8 without NUL bytes. `etag` is the SHA-256 of the text read; send it on save, or null to create a new file. Stale saves return 409 `files.conflict` and leave the file intact. Writes/uploads stage in the same directory and publish only after successful completion. Uploads use a raw `File`/`Blob` body, not multipart or base64, with the usual CSRF header and same-origin credentials. Existing files require explicit `overwrite=true`. Up to four uploads and four downloads run at once; excess transfers return 429 `files.busy`. Uploads time out after 60 seconds without a body chunk. Downloads are single regular-file attachments; directory ZIP and Range requests are not implemented.

Listings stop after 5000 inspected entries and report `truncated`; non-UTF-8 names are skipped. Copies are limited to 512 MiB, 5000 entries and 32 nested levels; failed directory copies clean up their newly created destination. Moves/copies refuse existing destinations, links and special files. Nonempty directory deletion requires `recursive=true` and is permanent. Stop external tools from editing the same instance during changes: editor etags detect changes since reading but do not provide a transaction with arbitrary host-side writers.

File errors use `files.path_invalid` (422), `files.symlink`/`files.protected` (403), `files.not_found` (404), `files.exists`/`files.conflict`/`files.not_empty`/`files.server_running` (409), `files.too_large` (413), `files.binary` (415), and `files.io` (500). Reads queue behind existing instance operations; conflicting mutations return `server.busy` (409).

## Versioned server properties

The dedicated `/properties` API stores desired configuration and immutable history in SQLite. Saving works while running, stopped or Docker is unavailable. It does not rewrite the active file or restart Minecraft. The latest desired revision is written atomically before the next explicit start/restart, then recorded against that specific container start. Root `server.properties` reads/writes/downloads through `/files` remain compatible and use the desired revision; generic upload, move, copy and deletion of that managed path now return `files.protected`. Clients should use `/properties` and its history routes.

`GET /properties` returns `{content,etag,version,appliedVersion,restartRequired,status,updatedAt}`. PUT requires `{content,etag}`; text is UTF-8 without NUL, up to 1 MiB in an 8 MiB JSON envelope. A stale etag returns 409 `properties.conflict`; unchanged text creates no revision. Version metadata is `{version,etag,createdAt,source}` with source `import`, `edit` or `restore`. History pages default to 50, maximum 100; pass `nextBefore` back as `before`. Restoring requires the current desired etag and always creates a new revision; it never rewrites past entries or restarts the game.

`appliedVersion` identifies a manager-tracked start, or is null when unknown. A legacy running instance or an external container restart has an unknown applied revision until the next managed restart. Minecraft may fill in defaults or persist console settings; observed runtime file changes are imported without discarding an independently saved pending revision. The desired revision is authoritative for the next start, so use this API rather than changing the active file with an external tool. Deleting the instance removes its history; when files are retained, the latest desired properties are first exported into that directory.

The launcher forces internal game port 25565: edit the published port through `/network`. `online-mode`, whitelist and other game settings change only when the owner edits them. Autosave does not accept the EULA or start a server. Other errors include `properties.not_found` (404), `properties.invalid` (422), `properties.too_large` (413), `properties.storage` (500), existing `files.*` failures, and `server.busy` for an overlapping mutation.

## Live console

Connect a browser WebSocket to `/api/v1/servers/{id}/console/stream` (`wss:` for HTTPS). It uses the normal owner cookie and requires an exact matching `Origin` in both auth modes. This read-only GET does not need a CSRF header. Server commands still use the existing CSRF-protected POST route.

The first JSON text frame is `{type:"snapshot",lines:[]}`, resetting the client buffer. A single ordered Docker follow request then sends the last 200 log records and subsequent output as `{type:"line",line:{stream,text}}`. Reconnecting starts a fresh snapshot; append only line frames afterward. End-of-container output produces `{type:"end"}`; failures use `{type:"error",code,detail}`. A stopped instance rejects the handshake with 409.

There are at most 16 concurrent console sockets. Lines are limited to 8192 UTF-8 bytes and 256 lines per Docker frame. Slow sends time out, heartbeats detect disconnected peers, and authenticated sessions are revalidated every five seconds. Revoked sessions receive `auth.required` and close. Unexpected client data closes the read-only socket. The frontend reconnects with backoff and falls back to snapshots when streaming is unavailable; it closes sockets on hidden/inactive tabs and navigation. The page CSP permits only the configured same-origin WebSocket endpoint.

`JavaRuntime` is the current core model: `{id, vendor, major, fullVersion, os, arch, path, managed, sha256}`. OS can be `linux`, `alpine-linux`, or `windows`. Planned fields such as `usedBy` and `installedAt` are not present yet. `java.allow_system_java = false` hides system runtimes and disables discovery.

`Job` follows the phase 0 shape: `{id, kind, serverId, state, progress, message, error, result, createdBy, createdAt, startedAt, finishedAt}`. Java install success has `result: {runtime}`. Progress is indeterminate during work and becomes 1 on success. Poll a job while its state is `queued` or `running`. Jobs survive restarts; interrupted work becomes failed with `job.interrupted`. There are at most four active jobs; excess submissions return 429 `job.busy`. A panicking task becomes failed with `job.panicked`. SIGINT/SIGTERM interrupts active jobs and flushes their final states before closing the database. Only one daemon may own a data directory.

This is a single-owner service. Email/password login and the optional authentication switch are the current auth scope; multi-user permissions, 2FA, and API tokens are deferred. WebSocket console streaming is implemented; job cancellation and native process management remain pending. Install/export jobs report measured stage progress and byte counts. See [Docker usage](docker.md) and [CurseForge installation and launch profiles](curseforge.md). Older phase 0 specs describe a broader product than the current scope.

For an opt-in test with a real daemon and live Java 21 download:

```sh
cargo build -p mcm-server --locked
python3 scripts/smoke-backend.py
```

The smoke test uses temporary credentials/storage, checks owner setup and session authentication, installs Java through the HTTP job API, verifies the persisted inventory, and stops the daemon. Normal Rust tests use local fixtures and need no upstream downloads.

Server lifecycle and console routes are documented in [docker.md](docker.md). They use the same authentication and origin rules as the routes above.

## OpenAPI and monitoring

Jobs returned by submission, `GET /api/v1/jobs` and `GET /api/v1/jobs/{id}` include optional `work: {stage,completedBytes,totalBytes,completedStages}|null`. Install stages are `resolve`, `download`, `verify`, `extract`, `prepare_loader`, `finalize`; optional/repeated downloads are reported as they happen. Export stages are `scan`, `compress`, `upload`, `verify_upload`, `finalize`. Only observed stages are included in `completedStages` (bounded to the last 32 transitions). Byte totals are null when unknown: compression reports compressed output bytes with no estimated denominator, while downloads and S3 transfers use known artifact sizes. Upload bytes mean bytes read into the HTTP request; S3 read-back checksum verification is a separate stage. Stage percentages may be computed only when a positive total is present. The legacy `progress` field remains null while working and becomes 1 only on success; it is not a fabricated overall percentage. Progress observations are coalesced and persisted at most twice a second, retained on completion/failure and available after reopening the page. Existing jobs without progress deserialize as null. Installer preparation/extraction and Docker image/loader preparation can remain indeterminate while their upstream operations offer no byte measurements.

`GET /api/v1/modpacks/curseforge/{id}` returns the pack's name, summary, downloads, validated CurseForge website link and a same-origin `logoUrl`. Search results use that same logo route. `GET /api/v1/modpacks/curseforge/{id}/logo` fetches only allowed public ForgeCDN hosts, without credentials, and serves a bounded, normalized PNG. Metadata and logos have bounded in-memory caches with a one-hour lifetime; upstream failures leave the UI's fallback icon available.

Server responses include `icon: {url,source:"custom"|"modpack"}|null`. `GET /api/v1/servers/{id}/icon` returns the custom icon, otherwise the pack logo. `PUT` accepts raw PNG/JPEG/WebP/ICO bytes up to 2 MiB, decodes at most 4096×4096 pixels and stores a PNG thumbnail of at most 256×256. Byte validation determines format, not the supplied content type. `DELETE` resets the custom icon and restores the pack/generic fallback. Both mutations return `{server}` and require normal Origin/CSRF checks; they work while the game runs. Icons live in manager-owned storage outside game-instance directories, and never modify Minecraft's `server-icon.png`. Errors use `icons.invalid` (422), `icons.unsupported` (415), `icons.too_large` (413), `icons.not_found` (404) or `icons.storage` (500), plus normal server/provider errors.

`GET /api/v1/system/isolation` includes `docker.capacity`: `{logicalCpus, memoryTotalBytes, architecture, operatingSystem}` from the Docker engine that runs game containers. Totals are positive numbers or null when unknown; capacity is null when the engine is unavailable. These are engine-visible totals (including Docker Desktop VM limits), not free memory, reserved resources or the manager container's own cgroup allowance. Nested/rootless engine constraints may be narrower than reported totals. Use them for allocation guidance, leave headroom for the OS, other services and JVM overhead, and do not silently clamp existing server settings. This endpoint uses the normal session/auth-disabled checks.

`GET /api/v1/openapi.json` returns the current OpenAPI 3.1.1 document, including schemas, operations, cookie authentication and mutation CSRF requirements. It uses the normal owner-session/auth-disabled checks and `no-store`. The app's **API reference** page at `/api-docs` renders it locally with search, grouped operations, schema links and examples. It is read-only and sends no operation requests. Examples are illustrative, not recorded server data.

`GET /api/v1/servers/{id}/metrics` returns a bounded, on-demand container resource snapshot. See [monitoring](monitoring.md) for units, missing measurements, sampling limits and readiness caveats.

## Version badge and changelog

`GET /api/v1/system/version` returns `{enabled:true, version:"0.10.0", channel:"development"}` for the current build. `GET /api/v1/system/changelog` returns `{version, markdown}` with the generated project changelog bundled at build time. These public endpoints let setup and login pages show the version without an owner session. Host/origin checks and no-store still apply; no per-user or server data is included.

`[http] show_version = true` is the default. Set `CHUNKYARD_HTTP__SHOW_VERSION=false`, restart/redeploy, and reload the page to hide the badge: version metadata then returns `{enabled:false, version:null, channel:null}`, and the changelog endpoint returns 404 `version.disabled`. The UI fetches changelog content only when the modal opens. Completed, verified milestones batch notes and bump the project version under the authorized [changelog workflow](changelog.md); in-progress changes remain Unreleased.

## Environment name migration

Only `CHUNKYARD_*` application environment variables are supported. Rename all `MCM_*` settings before upgrading; old names now stop startup with a migration message rather than being silently ignored. For example, use `CHUNKYARD_AUTH__ENABLED`, `CHUNKYARD_HTTP__PUBLIC_URL`, `CHUNKYARD_HTTP__SHOW_VERSION`, `CHUNKYARD_DATA_DIR`, and `CHUNKYARD_CONFIG`.

`CHUNKYARD_CONFIG` selects a TOML file when `--config` is absent. Explicit `--config` takes precedence over the environment file path; normal environment settings override values inside the selected file, and CLI data/listen options apply last. TOML keys, data directories, the `mcm` executable, session cookie and CSRF header are not renamed by this migration. Rebuild the Docker image and update its runtime environment together; data volumes remain reusable.

Managed server creation optionally accepts `software: {type: "vanilla", version}` or `{type: "paper", version, build?}`. `build` is a positive integer encoded as a string; omission selects the latest stable Paper build once at installation time. A null/omitted software selection preserves manual JAR behavior. The server response adds nullable `software`, nullable `launch: {path, version, build, javaMajor, checksum}` and boolean `autoJava`. Existing stored records default these fields to null/null/false, with no migration required. Creation still returns 201 and does not download anything. The UI should then submit `server.install`, follow its durable job and navigate to the returned server. If installation fails, retry against that same ID. Until success, Start fails with `server.not_installed`; a second install after success fails with `server.already_installed`. No automatic game start or EULA acceptance occurs. An explicit `dockerImage` prevents automatic JVM image selection. See [the installation workflow](docker.md#managed-vanilla-and-paper-installation-rest-api) for limits, checksum policy and retry behavior. New catalog routes use the same session/setup checks as other protected endpoints; the install mutation retains Origin/CSRF checks in both auth modes.

`POST /api/v1/servers` accepts an omitted/null `port` to select an unassigned managed port starting at 25565 under the create lock. Explicit ports remain 1–65535 and may be shared by multiple records. Start/restart jobs enforce single running/paused instance per port with `server.port_in_use`; it is no longer a creation conflict. Existing records survive an automatic SQLite migration removing the port uniqueness constraint. Unrelated host services can still occupy a port.

`DELETE /api/v1/servers/{id}` submits `server.delete` and accepts only the optional boolean query `deleteFiles` (default false); invalid/unknown query fields return 400. Success is `job.result: {deleted: {id, filesDeleted, retainedDirectory}}`, where `retainedDirectory` is a manager-host path or null. It requires a stopped instance and excludes concurrent mutations. It never force-stops containers, follows an instance-root symlink, removes foreign containers or accepts arbitrary paths. Explicit file deletion includes worlds/configuration/logs/software. Retained files are not automatically imported. Partial cleanup on failure/interruption can be retried using the same ID; no filesystem/SQLite transaction is claimed. Unknown IDs return 404. Session, Host/origin and CSRF checks remain mandatory in their usual modes.
