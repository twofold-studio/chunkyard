# Web UI

The SvelteKit app in `web/` is a client-rendered SPA for a single owner. It uses only the implemented REST API ([HTTP API](http-api.md), [Docker usage](docker.md)). Development setup is in [`web/README.md`](../web/README.md).

## What it does

- **Authentication.** Reads `/api/v1/setup/status`. First-run owner setup (setup token, email, password) and email/password sign-in when authentication is enabled; sign-out from the sidebar. When the backend runs with `MCM_AUTH__ENABLED=false`, setup and login are skipped and the sidebar shows "Authentication disabled"; no user is shown or invented. An expired session on any request returns the browser to sign-in.
- **Servers.** List with container status, refreshed every 10 s while the tab is visible. Create form for Docker servers (name, port, image, heap, CPUs, JAR path, EULA) with the backend's validation limits. Detail page with start, stop, restart and force kill (kill asks for confirmation), EULA accept/revoke while stopped, read-only configuration, the managed directory with a copy button, console snapshot and command entry.
- **Java runtimes.** Inventory, system discovery, and Temurin install from `/api/v1/java/available` with job polling.
- **Docker status** in the sidebar from `/api/v1/system/isolation`.

## Behaviour to know

- Every mutation sends `X-MCM-CSRF: 1`; requests are same-origin with relative paths. The UI must be served from the origin in `MCM_HTTP__PUBLIC_URL`.
- Lifecycle actions and Java installs are jobs. The UI polls `/api/v1/jobs/{id}` every second and shows queued/running/finished only; the backend reports no percentage.
- The console is a snapshot of the last 200 lines. It is replaced, never appended, every 3 s while the server is running, the Console tab is open and the browser tab is visible. Auto-refresh can be turned off. Stopped servers show one snapshot.
- Server status is re-read every 5 s on the detail page. "Container running" means the process runs; Minecraft may still be starting.
- Creating a server does not download anything. The UI shows the target JAR path after creation and again when a start fails with `server.jar_missing`.
- Docker servers use the JVM from their image. The Java page states that host runtimes are not used by Docker servers.
- All polling and in-flight requests are cancelled when leaving a page.

## Not included

There is no UI for deleting servers, editing resources after creation, file management, installers or modpacks, metrics/graphs, multiple users or roles, 2FA, or API tokens, because the backend does not provide them yet.

## Integration limits

- The Rust backend does not serve the SPA yet. `pnpm build` writes a static bundle to `web/build/` (fallback `200.html`), but the backend API responses carry `default-src 'none'` CSP and no static file route exists. For now, run the Vite dev server with its proxy, or put both behind one reverse proxy that serves `web/build/` (falling back to `200.html`) and forwards `/api` and `/healthz` with the original `Host`, and set `MCM_HTTP__PUBLIC_URL` to that origin.
- There is no live console stream (no WebSocket) and no job cancellation.
- `/api/v1/servers` returns at most 100 servers; there is no pagination UI.
