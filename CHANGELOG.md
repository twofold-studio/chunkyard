# Changelog

Implemented project changes are recorded here. Work in progress stays under Unreleased until a release is prepared.

Generated from `.changes/` using [Changie](https://changie.dev/). Edit change fragments rather than this file.

## 0.2.0 - 2026-11-14


### Added

- Tooling: track project changes in Changie fragments and generate this changelog, including backend, frontend, and REST API changes.
- Backend: establish a modular Rust workspace, SQLite migrations, configuration loading, and Linux/Windows CI checks.
- Java: discover system runtimes, download and verify managed Temurin JREs, install versions side by side, and select compatible installed runtimes through the CLI.
- REST API: add owner setup, session login/logout, Java inventory and discovery, available releases, and asynchronous Java installs with persistent, pollable jobs and paginated history.
- Frontend: initialize the SvelteKit, Tailwind, and shadcn-svelte scaffold.
- Backend: allow trusted local/VPN operation without login through CHUNKYARD_AUTH__ENABLED=false. Skip setup, expose auth mode to clients, and keep origin/CSRF protections active.
- Backend: persist Docker server records and expose /api/v1/servers lifecycle jobs, console snapshots/commands, and /api/v1/system/isolation. Containers survive manager restarts and are checked against persistent ownership labels.
- Packaging: add a backend Dockerfile, explicit host-data-path translation for a containerized manager, and opt-in Docker lifecycle tests using both a console fixture and a real Java 21 test JAR.
- REST API: add POST /api/v1/servers/{id}/eula to explicitly accept or revoke EULA acceptance while stopped, replacing symlinked EULA files without following them.
- Frontend: add the web UI shell with owner setup, email/password sign-in and sign-out, and an authentication-disabled mode that skips login without showing a user. Expired sessions return to sign-in.
- Frontend: list, create and inspect Docker servers; start, stop, restart and confirmed force kill with job polling; accept or revoke the EULA while stopped; show the managed directory and actionable missing-JAR and EULA errors.
- Frontend: show a refreshable console snapshot (last 200 lines, replaced rather than appended, polled only while visible) and send console commands to running servers.
- Frontend: list host Java runtimes, run system discovery, and install Temurin versions with job status; the page states that Docker servers use their image JVM.
- Frontend: proxy /api and /healthz to the backend from a fixed http://localhost:5173 dev origin (set CHUNKYARD_HTTP__PUBLIC_URL to match) and build a static SPA bundle. The backend does not serve the bundle yet.
- Serve the built Svelte UI and REST API from one Rust HTTP origin, with deep-link fallback, hashed bootstrap CSP, asset caching, and CHUNKYARD_HTTP__UI_DIR to select or disable the UI bundle. Unknown /api routes retain JSON problem responses.
- Docker images now build and include the production UI, served alongside the API without a Node runtime. CI checks frontend validation and tests plus real-browser setup, session, deep-link, and CSP checks through Rust hosting.
- Web UI: add an API reference page at /api-docs, linked from the sidebar, that renders the live GET /api/v1/openapi.json document as searchable, tag-grouped operations with parameters, request bodies, responses, schemas and generated examples; read-only, with raw JSON view and download links.
- REST API: GET /api/v1/servers/{id}/metrics samples Docker CPU, memory, uptime, PID, network and block-I/O counters on demand, with bounded concurrency and timeouts. Stopped or unavailable measurements are never presented as zero usage; container status does not imply Minecraft readiness.
- REST API: GET /api/v1/openapi.json serves an OpenAPI 3.1.1 contract for the implemented routes, request/response schemas, cookie authentication and CSRF requirements, protected by the current authentication mode.
- Web UI: show a compact Resources panel on the server page from GET /api/v1/servers/{id}/metrics: CPU (relative to one core, may exceed 100%), memory working set against its limit, uptime, PIDs and cumulative network/disk I/O. It samples every 5 seconds only while running and the tab is visible, takes one snapshot when stopped, shows a dash for unavailable values instead of zero, and reports a busy sampler or missing Docker inline with a retry.
- REST API: POST /api/v1/setup/verify-token validates the bootstrap token without creating an owner, issuing a session, or consuming the token. Final POST /api/v1/setup still revalidates it; origin/CSRF protection and authentication-mode checks apply to both steps.
- Web UI: use logo-derived multi-size browser favicons and an Apple touch icon, with explicit page-head links.
- REST API: public GET /api/v1/system/version and /api/v1/system/changelog provide package metadata and bundled project notes for the version UI. CHUNKYARD_HTTP__SHOW_VERSION=false hides version values and returns 404 for the changelog; enabled by default, including before owner setup.
- Web UI: show a discreet version badge (for example v0.1.0 · dev) on setup, sign-in and the app sidebar from public GET /api/v1/system/version. Clicking it opens a scrollable changelog dialog that loads GET /api/v1/system/changelog only when first opened, with loading, error and retry states, and renders the Markdown as plain text without injecting HTML. The badge stays hidden, and the changelog is never requested, when the feature is disabled or the version request fails.
- REST API: list Vanilla/Paper Minecraft releases and stable Paper builds under /api/v1/software; create managed software selections and install them through /api/v1/servers/{id}/install jobs with verified downloads, pinned artifacts and automatic Docker Java selection. Existing manual JAR servers remain supported.
- Web UI: new-server flow picks software from the live GET /api/v1/software catalog (Vanilla and Paper with Minecraft version and optional stable build selection), then creates the server and runs POST /api/v1/servers/{id}/install with indeterminate job status. A failed install keeps the record and retries on the same ID. Server pages show software and launch metadata, offer install for uninstalled servers and disable Start until installed. Custom JAR remains an advanced option; installs never start the server or accept the EULA.
- Frontend: show servers as compact cards (status, software type, Minecraft version, memory, CPUs, host port) with a create tile always in the first slot. The game port now defaults to Automatic and is omitted from POST /api/v1/servers when blank. An explicit port may be shared with other servers, and the UI explains that only one of them can run at a time. Stopped servers can be deleted from their page via DELETE /api/v1/servers/{id} after confirmation. By default files are kept on the manager host, and an opt-in checkbox deletes world and server files. Only the delete job is polled, and the page returns to the server list when deletion succeeds.
- REST API: DELETE /api/v1/servers/{id} queues stopped-instance deletion, removes only owned containers and retains server files by default; deleteFiles=true explicitly removes worlds and other managed files. Completed jobs report retained paths; deleted instances stop consuming automatic port assignments.
- REST API: GET/PATCH /api/v1/servers/{id}/network expose current/effective game-port binding and stopped-instance port/address overrides; null publishIp restores the manager default. Saving preserves server data and refreshes only the owned stopped container.
- REST API: add /api/v1/servers/{id}/files routes for bounded browsing, UTF-8 editing with stale-save checks, streaming uploads/downloads, mkdir, move, copy and confirmed recursive deletion. Mutations require a stopped instance and share its lifecycle lock; managed artifacts and EULA remain protected.
- Web UI: staged new-server wizard (software, version/modpack, name & port, resources, review with EULA, install) with back/next validation and same-ID install retries; server pages gain Overview, Console, Files and Settings tabs; a file browser with breadcrumbs, sorting/filter, upload (raw bytes, explicit replace), download, text editor with etag conflict protection, new file/folder, rename/move/copy and confirmed permanent delete; Settings edits host port and bind address (e.g. 0.0.0.0 or a NetBird IP) and opens server.properties; shared reduced-motion-aware transitions across the app. Uses the /files and /network routes.
- Web UI: Properties tab for server.properties with grouped, searchable switches, selects and inputs (plus raw text view). Edits autosave after a short pause (Enter, switches and selects save at once), also while the server runs, with conflict, retry and busy-backoff states and no save prompts. Shows the saved version against the running one, says when a restart is needed (or that the running version is unknown for older containers), and lists version history; an old version is read-only until Restore, which saves it as a new version without restarting. The lossless editor keeps comments, unknown keys, CRLF, escapes, continuations and duplicate keys. Uses GET/PUT /api/v1/servers/{id}/properties, GET .../properties/versions[/{version}] and POST .../properties/restore; Files and Settings open this tab for server.properties.
- Web UI: live console over the WebSocket GET /api/v1/servers/{id}/console/stream (snapshot replaces, new lines append, 1000-line buffer). Reconnects with bounded backoff while the server runs and the tab is visible, closes when hidden, stopped or left, and falls back to polling GET .../console if WebSockets fail. Commands still use POST .../console/commands. The dev server proxies WebSockets.
- Web UI: refresh interval for CPU/RAM metrics (Off, 1, 2, 5, 10, 30 or 60 seconds), remembered in this browser for all servers. Off keeps the last sample and allows manual refresh.
- REST API: add versioned /api/v1/servers/{id}/properties, /versions and /restore routes. Save desired configuration while running, retain immutable history with etag conflicts, and apply the latest revision only on explicit start/restart with saved-versus-applied runtime tracking.
- REST API: GET /api/v1/servers/{id}/console/stream now provides bounded same-origin WebSocket console output, reconnectable history, heartbeat cleanup and periodic session revalidation; commands remain on the CSRF-protected POST route.

### Changed

- Development: document the verified-milestone commit/push workflow and exclude local environment files and app databases from version control.
- Rename the project to Chunkyard in the web UI, CLI description, and documentation, with a new transparent voxel logo and a README illustrated with real app screenshots. The mcm executable, Cargo crate names, REST routes, and stored data remain compatible.
- Web UI: first-run setup is now two steps. The setup token is verified with POST /api/v1/setup/verify-token before the owner email and password fields appear, and the final POST /api/v1/setup re-sends the verified token, which is held only in page memory.
- Web UI: the setup page lists where to read the setup token (Docker host, a container terminal such as Dokploy, or the data-directory file) as labelled monospace blocks, and shows a subtle animated copper "Threads" background ported from React Bits. The background is decorative only, pauses when hidden or with reduced motion, and falls back to a static pattern without WebGL2.
- REST API: POST /api/v1/servers accepts omitted/null ports for atomic automatic selection and permits explicitly shared ports. Start/restart jobs enforce one running or paused instance per port with server.port_in_use; SQLite migration preserves existing records while removing creation-time port uniqueness.
- Networking: game ports now bind to 0.0.0.0 by default, retaining CHUNKYARD_DOCKER__PUBLISH_IP for host-only or VPN-interface overrides. Existing owned stopped containers with outdated bindings are recreated on their next explicit start/restart while preserving server files.
- Web UI: the selected server name, status, summary and lifecycle/delete controls now live in the main top bar instead of a second page header, and update when switching servers or leaving the page. Settings is compact: a one-line Network summary that expands to edit, and a one-line EULA switch.
- Root server.properties file reads/writes now use desired versioned configuration; use the Properties API instead of uploading, moving, copying or deleting that managed path. Retained instance directories receive the latest desired properties before deletion. Legacy or externally restarted containers report an unknown applied revision until a managed restart.
- Completed requested milestones now batch the changelog, bump project versions, commit, push and verify deployment under the user-authorized workflow; in-progress work remains unreleased. Shared-worktree instructions prohibit repository-wide stash and cleanup operations.

### Fixed

- Web UI: keep the setup/sign-in version badge below the form in normal flow so long forms and narrow screens cannot overlap it.
- REST API: concurrent GET /api/v1/servers/{id}/files reads queue behind instance operations, allowing folder refresh and editor loading together without spurious server.busy errors. The web editor also warns before in-app navigation discards unsaved text.
- Web UI: editing a CRLF text file in the file editor keeps its line endings instead of converting them to LF.
- Properties controls keep absent keys explicitly unset instead of claiming defaults that vary by Minecraft version. Enter/navigation/start flush queued edits, applied metadata refreshes after lifecycle changes, and live console streams reconnect after a container restart.

### Security

- Protect API mutations with same-origin and CSRF checks; use salted Argon2id passwords, hashed session tokens, login throttling, private credential files, verified downloads, and bounded archive extraction.
- Docker servers use one managed directory mount, loopback game-port publication by default, resource limits, a read-only root filesystem, dropped capabilities, and no-new-privileges. Reject escaping JAR paths and multi-line console commands.

### Breaking

- REST API: setup and login now accept email/password, and user.email replaces user.username. Update clients to send email; username request fields are no longer accepted. Authentication remains enabled by default.
- Rename application environment variables from MCM_* to CHUNKYARD_* with no legacy aliases. Rename every existing setting, including CONFIG, DATA_DIR, HTTP, AUTH, JAVA and DOCKER variables, and rebuild/update Docker deployment environments together before upgrading. Old names now fail startup with a migration message; persisted data and TOML keys remain unchanged.
