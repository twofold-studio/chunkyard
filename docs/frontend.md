# Web UI

The SvelteKit app in `web/` is a client-rendered SPA for a single owner. It uses only the implemented REST API ([HTTP API](http-api.md), [Docker usage](docker.md)). Development setup is in [`web/README.md`](../web/README.md).

## What it does

- **Authentication.** Reads `/api/v1/setup/status`. First-run setup in two steps (verify the setup token, then create the owner with email and password) and email/password sign-in when authentication is enabled; sign-out from the sidebar. When the backend runs with `CHUNKYARD_AUTH__ENABLED=false`, setup and login are skipped and the sidebar shows "Authentication disabled"; no user is shown or invented. An expired session on any request returns the browser to sign-in.
- **Servers.** List with container status, refreshed every 10 s while the tab is visible. Create form for Docker servers (name, port, image, heap, CPUs, JAR path, EULA) with the backend's validation limits. Detail page with start, stop, restart and force kill (kill asks for confirmation), EULA accept/revoke while stopped, read-only configuration, the managed directory with a copy button, console snapshot and command entry.
- **Java runtimes.** Inventory, system discovery, and Temurin install from `/api/v1/java/available` with job polling.
- **API reference.** A searchable, locally rendered view of the live OpenAPI document, including request/response schemas and examples; no request execution.
- **Resources.** A compact server-detail panel shows on-demand CPU, memory, uptime, PIDs and cumulative I/O; it polls every five seconds while running and visible, clears stale measurements on stop, and marks unknown values with a dash. See [monitoring](monitoring.md).
- **Docker status** in the sidebar from `/api/v1/system/isolation`.

## Behaviour to know

- A small version badge opens a changelog modal, including on setup/login. `CHUNKYARD_HTTP__SHOW_VERSION=false` hides it and disables changelog delivery.
- Every mutation sends `X-MCM-CSRF: 1`; requests are same-origin with relative paths. The UI must be served from the origin in `CHUNKYARD_HTTP__PUBLIC_URL`.
- Lifecycle actions and Java installs are jobs. The UI polls `/api/v1/jobs/{id}` every second and shows queued/running/finished only; the backend reports no percentage.
- The console is a snapshot of the last 200 lines. It is replaced, never appended, every 3 s while the server is running, the Console tab is open and the browser tab is visible. Auto-refresh can be turned off. Stopped servers show one snapshot.
- Server status is re-read every 5 s on the detail page. "Container running" means the process runs; Minecraft may still be starting.
- Creating a server does not download anything. The UI shows the target JAR path after creation and again when a start fails with `server.jar_missing`.
- Docker servers use the JVM from their image. The Java page states that host runtimes are not used by Docker servers.
- All polling and in-flight requests are cancelled when leaving a page.

## Not included

There is no UI for deleting servers, editing resources after creation, file management, installers or modpacks, historical metrics/graphs, multiple users or roles, 2FA, or API tokens, because the backend does not provide them yet.

## Production hosting

Build the SPA, then start the Rust service from the repository root:

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
cargo run -p mcm-server -- serve
```

Open `http://127.0.0.1:8420`. Rust serves the UI and API on the same origin, including direct navigation and refreshes on `/servers` and `/java`. The Docker image builds and includes the UI automatically; no Node runtime or separate web server is needed at runtime.

`http.ui_dir` defaults to `web/build`, relative to the working directory. Set `CHUNKYARD_HTTP__UI_DIR=/absolute/path/to/build` for an installed binary, or set it to an empty string for API-only operation. A missing directory also starts in API-only mode; an existing directory without `200.html`, or containing symlinks, fails startup. Assets are loaded once with a 64 MiB bundle limit; restart after replacing the build. UI files are distributed alongside the binary, not embedded in it. Source maps and hidden files are excluded.

HTML uses `no-store` and a page CSP with hashes for the build's inline bootstrap scripts. JavaScript `eval()` and inline event handlers are blocked; same-origin scripts, API calls and fonts are allowed. Inline styles support Svelte components. Hashed `/_app/immutable/` assets have a one-year immutable cache policy; other assets revalidate using ETags. API responses retain their restrictive CSP and `no-store`. Host/origin/CSRF checks apply across both UI and API routes. Unknown `/api` routes return JSON errors, and missing assets return 404 instead of the SPA.

For a reverse proxy, preserve the original `Host` and set `CHUNKYARD_HTTP__PUBLIC_URL` to the external origin. Vite remains available for development as described in `web/README.md`.

## Integration limits

- There is no live console stream (no WebSocket) and no job cancellation.
- `/api/v1/servers` returns at most 100 servers; there is no pagination UI.

## Hosting verification

After building the UI and `cargo build -p mcm-server --locked`, run `node scripts/smoke-ui.mjs`. It uses Playwright Chromium to check the real Rust service in both auth modes, owner setup, session persistence, navigation, refreshes and CSP violations. Install Chromium with `pnpm --dir web exec playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome executable. The test uses temporary data and disables Docker operations. CI runs it after frontend validation, component/unit tests and the production build.
