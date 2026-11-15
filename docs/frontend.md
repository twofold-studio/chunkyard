# Web UI

The SvelteKit app in `web/` is a client-rendered SPA for a single owner. It uses only the implemented REST API ([HTTP API](http-api.md), [Docker usage](docker.md)). Development setup is in [`web/README.md`](../web/README.md).

## What it does

- **Authentication.** Reads `/api/v1/setup/status`. First-run setup in two steps (verify the setup token, then create the owner with email and password) and email/password sign-in when authentication is enabled; sign-out from the sidebar. When the backend runs with `CHUNKYARD_AUTH__ENABLED=false`, setup and login are skipped and the sidebar shows "Authentication disabled"; no user is shown or invented. An expired session on any request returns the browser to sign-in.
- **Servers.** List with container status, refreshed every 10 s while the tab is visible. Staged Vanilla/Paper/CurseForge creation with version/build or pack-release selection, automatic verified installation, Java image selection, name, port, heap, CPUs and explicit EULA acceptance. Custom JAR/image fields remain an advanced choice. Management tabs provide lifecycle controls, console, properties, files, exports, launch/network/resources settings and EULA acceptance. Generic file and runtime-setting changes require a stopped instance.
- **API reference.** Public, searchable local rendering of the live OpenAPI document, including schemas and examples; no request execution.
- **Integrations.** Create named owner API keys, copy each secret once, and revoke keys. The page includes MCP endpoint and Claude Code setup examples; OAuth-only browser connectors are not supported.
- **Resources.** Shared metrics WebSockets feed the header, Overview and running server cards. Sub-second detail sampling requires an explicit High frequency choice for that visit and a visible chart in a focused window; otherwise the page uses normal or standby cadence. Visible cards sample at five seconds or slower; off-screen cards and hidden pages release their streams. The fastest active viewer controls the shared sampler. Charts keep up to 180 samples while viewed, with gaps for missing data. See [monitoring](monitoring.md).
- **Docker status** in the sidebar from `/api/v1/system/isolation`.

## Behaviour to know

- A small version badge opens a changelog modal, including on setup/login. `CHUNKYARD_HTTP__SHOW_VERSION=false` hides it and disables changelog delivery.
- Every mutation sends `X-MCM-CSRF: 1`; requests are same-origin with relative paths. The UI must be served from the origin in `CHUNKYARD_HTTP__PUBLIC_URL`.
- Lifecycle, software installation and export operations are jobs. Views track their IDs and recover active work after navigation. Install/export progress shows measured stages and bytes, with percentages only when a stage has a known total.
- The console streams over a same-origin WebSocket while running, visible and open. It keeps at most 1000 lines, resets on reconnect, and falls back to sequential 3-second snapshots if streaming is unavailable. Stopped servers show one snapshot. Commands still use the protected POST route.
- Server status is re-read every 5 s on the detail page. "Container running" means the process runs; Minecraft may still be starting.
- Creating a managed server submits creation followed by an install job automatically; it downloads the selected software, without starting Minecraft or accepting the EULA. Failed installs retain the server ID for retry. Only Custom JAR creation asks you to supply a file.
- Docker servers use Java from their image; there is no host Java runtime management page.
- File editors offer optional, remembered Vim mode. `:w` saves, Ctrl/⌘+S remains available, and Esc then Tab leaves the editor. Folder/file navigation participates in browser Back/Forward history; unsaved edits retain their guard.
- Properties history compares changed, added and removed settings between revisions. The console supports safe ANSI/Minecraft colors, a viewport-height log, and local built-in/history command suggestions with Tab. Suggestions never execute a command automatically.
- All polling and in-flight requests are cancelled when leaving a page.

## Instance inventory and deletion

The server list uses compact responsive cards with software, installed/requested Minecraft version, RAM, CPUs and host port, each with an icon. A dashed Create server tile always occupies the first slot, including when instances already exist. The port field defaults to Automatic; an explicit port may be shared, but only one instance using it can run at a time.

Stopped local instances can be deleted from Settings after confirmation. World and server files are retained on the manager host by default, with a copyable path. An explicit checkbox permanently deletes those files too. Deletion tracks only its job and returns to the list after success; it does not continue polling the removed server. An interrupted deletion may have partially completed, so errors do not promise that all requested files survived.

There is no UI for editing CPU/heap limits after creation, modpacks, historical metrics/graphs, multiple users or roles, 2FA, or API tokens. Vanilla/Paper installation, file management and network settings are implemented.

## Production hosting

Build the SPA, then start the Rust service from the repository root:

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
cargo run -p chunkyard-server -- serve
```

Open `http://127.0.0.1:8420`. Rust serves the UI and API on the same origin, including direct navigation and refreshes on `/servers` and `/integrations`. The Docker image builds and includes the UI automatically; no Node runtime or separate web server is needed at runtime.

