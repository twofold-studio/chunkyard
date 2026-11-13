# Phase 6 — UI

Frontend conventions: [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions). New features: `features/backups`, `features/schedules`, `features/worlds`, `features/storage`.

## Routes

| Route | Page composition |
|---|---|
| `/servers/[id]/backups` | `BackupToolbar`, `BackupTable`, `BackupPolicyCard` |
| `/servers/[id]/schedules` | `ScheduleList`, `ScheduleEditorSheet`, `ScheduleRunsDrawer` |
| `/servers/[id]/worlds` | `WorldList`, `WorldUploadDialog`, `WorldResetDialog` |
| `/admin/storage` | `StorageTargetTable`, `StorageTargetDialog` |
| `/admin/backups` | `BackupTable` in orphaned mode with "Restore into…" action |

## Backups (`features/backups/components`)

| Component | Behaviour |
|---|---|
| `BackupToolbar` | "Back up now" split button (Full / World only), opens `CreateBackupDialog` (kind, target select, note, lock checkbox). "Import archive" opens the phase-2 uploader then calls import. |
| `BackupTable` | Columns: created (relative + tooltip absolute), kind badge, size, target, hot indicator (icon + tooltip "taken while running"), note (inline edit), lock toggle, state (running shows linked job progress). Row actions: Download, Verify, Restore, Delete (disabled + tooltip when locked). Cursor paging "Load more". Empty state explains policies. |
| `RestoreDialog` | Mode radio (Full / World only), "Start after restore" checkbox (default = was running), warning listing what is replaced and that the current state is kept for 24 h at the path shown afterwards; confirm by typing server name (`ConfirmDialog`). For orphaned backups, a server picker and "allow cross-server" (admin only). |
| `BackupPolicyCard` | Target select, include/exclude glob lists (chips, with defaults shown; a note explains that mcm state is stored outside the server dir and never backed up), retention number inputs (Last/Daily/Weekly/Monthly, blank = off), timezone combobox. Save → calls preview; if `delete` non-empty, `RetentionConfirmDialog` lists backups to be deleted, then PUT with `confirmDeletes=true`. |
| `BackupJobToast` | Progress toast for create/restore/verify/import jobs (shared job toast from phase 0) with stage text. |

State: `features/backups/backups.svelte.ts` (`BackupsState` class: list, optimistic lock/note toggle with rollback on error, merges `jobs` WS updates into `state` of running rows).

## Schedules (`features/schedules/components`)

| Component | Behaviour |
|---|---|
| `ScheduleList` | Cards: name, enabled switch, human cron description, next run (relative, timezone shown), last run outcome badge. Actions: Run now, Edit, History, Delete. |
| `ScheduleEditorSheet` | Fields: name; cron input with presets dropdown (Every hour, Daily at…, Weekly on…) and **live preview** (debounced 300 ms call to `/schedules/preview`: description + next 5 runs, or inline error); timezone combobox (defaults to browser tz); only-when-running; misfire select + grace. `StepsBuilder` below. |
| `StepsBuilder` | Ordered list with drag handles (keyboard reorder via Alt+↑/↓), "Add step" menu with each step type; per-type forms: command (monospace input), announce (message with `{remaining}` hint, countdown chips with presets `5m,1m,30s,10s`, command template advanced), restart/start/stop (wait toggle), backup (kind, target, note), wait (duration input `1h 30m` parsed), condition (online/none, since last run). Each step has an "On error: abort/continue" select. Shows computed total duration. |
| `ScheduleRunsDrawer` | Paged run history; each run expandable to per-step log with durations and messages; running run shows live step and Cancel button. |

Templates: "Daily restart with warnings" (announce 5m/1m/30s/10s → restart) and "Hourly backup if players were online" (condition sinceLastRun → backup world) prefill the editor.

## Worlds (`features/worlds/components`)

| Component | Behaviour |
|---|---|
| `WorldList` | Rows per world group: name, active badge, layout badge (Vanilla / Bukkit split), dimension dirs, size, modified. Actions: Download (zip), Set active (warn restart required if running), Reset, Delete (disabled when active). |
| `WorldUploadDialog` | Phase-2 chunked uploader → name field (prefilled from file name, validated), replace checkbox (appears when exists), activate checkbox; disabled with explanation while server running ("Stop the server to upload a world" + Stop button if `server.power`). |
| `WorldResetDialog` | Backup-first checkbox (checked, unchecking shows destructive warning), seed input (blank = random; "keep current seed" option reads current `level-seed`), stop-if-running and start-after checkboxes; type-the-server-name confirmation. |

## Storage targets (`features/storage/components`)

| Component | Behaviour |
|---|---|
| `StorageTargetTable` | Name, kind, location (path or `s3://bucket/prefix`), backup count; actions Test, Edit, Delete (disabled when in use). |
| `StorageTargetDialog` | Kind tabs Local / S3. S3 fields: endpoint (placeholder "leave empty for AWS"), region, bucket, prefix, access key id, secret (password input; "unchanged" placeholder when `hasSecret`), path-style, allow HTTP (warning). "Test connection" button before save shows latency or the problem detail. Provider hints for MinIO, Cloudflare R2, Backblaze B2. |

## States

Every list: loading skeleton, empty state with primary action, error state with retry and problem `detail`. Destructive actions use `ConfirmDialog`. All job-backed actions show pending state on the triggering button until `202` arrives, then hand off to the job toast.

## Review additions

- Download button hidden unless the user has `backups.read` **and** `console.write`; tooltip: "Backups contain server secrets (RCON password)".
- Restore result panel lists manifest warnings (ignored fields, flavor/version mismatch) from P6-FR-41.
- Server delete dialog (P1) gains a "Also delete N backups" checkbox (`deleteBackups`).
