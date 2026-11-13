# Phase 3 — UI

Features: `installers`, `java`, `servers` (wizard). Conventions: [frontend.md](../../architecture/frontend.md).

## Create server wizard — `/servers/new`

`features/installers/components/CreateServerWizard.svelte`, state in `features/installers/wizard.svelte.ts` (`class WizardState { step=$state(0); flavor=$state<Flavor|null>(null); mcVersion; build; java; memory; port; name; acceptEula; plan=$state<InstallPlanDto|null>(null); canNext=$derived(...) }`).

| Step | Component | Content |
|---|---|---|
| 1 Software | `FlavorPicker.svelte` | Cards grouped Vanilla / Plugins (Paper, Purpur) / Mods (Fabric, Quilt, Forge, NeoForge) / Proxies (Velocity, BungeeCord, Waterfall — the latter with an "End of life" badge), each with short description. "Custom jar" card links to phase 1 flow |
| 2 Version | `VersionPicker.svelte` | Searchable list (Combobox) of MC versions (proxy versions for proxies); "Show snapshots" toggle when supported; unavailable versions disabled with tooltip; latest release preselected |
| 3 Build / loader | `BuildPicker.svelte` | Paper/Purpur build list (stable badge), Fabric/Quilt loader list, Forge: "Recommended (47.2.0)" / "Latest (47.3.0)" / pick, NeoForge list with beta badges. Skipped for vanilla |
| 4 Resources | `ResourcesStep.svelte` | Name, memory (`MemoryField` from phase 2), port (auto), Java: "Automatic (Java 21 — will be downloaded)" or manual select from runtimes |
| 5 Review | `PlanReview.svelte` | Calls `POST /installers/plan`; shows artefacts + sizes (cached ones marked), Java download needed, warnings (`Alert`), EULA checkbox with link `https://aka.ms/MinecraftEULA` (hidden for proxies), "Start after install" switch |

Submit → `POST /servers` → navigate to `/servers/[id]` where the `InstallProgress` panel shows job progress and the console tab streams `[install]` lines. Errors render the problem component with "Retry install" (re-POST `/servers/{id}/install` with the same request) and "Delete server".

Back/next keep state; leaving the wizard with selections triggers the unsaved-changes guard.

## Server overview — "Software" card

`features/installers/components/SoftwareCard.svelte` on `/servers/[id]`:

- Flavor icon, MC version, loader/build, Java runtime + mode.
- "Update available" badge when `updates.latestBuild` / `latestLoader` differs → "Update" button opens `ChangeVersionDialog` prefilled.
- "Change version…" → `ChangeVersionDialog.svelte`: reuses Version/Build pickers; shows downgrade / flavor-change warnings with required confirmation checkboxes; disabled while running (tooltip "Stop the server first").
- "Previous versions" → `PreviousInstallsDialog.svelte`: list with Rollback buttons (ConfirmDialog).

## Server settings — Java section (extends phase 2 General tab)

`JavaSelect.svelte`: radio Auto / Runtime / Path (Path admin-only); runtime select lists runtimes with major + vendor + managed badge; strict mismatch shows destructive `Alert` and an "I understand, use anyway" checkbox (sets `javaOverride`). Requirement fetched from `/java/requirement`.

## Admin — `/admin/java`

`features/java/components/`:

| Component | Content |
|---|---|
| `RuntimeTable.svelte` | Columns: Java major, version, vendor, managed/system badge, arch/os, used by (server links), actions (Delete — disabled with tooltip when used or system) |
| `InstallRuntimeDialog.svelte` | Select from `/java/available` (LTS highlighted) → `POST /java/runtimes/install`; progress toast linked to job |
| Toolbar | "Rescan system" → `POST /java/runtimes/discover` |

## Start flow change

`StartButton` (phase 1) handles `409 java.installing`: shows toast "Downloading Java 21…" with progress from the job and retries start automatically when the job succeeds (only if the user hasn't navigated away; otherwise a toast action "Start now").

## States

| Situation | UI |
|---|---|
| Upstream metadata fails | Picker shows error with Retry; stale-cache warnings shown as subtle `Alert` |
| Install running | Overview shows `Installing` badge; power buttons disabled; Cancel button cancels the job |
| `lastInstallError` set | Red banner on overview with error code/message and Retry |
| No runtimes and system Java disabled | Admin page empty state with "Install Java 21" CTA |
| Proxy bind port ≠ assigned port (`ServerPortMismatch`) | Warning `Alert` on overview with link to `velocity.toml` / `config.yml` in the file editor |
