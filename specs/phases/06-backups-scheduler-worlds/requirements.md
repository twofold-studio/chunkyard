# Phase 6 — Requirements

Conventions: [patterns.md](../../architecture/patterns.md). Every mutating FR writes an audit entry (names from the [audit catalog](../../architecture/audit.md)) and emits the listed `Event` on the bus. "Perm" is the permission from [auth.md](../../architecture/auth.md#permission-catalog-per-server).

**Crate edges** ([workspace-layout.md](../../architecture/workspace-layout.md)): `chunkyard-backup` → core, fs; `chunkyard-worlds` → core, fs; `chunkyard-scheduler` → core. None depends on `chunkyard-process`, `chunkyard-metrics` or `chunkyard-db`. Cross-area calls go through `chunkyard-core` traits injected by `chunkyard-server::wiring`:

| Core trait | Used by | Implemented in |
|---|---|---|
| `ServerCommandSink` (`send_command`, `expect_line(LineMatcher, timeout)`) | backup, worlds, scheduler | chunkyard-process (resolves `LineMatcher::{SavingDisabled, SaveDone, ListResponse}` to the flavour-aware matchers of [log-formats.md](../../architecture/log-formats.md)) |
| `ServerService` (status, start/stop/restart, maintenance flag) | backup, worlds, scheduler | chunkyard-process |
| `SavePause` (`pause_saving(server) -> SavePauseGuard`) | worlds (download), backup | chunkyard-backup |
| `BackupService` | scheduler, worlds (backup-first) | chunkyard-backup |
| `PlayerCountSource` | scheduler | chunkyard-metrics (P5) |
| `BackupRepo`, `StorageTargetRepo`, `ScheduleRepo`, `ScheduleRunRepo` | backup, scheduler | chunkyard-db |
| `PropertiesEditor` (`level-name`, `level-seed`) | worlds | chunkyard-fs |

## Backups (`chunkyard-backup`)

| ID | Requirement | Crates | Perm | Audit / Event |
|---|---|---|---|---|
| P6-FR-01 | **Create backup** (job `backup.create`). Params: `kind` (`full`\|`world`), `targetId?` (default: policy target), `note?` (≤ 200 chars), `locked?`. Returns `202 { job, backup }`; backup row created in state `running`. | backup, api | `backups.manage` | `backup.create` / `BackupStarted`, `BackupCompleted`, `BackupFailed` |
| P6-FR-02 | **Selection.** `full` = `servers/<id>/` minus excludes. `world` = all directories of the active world group (P6-FR-35). mcm state lives in `<data>/state/<id>/` (outside the server dir) and is therefore never archived. Excludes = policy `exclude` globs. Default policy excludes: `logs/**`, `crash-reports/**`, `cache/**`, `debug/**`, `**/session.lock`, `*.tmp`. Globs use `globset` on sandbox-relative `/`-separated paths; `include` (default `["**"]`) applied first. `libraries/` and jars are **included** by default so a restore works offline. | backup, fs | — | — |
| P6-FR-03 | **Archive format.** PAX tar compressed with zstd (level `backup.compression_level`, default 3, multithreaded via `zstd` `nb_workers` = min(4, cores/2)). First entry `chunkyard-backup.json` (manifest), last entry `chunkyard-backup-index.json`. Entries stored under their sandbox-relative path (no top-level dir). Symlinks, sockets, devices are **skipped** and listed in index `skipped[]`. File mode bits preserved (masked `0o755`/`0o644`); uid/gid set to 0. | backup | — | — |
| P6-FR-04 | **Manifest** `chunkyard-backup.json`: `{ "format": 1, "backupId", "serverId", "serverName", "serverSlug", "kind", "flavor", "mcVersion", "loaderVersion", "levelName", "createdAt", "mcmVersion", "hot": bool }`. **Index** `chunkyard-backup-index.json`: `{ "files": [{ "path", "size", "mtime" }], "fileCount", "totalBytes", "listSha256", "skipped": [{ "path", "reason" }], "changedDuringBackup": [path] }` where `listSha256` = sha256 of the newline-joined `path\tsize` list (lets restore verify completeness). | backup | — | — |
| P6-FR-05 | **Streaming pipeline, no temp copy.** Walker + `tar::Builder` + `zstd::Encoder` run in `spawn_blocking`, writing into a `SyncIoBridge` → async `HashingWriter` (sha256 + byte count) → `StorageTarget::put_stream`. Peak memory ≤ 64 MiB regardless of server size. Throughput target ≥ 150 MiB/s uncompressed on SSD (non-gating benchmark). | backup | — | — |
| P6-FR-06 | **Hot-backup consistency protocol** when server state is `Running`, via **stdin** through the core `ServerCommandSink` (`send_command` + `expect_line`, which subscribes to the console *before* sending; see [process-model.md](../../architecture/process-model.md#spawner-trait-single-definition)). Sequence: `save-off` → expect `LineMatcher::SavingDisabled` (log-formats `saving_disabled`, also accepting `Saving is already turned off`) 10 s → `save-all flush` → expect `LineMatcher::SaveDone` (log-formats `save_done`: flavour-aware prefix + server-thread source + body anchored `^Saved the game$`; chat/`say` cannot spoof it) 60 s → archive → `save-on` (always). Per-server `save_done_pattern` overrides **only the body regex** (e.g. `^Saved the world$` for pre-1.13); prefix/source checks still apply. Rationale for stdin over RCON: works for every flavour and for servers with `rconDisabled` (P5), needs no ports or passwords; its output is already observed. | backup, core | — | — |
| P6-FR-07 | **`save-on` guard.** `save-on` is sent on every exit path after a successful or attempted `save-off`: success, archive error, storage error, job cancellation, and timeouts. Implemented as an explicit `finally` (`let res = archive.await; handle.send_command("save-on").await; res`) with the archive future made cancellation-safe; a cancelled job awaits the guard before reporting `cancelled`. If the server exits during backup, the guard is skipped silently and archiving continues (files are quiescent). | backup | — | — |
| P6-FR-08 | **Server states** (via `ServerService`). `Stopped`/`Crashed`: archive without protocol (`hot=false`). `Starting`: wait for `Running` up to 120 s then proceed hot, else fail `backup.server_starting`. `Stopping`: wait for `Stopped` up to stop timeout + 20 s. `Installing`: reject `server.busy`. | backup | — | — |
| P6-FR-09 | **Files changing while read.** If a file's size differs from the size captured in the tar header, the writer emits exactly the header size (truncate or zero-pad) and records the path in `changedDuringBackup`; the job succeeds with a warning message. | backup | — | — |
| P6-FR-10 | **Completion.** On success: row `state=complete`, `size_bytes`, `sha256`, `object_key`; retention applied (P6-FR-14). On failure: partial object removed (local `.partial` deleted; S3 multipart aborted), row `state=failed` with `error_code`. | backup | — | `BackupCompleted` / `BackupFailed` |
| P6-FR-11 | **Concurrency.** One mutating job per server (existing jobs rule). Global limit `backup.max_concurrent` (default 2); excess backup jobs stay `queued`. | backup, core | — | — |
| P6-FR-12 | **Storage targets** (admin-only CRUD). `local`: absolute `path`, must not be inside `<data>/servers` or `<data>/tmp`; created on first start as target `local` → `<data>/backups`. `s3`: `endpoint?`, `region`, `bucket`, `prefix`, `accessKeyId`, `secretAccessKey` (encrypted, write-only), `pathStyle`, `allowHttp` (default false). Object key: `<prefix>/<serverId>/<backupId>.tar.zst`. Uploads use `object_store` multipart with 16 MiB parts. `POST …/test` writes, reads, deletes a 1 KiB probe object. Deleting a target that has backups → `409 storage_target.in_use`. | backup, api | admin | `storage_target.create`, `storage_target.update`, `storage_target.delete` (`test` is not audited) |
| P6-FR-13 | **Backup policy** per server (`GET/PUT /servers/{id}/backup-policy`): `targetId`, `include[]`, `exclude[]`, `keepLast`, `keepDaily`, `keepWeekly`, `keepMonthly` (all optional ints 0–1000; all null = keep everything), `timezone` (IANA, for day/week buckets; default system tz). Default policy created with the server (or lazily): local target, defaults above, `keepLast=10`. | backup | `backups.manage` | `backup.policy.update` |
| P6-FR-14 | **Retention** per [retention.md](retention.md), applied per (server, target) after each successful backup, after policy changes (preview first, see P6-FR-15), and in a daily sweep. Locked, `running` and `failed` backups never count or get deleted by retention (failed rows are purged after 7 days). | backup | — | `backup.retention.delete` (actor = system) |
| P6-FR-15 | **Retention preview**: `POST /servers/{id}/backup-policy/preview` with a candidate policy returns `{ keep: [id], delete: [id] }` without changes. UI requires confirmation when `delete` is non-empty. | backup | `backups.manage` | — |
| P6-FR-16 | **List/get/update.** List with filters `kind`, `state`, `targetId`, cursor paging, newest first. `PATCH` edits `note` and `locked`. | backup | `backups.read` / `backups.manage` (PATCH) | `backup.update` |
| P6-FR-17 | **Download** `GET /backups/{id}/download` — requires `backups.read` **and** `console.write` on the server (archives contain `rcon.password`, `management-server-secret` and other secrets; [security.md](../../architecture/security.md#secret-properties)); orphaned backups: admin only: streamed through mcm for both target kinds (no presigned URLs: keeps auth, audit and private buckets simple; presigned may be added later). Supports `Range` (local: file seek; S3: `get_range`). `Content-Disposition: attachment; filename="<slug>-<yyyyMMdd-HHmmss>-<kind>.tar.zst"`. | backup, api | `backups.read` + `console.write` | `backup.download` |
| P6-FR-18 | **Delete** backup: removes object then row. Locked → `409 backup.locked`. Missing object → row deleted, warning logged. | backup | `backups.manage` | `backup.delete` / `BackupDeleted` |
| P6-FR-19 | **Verify** (job `backup.verify`): stream object, check sha256, decompress, parse manifest + index, check every listed file present with listed size and `listSha256`. Result stored in job result. | backup | `backups.read` | `backup.verify` |
| P6-FR-20 | **Restore** (job `backup.restore`), see [§ Restore procedure](#restore-procedure). Options: `mode` (`full`\|`world`; `world` allowed for full backups too), `startAfter` (default: start only if it was running), `allowCrossServer` (admin only; manifest `serverId` ≠ target server). Requires server to be stoppable; mcm stops it with the normal stop sequence. | backup, fs, core | `backups.manage` + `server.power` | `backup.restore` / `RestoreCompleted`, `RestoreFailed` |
| P6-FR-21 | **Import** external archive (job `backup.import`) from a phase-2 `uploadId`. Accepted: `.tar.zst`, `.tar.gz`, `.zip` (detected by magic bytes). Validation pass lists all entries through `RelPath` rules and archive limits; archives with a single top-level directory containing `server.properties` or `level.dat` are flagged `stripPrefix`. Stored as-is with `format` column; no manifest → `kind=full`, `note="imported"`. | backup, fs | `backups.manage` | `backup.import` |
| P6-FR-22 | **Server deletion** (`DELETE /servers/{id}`, async `202 { job }` per [server-api.md](../../architecture/server-api.md#delete--delete-serversid)) keeps backup rows (`server_id` set NULL, `server_name`/`server_slug` snapshot retained) unless the request has `deleteBackups=true`, in which case the server-delete job deletes the backup objects and rows first (failures abort the delete before any server files are removed). Orphaned backups are listed under admin `/admin/backups` and can be restored into another server via `allowCrossServer`. | backup, api | admin for orphans | `backup.delete` |

| P6-FR-41 | **Manifests are untrusted.** On restore, verify and import, `chunkyard-backup.json` / `chunkyard-backup-index.json` are parsed with size caps (1 MiB / 64 MiB), unknown fields ignored, every path via `RelPath`. Manifest fields are **informational only**: they never set `LaunchSpec` (a `Custom` launch or any launch/java field present is ignored and logged), never set Java paths, never set server columns. Flavor/version mismatches vs. the target server produce warnings, not changes. Archive entries named `.mcm/…` (from pre-1.0 archives) are skipped. | backup, fs | — | — |

### Restore procedure

1. Pre-checks: backup `complete`; manifest validated per P6-FR-41; free space on `<data>` ≥ `totalBytes × 1.05` (index, or archive size × 4 when unknown) plus the extraction margin from [security.md](../../architecture/security.md#sandboxroot-path-safety--chunkyard-fs), else `507 backup.insufficient_space`.
2. Stop server (if running) and wait `Stopped`. Set the `maintenance` flag (`ServerService`) so auto-restart/schedules/wake-on-join cannot start it.
3. Extract into staging `<data>/tmp/restore-<id>-<ts>/new/` with the `chunkyard-fs` extractor (sandbox + limits; strip prefix for imported archives). Skip `chunkyard-backup*.json` and `.mcm/` entries.
4. Verify staged tree against the index (if present): count, sizes, `listSha256`.
5. Swap (all `rename`s on one filesystem):
   - `full`: `servers/<id>` → `state/<id>/trash/restore-<ts>/previous`; `new` → `servers/<id>`. (mcm state in `state/<id>/` is untouched.)
   - `world`: for each dir of the world group: existing dir → `state/<id>/trash/restore-<ts>/previous/<dir>`; `new/<dir>` → `servers/<id>/<dir>`.
6. Failure in 3–4: delete staging, server untouched. Failure in 5: reverse completed renames in reverse order, then fail. Rollback outcome recorded in the job result.
7. Clear maintenance; start if requested. `previous/` is ordinary trash: kept ≥ `max(24 h, backup.restore_keep_previous_h)`, then removed by the trash GC (free-disk based, ≤ 7 days) per [security.md](../../architecture/security.md#sandboxroot-path-safety--chunkyard-fs). Path shown in the job result; trash is not visible in the file manager.

## Scheduler (`chunkyard-scheduler`)

| ID | Requirement | Crates | Perm | Audit / Event |
|---|---|---|---|---|
| P6-FR-23 | **Schedule CRUD**: `name`, `cron`, `timezone` (IANA via chrono-tz), `enabled`, `onlyWhenRunning`, `misfire` (`skip`\|`runOnce`, default `skip`), `misfireGraceS` (default 300), `steps[]` (1–20). Max 50 schedules per server. List/get need `server.view`. | scheduler, api | `schedules.manage` | `schedule.create`, `schedule.update`, `schedule.delete` |
| P6-FR-24 | **Cron syntax**: 5 fields (`min hour dom mon dow`) or 6 fields (leading seconds); names (`MON`, `JAN`), ranges, steps, lists, `L`/`#` as supported by croner; aliases `@hourly @daily @weekly @monthly @yearly`. DOM/DOW combine with **OR** (Vixie semantics). Minimum spacing between consecutive fires 30 s (rejected `cron.too_frequent`). DST: a nonexistent local time (spring forward) is skipped; an ambiguous time (fall back) fires once, at the first occurrence. | scheduler | — | — |
| P6-FR-25 | **Engine**: single actor task holding a min-heap of `(next_fire_utc, schedule_id)`; sleeps via injected `Clock::sleep_until`; receives `Reload(schedule_id)` / `Remove` messages on CRUD. `next_run_at` persisted after each computation. Each run executes in its own tracked task with a child `CancellationToken`. | scheduler, core | — | — |
| P6-FR-26 | **Misfire**: on startup and when the clock jumps forward by > 60 s (suspend/resume), for each schedule with `next_run_at < now`: `runOnce` and `now − next_run_at ≤ misfireGraceS` → one run (never more than one); otherwise record a run with outcome `missed`. Then recompute from `now`. | scheduler | — | `ScheduleRunFinished` |
| P6-FR-27 | **No overlap**: if a run of the same schedule is active at fire time, record outcome `skipped_overlap`. `onlyWhenRunning` and server not `Running` → outcome `skipped_not_running`. | scheduler | — | — |
| P6-FR-28 | **Steps** (JSON, `type`-tagged); each has `onError: "abort"\|"continue"` (default `abort`). See table below. | scheduler, core (`ServerService`, `ServerCommandSink`, `BackupService`) | — | per step |
| P6-FR-29 | **Run now** `POST /schedules/{id}/run` (ignores cron and `enabled`, respects overlap). **Cancel** `POST /schedule-runs/{runId}/cancel`: aborts at the current step (waits/countdowns interrupt immediately; a running backup job is cancelled via its token). | scheduler | `schedules.manage` | `schedule.run`, `schedule.run.cancel` |
| P6-FR-30 | **History**: `schedule_runs` row per run with `trigger` (`cron`\|`manual`\|`misfire`), `outcome` (`success`\|`failed`\|`cancelled`\|`missed`\|`skipped_overlap`\|`skipped_not_running`\|`skipped_condition`), and `steps` JSON log `[{ index, type, startedAt, finishedAt, outcome, message }]`. Retention: 30 days, but always the last 50 per schedule. | scheduler, core (`ScheduleRunRepo`) | `server.view` | — |
| P6-FR-31 | **Preview**: `POST /schedules/preview { cron, timezone, count≤20 }` → `{ next: [RFC3339 with offset], description }` (human description e.g. "At 04:00, every day"). Same validator as CRUD. | scheduler | `server.view` | — |
| P6-FR-32 | **Lifecycle interplay**: deleting a server cancels its active runs and removes schedules; a server in restore `maintenance` causes runs to record `skipped_not_running`. | scheduler | — | — |
| P6-FR-33 | **Player count source**: core `PlayerCountSource` (P5 collector: management protocol / RCON / SLP) if fresher than 30 s; otherwise `ServerCommandSink` sends `list` via stdin and awaits `LineMatcher::ListResponse` (prefix-anchored, parsed by `chunkyard-protocol::text::list`) within 5 s; failure → condition `unknown` → step fails. `sinceLastRun` reads `player_sessions` through `PlayerCountSource::sessions_since`. | scheduler, core | — | — |

### Step types

| `type` | Fields | Behaviour |
|---|---|---|
| `command` | `command` (≤ 1024 bytes, same validation as console input) | Requires `Running`, else step fails `server.not_running`. |
| `announce` | `message` (with `{remaining}` placeholder), `countdown` (seconds, descending, ≤ 10 entries, max 3600), `commandTemplate` (default `say {message}`) | Sends at `T−c` for each `c`, where T = step start + `countdown[0]`; `{remaining}` rendered as `5m`, `1m`, `30s`. Step ends at T. Empty countdown = send once. |
| `restart` / `start` / `stop` | `waitReady` (default true) | Uses `ServerHandle`; waits for `Running`/`Stopped` up to the server's start/stop timeouts. |
| `backup` | `kind`, `targetId?`, `note?` | Creates a backup job and awaits it. |
| `wait` | `seconds` (1–86400) | Cancellable sleep. |
| `condition` | `players`: `"online"`\|`"none"`, `sinceLastRun` (bool: "anyone online since last successful run", from `player_sessions`) | False → remaining steps skipped, run outcome `skipped_condition` (not a failure). |

## Worlds (`chunkyard-worlds`)

| ID | Requirement | Crates | Perm | Audit / Event |
|---|---|---|---|---|
| P6-FR-34 | **Discovery**: a world is a top-level directory containing `level.dat`. Group = base world + Bukkit-style siblings `<base>_nether` and `<base>_the_end` when they exist and contain `level.dat` or `DIM-1`/`DIM1`. `active` = `level-name` from `server.properties` (default `world`). Reports size (cached 5 min), `layout` (`vanilla`\|`bukkit`), last modified. | worlds, fs, core (`PropertiesEditor`) | `server.view` | — |
| P6-FR-35 | **Active world group** used by `kind=world` backups and world restore = the group of the active world (`WorldService::active_group`, a core trait used by chunkyard-backup). | worlds, backup, core | — | — |
| P6-FR-36 | **Download world** as zip (streamed, phase-2 zip writer) of the whole group, each dir at zip root. If running, the stream is wrapped in a `SavePause` guard (P6-FR-06/07 semantics, provided by chunkyard-backup via core). | worlds, fs, core | `files.read` | `world.download` |
| P6-FR-37 | **Upload world** (job `world.upload`) from `uploadId` (zip/tar.*): server must be `Stopped` (`409 server.running`). Valid if `level.dat` at archive root or under exactly one top-level dir (stripped). Target name `name` (`[A-Za-z0-9_-]{1,64}`), must not exist unless `replace=true`, which moves the old dir to trash (`<data>/state/<id>/trash/`, P2 trash rules). Optional `activate`. | worlds, fs | `files.write` | `world.upload` |
| P6-FR-38 | **Reset world** (job `world.reset`): server must be stopped, or `stopIfRunning=true` (also needs `server.power`). `backupFirst` default **true** (world backup, awaited; failure aborts reset). Moves the group dirs to trash (`state/<id>/trash/`), sets `level-seed` via `PropertiesEditor` if `seed` provided (empty string = random), optionally starts. Backup-first and stop/start via core `BackupService` / `ServerService`. | worlds, fs, core | `files.write` | `world.reset` / `WorldReset` |
| P6-FR-39 | **Set active world**: writes `level-name` via `PropertiesEditor`; if running, response `restartRequired=true`. | worlds, core | `files.write` | `world.activate` |
| P6-FR-40 | **Delete world** (non-active only, `409 world.active` otherwise): moves group to `state/<id>/trash/`. | worlds, fs | `files.write` | `world.delete` |

## Edge cases and failure modes

| Case | Behaviour |
|---|---|
| `save-all flush` never prints done line (modded, custom log format, pre-1.13 `Saved the world`) | Timeout 60 s → backup continues as **not hot** with warning; `save-on` still sent. Per-server `save_done_pattern` (body regex only). |
| Chat/`say` line `Saved the game` during backup | Rejected by the anchored `save_done` matcher (`[Server]`/`<name>` bodies never match) |
| Crafted archive manifest with `launch`/`javaPath` fields | Ignored (P6-FR-41); warning in job result |
| Another user sends `save-on` mid-backup | Undetectable; documented. Index records `changedDuringBackup` if files change. |
| Disk full on local target | Write fails → `backup.storage_full`, partial removed, `save-on` sent. |
| S3 credentials wrong / bucket missing | `upstream.s3` with sanitized message; target `test` reproduces it. |
| Backup of 50 GiB server | Streaming; memory bound holds; progress = bytes read / estimated total (from a pre-walk sum of sizes). |
| mcm restarts mid-backup | Job → `failed interrupted` at startup; backup row → `failed`; `.partial` cleaned; S3 multipart left for bucket lifecycle (documented: configure `AbortIncompleteMultipartUpload`). If server still running with saving off — not possible natively (server died with mcm). |
| mcm restarts mid-restore | Startup scans `tmp/restore-*` and `state/*/trash/restore-*`: if `servers/<id>` is missing and a `previous/` exists → move it back, log `warn`; job failed `interrupted`; maintenance flag cleared. |
| Schedule timezone removed from tzdb | Validation at load; schedule disabled with `schedule.invalid_timezone` event. |
| System clock set backwards | Engine recomputes heap when clock moves backwards > 60 s; no duplicate fire for an already-recorded `scheduled_for`. |
| Upload world zip with `../` entries / symlinks | Rejected by `chunkyard-fs` extraction (`fs.invalid_path`). |
| Reset while a backup is running | `server.busy`. |

## Security considerations

- Backups contain everything (RCON/management secrets, plugin DB passwords): download requires `backups.read` **and** `console.write`; downloads audited.
- Manifests and archive contents are untrusted input (P6-FR-41, [security.md](../../architecture/security.md#untrusted-server-directory)); restored trees land only in `servers/<id>/`, never in `state/<id>/` outside the trash staging.
- Restore and import use the same hardened extractor as the file manager (zip-slip, symlinks, bombs) — see [security.md](../../architecture/security.md#sandboxroot-path-safety--chunkyard-fs).
- S3 secret is write-only in the API (never returned; `hasSecret: true`), encrypted with the master key; endpoint URL validated (https unless `allowHttp`; SSRF rule T12 applies to `endpoint`).
- Local target paths are admin-only and validated against data dir internals to avoid overwriting live servers.
- Schedule `command` steps run as the creating user's authority at creation time; editing a schedule requires `schedules.manage` and `console.write` if it contains `command`/`announce` steps (prevents escalation via schedules).
