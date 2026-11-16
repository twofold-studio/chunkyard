# Changelog

Implemented project changes are recorded here. Work in progress stays under Unreleased until a release is prepared.

Generated from `.changes/` using [Changie](https://changie.dev/). Edit change fragments rather than this file.

## Unreleased


### Added

- Add a pinned Nix development shell and direnv setup with Rust, Node/pnpm, changelog and Docker client tools, plus system Chromium for browser tests on Linux. Entering the shell does not install project dependencies, start services or load application secrets.

### Changed

- Group HTTP/WebSocket integration suites into fewer test executables, preserving existing scenarios and opt-in Docker checks. Add CI checks for production crate boundaries and 400-line Rust module budgets with explicit, bounded exceptions; update architecture and runtime documentation to match the implemented workspace.
- Keep filesystem, authentication, download and installer public Rust paths stable while moving error types, client construction and repository error mapping behind thin crate entry points.
- Set release builds to explicit level-3 optimization and one code-generation unit alongside thin LTO and symbol stripping. Remove the obsolete mcm.example.toml; effective configuration remains available through mcm config check.
- Refactored filesystem sandbox, verified downloads and CurseForge pack preparation into cohesive Rust modules while preserving public APIs, safety limits and launch detection behavior.
## 0.14.1 - 2026-11-16


### Changed

- Rename Rust workspace crates and directories from mcm-* to chunkyard-*, with chunkyard_* Rust imports. Source builds and integrations must use the new Cargo package names, such as cargo build -p chunkyard-server. The mcm executable, REST contracts, data paths and existing Docker ownership identifiers remain compatible.
## 0.14.0 - 2026-11-15


### Added

- REST API: add Minecraft status probes and player-list management, with bounded Server List Ping responses, UUID resolution, guarded stopped edits and live command confirmation.
- Add opt-in manager-startup and bounded crash-recovery policies. Manual stops and kills suppress recovery, clean exits are respected, and the manager never accepts the EULA on the owner’s behalf.
- Add stopped-only scheduled full S3 backups and opt-in retention of scheduler-created archives after a new backup is verified. Running instances are skipped; manual and pinned archives are protected.
- Collect bounded historical resource snapshots about once a minute while instances run, independently of open browsers. History defaults on, can be disabled per server, and retains seven days with a manager-wide 100000-row limit and bounded REST aggregation.
- Web UI: show Minecraft readiness (Server List Ping state, player count, advertised sample, version, latency and suggested address) in the server header and Overview from one shared five-second poll that runs only while the page is visible and focused; add a Players tab for whitelist, operator and ban changes with known-player suggestions, confirmations, live-op level omission and Files links for malformed lists.
- Web UI: add Settings controls for manager-startup and crash-recovery policies and per-server resource history, an Exports section for stopped-only scheduled S3 backups with explicit retention acknowledgement, and 1h/24h/7d stored usage charts that put the live sampler in standby while shown. Automatic starts, crash restarts, scheduled backups and player changes get Activity labels and result summaries; recovered policy jobs block competing actions like starts and exports.
## 0.13.0 - 2026-11-15


### Changed

- Web UI: sub-second metrics require an explicit High frequency choice for each server visit and a visible chart in a focused window. Unattended charts use five-second standby, respecting slower preferences. Visible server cards sample at five seconds or slower; off-screen cards and hidden pages release their streams. The selected and effective cadences are displayed separately.

### Fixed

- Metrics WebSocket delivery reacts to fresh samples with a per-viewer rate limit, avoiding skipped updates when slow collection and delivery timers drift apart. Latest-value backpressure, authentication and socket limits remain enforced.
- Browser metrics transports are released on pagehide, including pages entering the back/forward cache, and resume only after pageshow. Switching servers cannot inherit even a brief fast subscription from the previous server.
## 0.12.0 - 2026-11-15


### Added

- Live metrics: GET /api/v1/servers/{id}/metrics/stream now uses fresh Docker one-shot readings at the fastest active viewer’s requested interval, including 100 ms sampling. Collection is shared, sequential, slows after fast viewers leave, and stops when nobody is watching.
## 0.11.1 - 2026-11-15


### Fixed

- Development: fix the deployed metrics benchmark response checks and temporary-instance network setup, and calculate browser CPU from its own observation window.
## 0.11.0 - 2026-11-15


### Added

- Frontend: opt-in Vim keybindings for the Files editor and Properties raw/history views, remembered per browser. `:w` saves through the normal save path (refused for read-only views); `:q` never closes the editor; Escape then Tab still leaves the editor and Ctrl/⌘+K and Ctrl/⌘+S still reach the page.
- Frontend: Files folder navigation and opening a file are browser history entries on the server page, so Back/Forward (including mouse side buttons) move between folders, Back from the first folder leaves the page as before, and Back over unsaved edits asks first. Entries are scoped to the server.
- Frontend: the server console renders ANSI SGR colors (16, 256 and truecolor) and Minecraft section-sign color/format codes as styled text. Other escape and control sequences (cursor, OSC titles/links, DCS) are stripped; filter, copy and download use the visible plain text. No API change.
- Frontend: the console fills the available viewport height with the command field at the bottom, and Tab offers local suggestions for common vanilla commands/subcommands and commands sent earlier from the tab (labelled built-in or history). Enter accepts a suggestion without sending; suggestions are not server-provided.
- Frontend: Integrations page (sidebar and quick navigation) to create, list and revoke owner API keys via `GET|POST /api/v1/auth/api-keys` and `DELETE /api/v1/auth/api-keys/{id}`. A new key is shown once in a dialog with an explicit copy button and is never stored, logged or put in a URL; the list shows only name, prefix, creation and last use, and revoking asks for confirmation. The page also shows the `/mcp` endpoint and a Claude Code setup command with a placeholder key.
- Frontend: live CPU/RAM uses the `GET /api/v1/servers/{id}/metrics/stream?intervalMs=` WebSocket through one shared subscription per server (server page and list reuse the same stream and session history). The interval preference adds 100 ms, 250 ms and 500 ms; the UI shows the measured `sampledAt` time, drops duplicate measurements and never interpolates. Streams stop while the tab is hidden, when Off or on unmount, are capped at 8 at once, and fall back to REST snapshots no faster than once a second with at most 2 requests in flight. The earlier seconds preference is migrated.
- Frontend: the server Overview shows a compact operations row with the newest full S3 backup age, the saved/running server.properties version with a restart-needed badge, and the last three jobs for the server, each linking to Exports, Properties or Activity. It reads existing endpoints once per server and again only after start/stop or a finished task (no timer; stale requests are aborted). Archived servers keep the restore-focused overview.
- Public OpenAPI documentation, revocable owner API keys shown once at creation, bearer REST authentication and the /mcp integration endpoint. Browser key management retains Origin/CSRF protection; credentials are stored as hashes.
- GET /api/v1/servers/{id}/metrics/stream shares one Docker statistics feed per watched server, with bounded latest-value WebSocket delivery configurable from 100 ms to 60 seconds. Only fresh native Docker measurements are emitted.

### Changed

- Frontend: Properties history shows a setting-level comparison for the selected version (changed, added and removed keys with old and new values) against its previous revision or the latest saved version, with explicit version labels and a note when only comments or formatting differ. Opening and closing History no longer flickers or briefly misplaces the versions panel.
- Frontend: the API reference page is readable without signing in, in a minimal public shell with a Sign in link; it loads only the public `GET /api/v1/openapi.json`. Other app pages still require authentication.
- Frontend: Delete moved from the server page header to a separate section at the end of Settings. It keeps its confirmation dialog and stays disabled while a task, export, pending Properties save or unsaved Files edit is in progress, with the reason shown; archived servers do not show it.
- Frontend: server list cards are slightly larger (up to three per row) and running local servers show compact CPU and RAM charts of the samples seen while the list is open, with gaps for missing measurements; stopped and archived servers open no live connection.

### Removed

- Frontend: the Java runtimes page, its navigation and quick-navigation entries, and the `/api/v1/java/*` client helpers. Servers run Java from their Docker image; software Java versions and automatic image selection are unchanged, and old `java.install` Activity jobs stay readable.

### Breaking

- Remove host Java discovery/download management, the java CLI commands and /api/v1/java/* REST routes. Docker Java image selection is unchanged. Remove [java] and CHUNKYARD_JAVA__ALLOW_SYSTEM_JAVA configuration; existing runtime files and database history are retained.
## 0.10.0 - 2026-11-14


### Added

- REST API: GET /api/v1/system/isolation reports Docker engine CPU, memory, architecture and operating system for resource allocation guidance; unavailable capacity remains null.
- REST API: add CurseForge pack metadata and same-origin normalized logos, plus GET/PUT/DELETE /api/v1/servers/{id}/icon for validated custom display icons independent of Minecraft game files.
- Backend and REST API: install/export jobs expose persisted work stages and observed download, compressed-output, S3 upload and read-back verification bytes without inventing an overall percentage.
- Backend and REST API: POST /servers/{id}/archive retains server identities after verified S3 backup checks; POST /exports/{id}/restore safely restores full archives without starting games. Journaled publication recovers interrupted moves, preserves properties history and protects pinned restore points.
- Web UI: resource controls show Docker host totals from `GET /api/v1/system/isolation` (`docker.capacity`), fetched once when the controls open, and warn when Server RAM plus JVM overhead exceeds or crowds host memory or the CPU limit exceeds logical CPUs. Warnings never block saving or change values; unknown capacity is shown as unknown.
- Web UI: Settings → Display uploads, changes or resets a Chunkyard display icon (PNG/JPEG/WebP/ICO up to 2 MiB, checked before sending) via `PUT`/`DELETE /api/v1/servers/{id}/icon`, applying the returned server. Server cards and the page header share one icon component: custom icon, then CurseForge pack logo, then a generic icon; only same-origin icon routes are loaded. The Minecraft `server-icon.png` is not changed. Pack names and links come from `GET /api/v1/modpacks/curseforge/{projectId}`, including for older servers.
- Frontend: install, export and Activity views show the stage a job is in, its byte counts, observed completed steps and a per-step percentage only when the step size is known (from optional `Job.work`); compression shows bytes written, upload and read-back verification are separate steps, and failed or interrupted jobs show where they stopped.
- Web UI: archived servers stay on the Servers page with an Archived badge, newest full S3 backup age, a local/archived filter and a confirmed Restore from the pinned backup. Server pages offer an explicit, stopped-only "Remove local files" action against a chosen full S3 backup (blocked by unsaved file edits), hide local console/files/properties/lifecycle/metrics while archived, and track `server.archive`/`server.restore` jobs with recovery, stage progress and Activity summaries. Storage & exports adds a Servers tab grouping backups by server (local, archived, removed from manager) with Restore for full archives only; pinned restore points cannot be deleted from the UI. Uses `POST /api/v1/servers/{id}/archive` and `POST /api/v1/exports/{id}/restore`.

### Changed

- Web UI: the new-server wizard keeps Back/Next and step progress in a sticky top bar, and a plain click on a managed software type or a modpack release continues to the next step (keyboard selection, modified clicks and edits of earlier steps never advance; creation, install, start and EULA acceptance still need explicit confirmation).
- Web UI: the modpack step uses the full content width with responsive pack cards (logo, name, two-line summary, downloads, CurseForge link) that select as a whole, and lists server-pack releases as a selectable list. Pack logos load only from the same-origin `/api/v1/modpacks/curseforge/{id}/logo` route and fall back to a monogram.
- Web UI: create and Settings → Resources share one resource control: a Server RAM (maximum heap) slider from 1–16 GB with 2/4/6/8/12/16 GB presets and an exact-MiB custom field, the initial heap under Advanced, and a compact CPU row (1/2/4/8 or exact decimals). Existing non-preset values such as 512 or 8048 MiB stay exact as Custom.
- Web UI: the server Overview is compact: a software summary (real CurseForge pack name and link, Minecraft, loader, Java, install status), only attention-needing caveats (failed exit code, out-of-memory kill, EULA, unknown state, startup readiness) and the CPU/memory charts. IDs, paths, checksum, container ID and exit code moved to Settings → Advanced diagnostics with copy buttons; limits stay in Settings.
- Web UI: a server page runs a single metrics sampler shared by the Overview charts and a live CPU/RAM readout in the header, so the header updates on every tab. The readout hides when the server is stopped, refresh is off, the tab was hidden since the last sample, a sample failed, or the server changed. Redundant usage bars and stat blocks were removed.
- Frontend: the install panel names a CurseForge pack and release instead of project/file IDs when metadata is available, and the server page header no longer repeats the game port (it stays on server cards and in Settings → Network).

### Fixed

- Backend: declare the process crate runtime feature explicitly so standalone builds and tests do not depend on workspace feature unification.
## 0.9.1 - 2026-11-14


### Fixed

- Packaging: release tooling updates only project-version fields and checks the frozen frontend lockfile, preserving dependency requirements that match the previous project version. Corrects the unintended Tailwind Prettier plugin range change that blocked the 0.9.0 Docker build.
## 0.9.0 - 2026-11-14


### Added

- Web UI: Move and Copy in Files open a destination picker that browses real folders through GET /api/v1/servers/{id}/files (one request per folder, breadcrumbs, up and root), shows the full destination, and sends the existing POST /files/move or /files/copy {from,to}. A folder and its own subtree are never offered as its destination; protected folders, files and links are not selectable; truncated listings, empty folders and errors are explained. A "Type a path" option keeps manual entry, validated locally before any request. Nothing is overwritten: a known name clash is flagged locally and a server refusal keeps the dialog open with the source untouched.
- Web UI: files dragged from the desktop onto the Files list join the existing sequential upload queue for the folder shown at drop time, even if you navigate away before they upload. A drop target appears only while dragging files; dropped folders are skipped with a notice (folder upload is not supported); destinations already waiting are not queued twice; root server.properties, root eula.txt and .chunkyard-* names are rejected before upload; replacing an existing file still requires Replace. Drops are refused while files are read-only, the browser never opens a dropped file, and waiting uploads become retryable failures if the server leaves the stopped state.

### Fixed

- Frontend: upload queues recheck write permission before each request, retry and replacement; Retry/Replace controls stay disabled while files are read-only, and waiting files remain paused until an explicit retry.
## 0.8.0 - 2026-11-14


### Added

- Web UI: the Servers page can search the servers returned by GET /api/v1/servers by name, software, version or port, filter by state and software, and sort by name, state or port. A count shows how many of the loaded servers match, a no-match state offers Clear filters, the create tile stays first, and only the sort order is remembered in local storage.
- Web UI: a quick-navigation palette opens with Ctrl/Cmd+K or the Go to button in the top bar. It searches app pages (Servers, New server, Activity, Java runtimes, Storage & exports, API reference) and the servers from GET /api/v1/servers by name, software, version or port, and opens their Overview, Console, Properties, Files, Exports, Activity or Settings tab. It only navigates, through the normal unsaved-changes guard. The server list is fetched when the palette opens, cached in memory for 15 seconds per session, and the request is cancelled when the palette closes.

### Fixed

- Frontend: management tabs follow same-server and cross-server deep links, including palette navigation and browser history; tab clicks update the URL without reloading editors or discarding unsaved changes.
## 0.7.0 - 2026-11-14


### Added

- REST API: GET /api/v1/jobs accepts optional serverId and activeOnly filters before cursor pagination, including history for deleted instances. Indexed instance and active-job queries support reconnecting to ongoing work without scanning unrelated history; existing query contracts remain compatible.
- Frontend: server pages reconnect to their queued or running install, start/stop/restart/kill, export and delete jobs after a reload, server switch or returning to the tab (GET /api/v1/jobs?serverId=…&activeOnly=true&limit=200, then GET /api/v1/jobs/{id}). Nothing is resubmitted; completion refreshes the server record and archive list, failures (including job.interrupted) link to Activity, and recovered polling stops while the tab is hidden.
- Frontend: each server page has an Activity tab listing that server's job history, filtered server-side with serverId and cursor-paged, reusing the global Activity rows and detail links.

### Fixed

- Frontend: the shell active-job indicator counts all queued/running jobs via GET /api/v1/jobs?activeOnly=true&limit=200 instead of scanning the newest 20 jobs; job views only trigger a re-check and never overwrite the global count with a scoped or partially loaded one.
## 0.6.0 - 2026-11-14


### Added

- Frontend: the Files editor and the Properties raw view use a lazily loaded CodeMirror editor with line numbers, undo/redo, find/replace, line/column status and JSON, YAML, TOML, properties and shell highlighting. Saves keep the file's line endings, BOM and trailing newline; unchanged files are never rewritten; read-only, stopped-only and etag conflict rules are unchanged.
- Frontend: leaving a server page, or opening another file, with unsaved Files editor changes asks to stay or discard in an in-app dialog instead of a browser prompt; tab switches keep edits and Properties autosave still flushes on navigation.
- Frontend: the Console has a view-only filter with match highlighting, wrap and follow toggles with a paused/jump-to-latest indicator, copy and plain-text download of the lines held in the browser, and per-server Up/Down recall of commands sent from the current tab.
## 0.5.0 - 2026-11-14


### Added

- Web UI: Activity page lists durable jobs from GET /api/v1/jobs and /api/v1/jobs/{id} with cursor "Load older jobs", client-side server/state/type filters over loaded jobs, timestamps, run/queue durations, sanitized failures and an allowlisted result summary per job. Only queued/running jobs are re-fetched, sequentially, paused on hidden tabs and stopped on navigation; no cancellation or percentages are shown. The sidebar shows a discreet active-job count checked on navigation, without a background timer.
- Web UI: Files can select files and folders from the current listing (per-row and select-all-visible checkboxes, up to 100 paths, kept per server across tabs and in-app navigation) and send them to the Exports tab, which merges them with typed paths and confirms the exact paths and destination before POST /api/v1/servers/{id}/exports with scope "selected". Exports still require a stopped server; links and special files cannot be selected.
- Web UI: the Resources panel charts CPU and working-set memory from the samples it already polls, kept only in memory while the view is open (up to 120 per server, reset on server switch). Stopped containers, failed samples and long pauses appear as gaps rather than zeros or interpolated lines; values are also given as text.
## 0.4.0 - 2026-11-14


### Added

- Web UI: CurseForge modpack creation lists popular packs, explains unavailable downloads, unsupported packs, file conflicts and missing launch targets, and lets failed pack installs retry on the same server with optional Minecraft, loader, Java and launch overrides (`POST /api/v1/servers/{id}/install` body). Settings has a Launch row for Jar, Java argument file or Bash script launches with one-argument-per-line JVM/game arguments, an optional Docker image and detection reset (`GET`/`PATCH /api/v1/servers/{id}/launch`). Server pages show the installed Minecraft version, loader and launch type instead of build labels meant for Paper.
- REST API: CurseForge search and server-release listing via /modpacks/curseforge, plus checksum-verified server-pack installation through /servers/{id}/install. Detects Forge, NeoForge and Fabric layouts, runs loader preparation in isolated Docker, preserves owner files/properties and never starts Minecraft or accepts its EULA. CHUNKYARD_CURSEFORGE__API_KEY stays on the backend and is redacted from config output.
- REST API: GET/PATCH /servers/{id}/launch exposes detected profiles and stopped-instance overrides for Java JARs, argument files or Bash scripts, JVM/game arguments, Java major and image. Existing server records retain their prior launch behavior; installation accepts optional overrides for unusual modpacks.
## 0.3.0 - 2026-11-14


### Added

- Web UI: server Exports tab and a global Storage & exports page. Export a stopped server's worlds, full instance or typed selected paths as a verified .tar.gz on the manager host or S3, follow the job, and download or delete archives, including archives of deleted servers. The S3 connection form masks and retains the secret and tests the saved connection. Restoring is a manual extraction.
- Web UI: Settings → Resources edits an existing server's heap bounds and CPU limit through PATCH /api/v1/servers/{id}/resources while the server is stopped; the next start uses the new limits.
- REST API: stopped-instance world, selected-path and full .tar.gz exports, persistent archive catalog, authenticated downloads and deletion via /servers/{id}/exports and /exports. Private S3/RustFS connection and write/read/delete test via /storage; uploads are SHA-256 verified before local staging is removed. Archives survive instance deletion.
- REST API: PATCH /servers/{id}/resources changes CPU and heap bounds while stopped, preserving files and recreating the owned container on next start.

### Fixed

- Web UI: the server tab row no longer shows vertical scrollbar arrows and still scrolls horizontally on narrow screens.
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
