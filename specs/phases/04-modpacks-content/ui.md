# Phase 4 — UI

Feature directory: `web/src/lib/features/content/` (browse, install, installed list) and `web/src/lib/features/packs/` (import wizard, manual downloads). Conventions: [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions).

```
features/content/
├── components/ PlatformTabs.svelte, SearchFilters.svelte, ProjectCard.svelte, ProjectDetailSheet.svelte,
│               SafeMarkdown.svelte, VersionPicker.svelte, InstallPlanDialog.svelte,
│               InstalledTable.svelte, UpdatesBanner.svelte, SideBadge.svelte
├── api.ts       search, project, versions, plan, install, toggle, remove, checkUpdates, update
├── browse.svelte.ts   BrowseState: platform, query, filters, debounced search, paging
└── installed.svelte.ts InstalledState: items, optimistic toggle, restartRequired flag
features/packs/
├── components/ ImportWizard.svelte, PackSourceStep.svelte, PlanReview.svelte, ImportProgress.svelte,
│               ManualDownloads.svelte, ManualDropzone.svelte, ImportReport.svelte
├── api.ts       preview, import, pack, pending, resolve, skip
└── import.svelte.ts ImportState
features/integrations/components/CurseForgeKeyCard.svelte   (admin settings page)
```

## Screens

### `/servers/new` — "From modpack" tab (extends phase 1/3 wizard)

| Step | Content |
|---|---|
| 1 Source | Tabs: CurseForge · Modrinth · Upload file. Platform tabs show search (`ProjectCard` grid with icon, name, downloads, MC versions). CurseForge tab without key: empty state "CurseForge needs an API key" with link to admin settings (admins) or "ask an admin" (others). Upload accepts `.zip`/`.mrpack` via chunked upload with progress |
| 2 Version | `VersionPicker`: list with release-type badge, MC version, loader, "Server pack" badge; toggle "Prefer server pack" (default on) |
| 3 Review | `PlanReview` from `/import-pack/preview`: loader + MC + Java, file counts, total download size, list of suspected client-only mods (with reasons), manual-download count with explanation, warnings. Optional files checklist (mrpack `optional`) |
| 4 Server | Name, memory (pack suggestion shown as placeholder and applied **only if left blank**; explicit lower value shows a warning), port, EULA checkbox (link to Mojang EULA) |
| 5 Progress | `ImportProgress` bound to job WS updates: stage list with current stage, % bar, log tail; Cancel button |

On `needs_manual_downloads` result, the wizard navigates to the server's **Content › Manual downloads** view.

### `/servers/[id]/content`

| Area | Behaviour |
|---|---|
| Header | Pack card (if from pack): name, version, "Update available" badge (informational tooltip "Pack upgrades are not supported yet") |
| Manual downloads banner | Visible when `pendingCount > 0`: "N files must be downloaded manually" → opens `ManualDownloads` |
| Installed tab | `InstalledTable` (shadcn DataTable): name, version, source icon, side badge (`client_suspected` amber with reasons tooltip), enabled switch, actions menu (update, remove, open project page). Filter by kind/source/enabled; search |
| Browse tab | `PlatformTabs` (Modrinth · CurseForge · Hangar shown only for paper/purpur), filters with MC version + loader pre-filled from server and locked by default ("Show incompatible" toggle unlocks) |
| Updates | "Check for updates" button → `UpdatesBanner` lists updatable items with per-item Update |
| Restart banner | When `restartRequired`: "Restart to apply content changes" with Restart button (requires `server.power`) |

### `ProjectDetailSheet`

Side sheet: header, gallery icons, `SafeMarkdown` description (DOMPurify; for CF HTML descriptions, same sanitizer), versions list, Install button → `InstallPlanDialog` (lists requested + dependency files, conflicts in red with "Install anyway" requiring confirmation, manual files explained).

### `ManualDownloads`

| Element | Behaviour |
|---|---|
| Explainer | Short text: author disabled third-party downloads; download each file from CurseForge and drop them here |
| Table | File name, project link (opens `websiteUrl` in new tab, `rel=noopener noreferrer`), state badge, Skip action (confirm) |
| `ManualDropzone` | Multi-file drag-drop (also accepts a zip of jars); uploads via chunked upload; shows per-file match result (matched → row turns green; unmatched → error with the file name and "doesn't match any expected file") |
| Completion | When `remaining = 0`, shows finalize job progress, then success toast and Start button |

### Admin settings — Integrations

`CurseForgeKeyCard`: masked status (configured / source), input for key, "Test" and "Save" buttons, read-only notice when set by environment.

## States

Every list: skeleton loading, empty (with call-to-action), upstream error (problem `code` mapped to friendly text: rate-limited → retry countdown from `Retry-After`; key missing; upstream down).

## Accessibility

Dropzone has a visible "Choose files" button fallback; switches labelled with item names; sheet focus-trapped; badges have text, not colour only.

## Additional states (review fixes)

- Import report shows a banner "Server pack needs a starter script — built from the client pack instead" for `pack.server_pack_starter_fallback`.
- Content page on native-runtime servers shows a notice: "Installing mods/plugins runs code as the mcm system user. Only admins can do this on native servers." (D1, see [security.md](../../architecture/security.md#native-runtime-is-single-trust)).
- Wizard response handling uses `{server, job, warnings}` and renders `warnings[]` as inline alerts.
