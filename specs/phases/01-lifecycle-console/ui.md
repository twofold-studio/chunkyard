# Phase 1 — UI

## New files

```
web/src/routes/(app)/
├── +page.svelte                                   # dashboard
├── servers/new/+page.svelte                       # create wizard
└── servers/[id]/
    ├── +layout.svelte                             # ServerHeader + tab nav (Overview, Console; later phases add tabs)
    ├── +layout.ts                                 # load server via features/servers/api
    ├── +page.svelte                               # overview
    └── console/+page.svelte
web/src/lib/features/
├── servers/
│   ├── api.ts                                     # list/get/create/update/delete/power/clone/eula/javaDetected
│   ├── servers.svelte.ts                          # ServersState: map id → ServerDto, fed by WS `servers`
│   ├── schema.ts                                  # zod for CreateServerRequest / UpdateServerRequest
│   └── components/
│       ├── ServerCard.svelte  ServerGrid.svelte  StatusBadge.svelte  PowerControls.svelte
│       ├── CreateServerWizard.svelte  SourceStep.svelte  JavaStep.svelte  ResourcesStep.svelte  OptionsStep.svelte  ReviewStep.svelte
│       ├── ServerHeader.svelte  ServerInfoCards.svelte  ExitBanner.svelte  EulaBanner.svelte
│       ├── LifecyclePolicyDialog.svelte  CloneDialog.svelte  DeleteServerDialog.svelte  CrashLogList.svelte  CrashLogViewer.svelte
└── console/
    ├── api.ts                                     # sendCommand, fetchLines, logDownloadUrl
    ├── console.svelte.ts                          # ConsoleSession: subscribe {epoch, sinceSeq}, lagged/reset handling, write to terminal
    ├── history.svelte.ts                          # CommandHistory (localStorage key mcm:history:<userId>:<serverId>, max 100, dedupe consecutive)
    └── components/ConsoleTerminal.svelte  CommandInput.svelte  ConsoleToolbar.svelte
```

## Screens

### Dashboard `/`

- `ServerGrid` of `ServerCard`s: name, flavor/version badge, `StatusBadge` (colour + label; pulsing for starting/stopping), address `<public host>:<port>` with copy, uptime (from `readyAt`), quick `PowerControls` (start or stop; restart/kill in overflow menu).
- Header button "New server" (visible with `server.create`).
- Live updates via WS `servers`; no polling.
- Empty state: illustration-free card "No servers yet" + "Create server" CTA.

### Create wizard `/servers/new`

| Step | Fields | Notes |
|---|---|---|
| Source | Radio (`source.kind`): "Download jar from URL" (url, optional SHA-256, file name) / "Import existing directory" (path, optional jar path, "move instead of copy" checkbox) | Import option disabled with tooltip when `import_roots` empty (from `system/info.features` containing `import`). P3 adds the `installer` kind as flavor cards, P4 the `pack` kind — same wizard, additive. |
| Java | Select from `/java/detected` (path, version, vendor) or "Custom path" (admin) | Warn if none detected: "Install Java or wait for managed runtimes (coming soon)". |
| Resources | Name, memory min/max (slider + number, MiB/GiB toggle), port ("auto" default or number), JVM args (tag input) | Inline validation from `schema.ts`. |
| Options | Auto-start on boot, restart on crash | |
| Review | Summary, "Create" | On `202 {server, job, warnings}`, navigate to `/servers/<id>`, show `JobToast` for `server.create`, and render `warnings` (e.g. `jvm_args_admin_freeform`) as a dismissible alert. |

### Server layout `/servers/[id]`

`ServerHeader`: name, slug (muted), `StatusBadge`, `PowerControls` (Start / Stop / Restart / Kill — kill in a dropdown with `ConfirmDialog`), kebab menu: Edit lifecycle policy, Clone, Delete. Tabs: Overview, Console.

### Overview

- `EulaBanner` when `!eulaAccepted` or `exit.reason === "eula_required"`: text with link to https://aka.ms/MinecraftEULA and "Accept EULA" button (`ConfirmDialog`), then offers "Start now".
- `ExitBanner` for `crashed` / `crash_loop` / `start_failed` with exit code/signal and "View crash log".
- `ServerInfoCards`: Address, Status since, PID, Restart count / next restart countdown, Java path + version, Memory, Launch spec, Runtime ("Native — stops when mcm restarts" with info tooltip linking the docs).
- `CrashLogList` + `CrashLogViewer` (read-only `<pre>` with ANSI stripped).
- `LifecyclePolicyDialog`: autoStart, restartOnCrash, maxRestarts, restartWindowS, stopCommand, stopTimeoutS, startTimeoutS, readyPattern, log format (`logFamily` select: auto/vanilla/fabric/paper/forge/bungee). Saves via PATCH and shows returned `warnings`.
- `CloneDialog`: new name → navigates to the clone once job succeeds.
- `DeleteServerDialog`: type server name to confirm; "force (kill if running)" checkbox.

### Console `/servers/[id]/console`

- `ConsoleTerminal`: xterm.js (`convertEol: true`, `disableStdin: true`, scrollback 10 000, `FitAddon`, `SearchAddon`, `WebLinksAddon`), theme follows app theme. Lines written as `text + "\r\n"`; `input` lines rendered dim with `> ` and `[user]` prefix; `system` lines yellow `[mcm]`; `stderr` red.
- Auto-scroll follows tail unless user scrolled up; "Jump to bottom" chip appears.
- On `lagged`: inline notice `… N lines skipped (output too fast)`. On `reset`: clear terminal then write snapshot.
- `CommandInput`: single-line input, Enter sends, ↑/↓ history, Esc clears, disabled with reason when state not running or no `console.write`. Sends via WS op `command`; shows error toast for problem codes.
- `ConsoleToolbar`: search (Ctrl+F), clear view (client only), download log (`console/log`), connection indicator.
- Reconnect resumes using `ConsoleSession.{epoch, lastSeq}`; after an mcm restart the server answers `reset` and the terminal is redrawn (no mixed-epoch lines).

## States

| Component | States |
|---|---|
| ServerCard | per state colour; installing shows job progress bar |
| PowerControls | buttons disabled per state; pending spinner until status event confirms |
| Console | connecting skeleton, live, disconnected banner with retry, permission-denied message |
| Wizard | step validation errors, submitting, job failure shows `ProblemAlert` with job error code |