`http.ui_dir` defaults to `web/build`, relative to the working directory. Set `CHUNKYARD_HTTP__UI_DIR=/absolute/path/to/build` for an installed binary, or set it to an empty string for API-only operation. A missing directory also starts in API-only mode; an existing directory without `200.html`, or containing symlinks, fails startup. Assets are loaded once with a 64 MiB bundle limit; restart after replacing the build. UI files are distributed alongside the binary, not embedded in it. Source maps and hidden files are excluded.

HTML uses `no-store` and a page CSP with hashes for the build's inline bootstrap scripts. JavaScript `eval()` and inline event handlers are blocked; same-origin scripts, API calls and fonts are allowed. Inline styles support Svelte components. Hashed `/_app/immutable/` assets have a one-year immutable cache policy; other assets revalidate using ETags. API responses retain their restrictive CSP and `no-store`. Host/origin/CSRF checks apply across both UI and API routes. Unknown `/api` routes return JSON errors, and missing assets return 404 instead of the SPA.

For a reverse proxy, preserve the original `Host` and set `CHUNKYARD_HTTP__PUBLIC_URL` to the external origin. Vite remains available for development as described in `web/README.md`.

## Integration limits

- There is no live console stream (no WebSocket) and no job cancellation.
- `/api/v1/servers` returns at most 100 servers; there is no pagination UI.

## Hosting verification

`node scripts/smoke-properties-console.mjs` additionally checks the contextual header, Properties Enter/debounce autosave, running/saved revision separation, restart application, history restoration, real WebSocket console output and the metrics preference. Build the Rust binary/UI and the disposable `mcm-manager-test-runtime:local` image (`docker build -t mcm-manager-test-runtime:local testdata/docker-runtime`) first. It uses temporary data and a shell console fixture, not Minecraft; it removes its container afterward. Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an installed Chrome as needed.

After building the UI and `cargo build -p chunkyard-server --locked`, run `node scripts/smoke-ui.mjs`. It uses Playwright Chromium to check the real Rust service in both auth modes, owner setup, session persistence, navigation, refreshes and CSP violations. Install Chromium with `pnpm --dir web exec playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome executable. The test uses temporary data and disables Docker operations. CI runs it after frontend validation, component/unit tests and the production build.

## Vanilla/Paper creation

The creation wizard guides software, version/build, name/port, resources, review/EULA and installation. The backend supports Vanilla/Paper and CurseForge linked server packs, including Forge/NeoForge/Fabric loader preparation. Standalone Forge/Fabric catalog entries remain unavailable. Custom JAR skips the version/install stages. Back keeps entered values; review rows link back to their step. Docker image overrides are optional. Creation happens only after review, and failed installs retry against the same saved ID. Start remains unavailable until managed installation succeeds. EULA acceptance is always explicit. See [API contracts](http-api.md) and [installation details](docker.md#managed-vanilla-and-paper-installation-rest-api).

## Instance management and motion

The selected instance's name, status, concise software/port/memory summary and lifecycle controls occupy the main top bar. They update on server changes and clear when leaving the instance. Overview keeps secondary container details. Management tabs are Overview, Console, Properties, Files, Exports and Settings; compact Settings rows expand networking, CPU/RAM and launch controls alongside EULA acceptance.

Properties provides a searchable grouped form and a raw-text view. Booleans, choices, numbers and unknown keys can be edited without rewriting unrelated comments/formatting. Changes autosave after about 900 ms of inactivity, immediately on Enter in a single-line input, or after changing a switch/select. There is no Save button or ordinary save confirmation. Navigation and start/restart flush queued edits first; conflicts and failures remain visible instead of overwriting another saved version. Editing works while Minecraft runs: the tab distinguishes the saved and running versions and marks restart-required changes. History can preview and restore earlier content as a new version without restarting.

Files supports breadcrumbs, sorting/filtering, new files/folders, uploads, downloads, rename/move/copy and confirmed permanent deletion. Generic file mutations require a stopped instance; `server.properties` opens the dedicated versioned Properties tab. Upload conflicts require explicit replacement. Text saves use the last-read etag and stop on conflicts. Limits and protected paths are described in [instance files](http-api.md#instance-files).

Editors remain mounted across management tabs. The generic file editor uses a reusable in-app Stay/Discard dialog when closing dirty content, choosing another file or leaving the instance; tab switches preserve edits without a prompt. Properties autosaves and flushes before navigation. Uploads run sequentially and cancel when leaving the instance page. Downloads are single files; folder ZIP and resumable uploads are not implemented.

Resources has a refresh preference for Off, 1, 2, 5, 10, 30 or 60 seconds. It is saved in this browser and reused across instances. Polls never overlap and pause when hidden. Off retains the last snapshot and supports manual Refresh.

`web/src/lib/motion/index.ts` supplies shared durations, easings and fade/rise/pop/step/collapse transitions. `Reveal` and `Swap` compose these presets; `layout.css` provides matching hover/press/highlight utilities. Motion is brief and runs on entry. System reduced-motion preferences disable movement and dialog animations.

For an opt-in production UI check using a real local Docker engine and an official Vanilla download (temporary data, no EULA acceptance or game startup), build the Rust binary/UI and run:

```sh
CHUNKYARD_TEST_LIVE_INSTALL=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/run/current-system/sw/bin/google-chrome-stable node scripts/smoke-ui.mjs
```

With the flag, the smoke also exercises text editing, downloads, uploads, the unsaved-navigation guard and network settings against real APIs. Without it, a fixed version-list fixture and disabled Docker verify real create/install failure and same-record retry without upstream access. Leaving the creation page stops that page’s job tracking, while installation continues on the backend. Opening the server page discovers active jobs for that instance and follows their existing IDs without resubmitting work.

## Activity, selection exports and resource history

Activity lists cursor-paged background jobs, filters the loaded records and refreshes active jobs while visible. Detail pages show safe summaries of known result fields; there is no raw JSON or cancellation. Install/export work shows observed stages and bytes, with percentages only when the current stage has a known size. The sidebar indicator queries active jobs globally on navigation and when a job view observes a change; scoped views never replace the global count with their own. It has no independent polling timer.

Files offers up to 100 selected file/folder paths per instance. Selecting a folder includes its contents. Export selected opens the existing Exports tab; a confirmation lists the paths and local/S3 destination before submitting the stopped-only export. Selections survive in-app navigation, but a reload clears them. Typed paths remain available.

Overview charts reuse the existing resource snapshot polling, hold at most 120 samples, and break lines for missing samples and pauses. This is temporary history collected while Overview is open, not stored backend history. Leaving Overview resets the charts. See [implementation status](implementation-status.md) for remaining monitoring and backup work.

## Code editing and console tools

Files and the Properties raw view load CodeMirror only when an editor opens, with a plain-textarea fallback if loading fails. Line numbers, undo/redo, find/replace, line/column status and JSON/YAML/TOML/properties/shell modes are available. Generic files still save explicitly with Ctrl/Command+S and etags; Properties keeps its autosave. BOM, line endings and a missing trailing newline survive edits; an untouched file is never rewritten. Edited mixed-ending files use their first line ending. Press Esc then Tab to move focus out of the editor.

Console filtering and highlighting are local to the current buffer. Wrap and Follow controls change the view; scrolling up pauses following and offers Jump to latest. Copy and text download use the currently displayed lines, including an active filter, with at most 1,000 lines retained. Up/Down recalls at most 50 previously sent commands per instance in memory; recalling never sends a command. Nothing claims persisted log history or changes logs on the server.

## Recovering ongoing work

Server pages discover active jobs on entry, server switches and returning to a visible tab through the filtered jobs API. Installs reuse their panel, lifecycle work appears in the compact header, recovered exports block conflicting actions and refresh archives on completion, and recovered deletions leave the deleted instance. Failure links open Activity. A per-instance Activity tab provides server-filtered, cursor-paged history; state/type filters still apply only to loaded jobs.

Recovered polling stops while hidden and resumes by job ID, so work that finished while hidden still reaches a terminal state. Jobs started locally retain their existing polling behavior. Local and recovered trackers share ownership bookkeeping; an existing tracker is not duplicated on visibility changes. See [the recovery contract](jobs-recovery-contract.md).

## Quick navigation and server-list controls

Ctrl/Command+K or the top-bar Go to button opens a navigation-only palette. It searches app destinations and loaded server names/software/versions/ports, including links to individual management tabs. Arrows/Home/End select, Enter opens and Escape closes. Server data is fetched on open, cached in app memory for 15 seconds and cleared across authentication context changes; there is no background palette polling. Unsaved Files navigation and Properties flush still run for links that leave the server.

The server list searches names/software/versions/ports, filters by state/software and sorts by name/state/port. Only the sort preference is saved locally. Counts and filters cover the records returned by GET /servers, not a separate global search service. The create tile stays first, and no-match results can clear filters without losing that tile.

Management tabs stay synchronized with URL deep links and palette navigation. Clicking a tab updates its URL through same-server shallow routing, keeping editors mounted and preserving unsaved edits.

## File destinations and drops

Move and Copy offer a destination folder picker with breadcrumbs, root/up navigation, a filename and an exact destination summary. Only folders are shown; protected folders and a directory’s own subtree cannot be selected. Manual relative paths remain available. Listings load one folder at a time with cancellation and stale-response protection, and truncated results are labelled. Existing destinations are never overwritten; server errors leave the dialog open and the source intact. Rename retains its simple name input.

Files can be dropped onto the file list or selected through the Upload button. Each queued file keeps the folder captured when it was added, uploads sequentially, and needs explicit Replace on a clash. Pending destinations are deduplicated; unsafe/protected names and files over 128 MiB are rejected locally. Queue requests and Retry/Replace recheck whether files are writable; in-flight requests remain subject to backend validation. Dropping outside the list does not navigate away. Identifiable folder drops are skipped; browsers without directory-entry detection should use Choose files. Folder uploads and resumable transfers remain unsupported.
