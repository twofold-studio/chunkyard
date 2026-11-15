# Phase 6 — API, WebSocket, migration

Conventions: [api-conventions.md](../../architecture/api-conventions.md). All paths under `/api/v1`. Job-creating endpoints return `202 { job, ... }` and honour `Idempotency-Key`.

## DTOs

```ts
Backup = { id, serverId: string|null, serverName, serverSlug, targetId, kind: "full"|"world",
           format: "tar.zst"|"tar.gz"|"zip", state: "running"|"complete"|"failed",
           sizeBytes: number|null, sha256: string|null, note: string|null, locked: boolean,
           hot: boolean|null, mcVersion: string|null, createdAt, errorCode: string|null }
StorageTarget = { id, name, kind: "local"|"s3", config: LocalConfig|S3Config, backupCount, createdAt }
LocalConfig = { path }
S3Config = { endpoint: string|null, region, bucket, prefix, accessKeyId, hasSecret: boolean, pathStyle, allowHttp }
BackupPolicy = { targetId, include: string[], exclude: string[], keepLast: number|null, keepDaily: number|null,
                 keepWeekly: number|null, keepMonthly: number|null, timezone }
Schedule = { id, serverId, name, cron, timezone, enabled, onlyWhenRunning, misfire: "skip"|"runOnce",
             misfireGraceS, steps: Step[], nextRunAt: string|null, lastRun: ScheduleRunSummary|null, createdAt }
Step = { type: "command", command, onError } | { type: "announce", message, countdown: number[], commandTemplate, onError }
     | { type: "restart"|"start"|"stop", waitReady, onError } | { type: "backup", kind, targetId?, note?, onError }
     | { type: "wait", seconds, onError } | { type: "condition", players: "online"|"none", sinceLastRun, onError }
ScheduleRun = { id, scheduleId, trigger: "cron"|"manual"|"misfire", scheduledFor: string|null, startedAt, finishedAt,
                outcome, steps: StepLog[] }
World = { name, group: string[], active: boolean, layout: "vanilla"|"bukkit", sizeBytes, modifiedAt }
```

## Backups

| Method | Path | Request | Response | Perm |
|---|---|---|---|---|
| GET | `/servers/{id}/backups` | `?kind&state&targetId&limit&cursor` | `{ items: Backup[], nextCursor }` | `backups.read` |
| POST | `/servers/{id}/backups` | `{ kind, targetId?, note?, locked? }` | `202 { job, backup }` | `backups.manage` |
| GET | `/backups/{backupId}` | — | `Backup` | `backups.read` (of owning server; admin for orphans) |
| PATCH | `/backups/{backupId}` | `{ note?, locked? }` | `Backup` | `backups.manage` |
| DELETE | `/backups/{backupId}` | — | `204` | `backups.manage` |
| GET | `/backups/{backupId}/download` | `Range` optional | `200/206` stream `application/zstd` (or `application/gzip`, `application/zip`) | `backups.read` + `console.write` (orphans: admin) |
| POST | `/backups/{backupId}/verify` | — | `202 { job }` | `backups.read` |
| POST | `/backups/{backupId}/restore` | `{ serverId?, mode: "full"|"world", startAfter?: boolean, allowCrossServer?: boolean }` (`serverId` defaults to the owning server) | `202 { job }` | `backups.manage` + `server.power` on target server |
| POST | `/servers/{id}/backups/import` | `{ uploadId, note? }` | `202 { job, backup }` | `backups.manage` |
| GET | `/admin/backups` | `?orphaned=true&limit&cursor` | `{ items, nextCursor }` | admin |
| GET | `/servers/{id}/backup-policy` | — | `BackupPolicy` | `backups.read` |
| PUT | `/servers/{id}/backup-policy` | `BackupPolicy` + `?confirmDeletes=true` required when the new policy would delete backups | `BackupPolicy` | `backups.manage` |
| POST | `/servers/{id}/backup-policy/preview` | `BackupPolicy` | `{ keep: string[], delete: string[] }` | `backups.manage` |

Job results: `backup.create` → `{ backupId, sizeBytes, sha256, hot, warnings: string[] }`; `backup.restore` → `{ previousPath, rolledBack: boolean }`; `backup.verify` → `{ ok, problems: string[] }`.

## Storage targets (admin)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/storage-targets` | — | `{ items: StorageTarget[] }` |
| POST | `/storage-targets` | `{ name, kind, config, secretAccessKey? }` | `201 StorageTarget` |
| PATCH | `/storage-targets/{id}` | partial; `secretAccessKey` replaces secret when present | `StorageTarget` |
| DELETE | `/storage-targets/{id}` | — | `204` / `409 storage_target.in_use` |
| POST | `/storage-targets/{id}/test` | — | `{ ok: boolean, latencyMs, error?: Problem }` |

## Schedules

| Method | Path | Request | Response | Perm |
|---|---|---|---|---|
| GET | `/servers/{id}/schedules` | — | `{ items: Schedule[] }` | `server.view` |
| POST | `/servers/{id}/schedules` | Schedule fields (no id) | `201 Schedule` | `schedules.manage` (+ `console.write` if command/announce steps) |
| GET | `/schedules/{sid}` | — | `Schedule` | `server.view` |
| PATCH | `/schedules/{sid}` | partial | `Schedule` | as POST |
| DELETE | `/schedules/{sid}` | — | `204` | `schedules.manage` |
| POST | `/schedules/{sid}/run` | — | `202 { run: ScheduleRun }` / `409 schedule.running` | `schedules.manage` |
| GET | `/schedules/{sid}/runs` | `?limit&cursor` | `{ items: ScheduleRun[], nextCursor }` | `server.view` |
| POST | `/schedule-runs/{runId}/cancel` | — | `202` | `schedules.manage` |
| POST | `/schedules/preview` | `{ cron, timezone, count? }` | `{ next: string[], description }` | authenticated |

## Worlds

| Method | Path | Request | Response | Perm |
|---|---|---|---|---|
| GET | `/servers/{id}/worlds` | — | `{ items: World[], levelName }` | `server.view` |
| GET | `/servers/{id}/worlds/{name}/download` | — | stream `application/zip` | `files.read` |
| POST | `/servers/{id}/worlds` | `{ uploadId, name, replace?: boolean, activate?: boolean }` | `202 { job }` | `files.write` |
| POST | `/servers/{id}/worlds/{name}/reset` | `{ backupFirst?: true, seed?: string, stopIfRunning?: false, startAfter?: false }` | `202 { job }` | `files.write` (+ `server.power` if stopping/starting) |
| POST | `/servers/{id}/worlds/{name}/activate` | — | `{ restartRequired }` | `files.write` |
| DELETE | `/servers/{id}/worlds/{name}` | — | `204` / `409 world.active` | `files.write` |

`{name}` is the base world directory name, validated `[A-Za-z0-9_-]{1,64}` (prevents path tricks before reaching the sandbox).

## WebSocket

No new topics. Uses existing:

| Topic | New `data` payloads |
|---|---|
| `jobs` | progress for `backup.create`, `backup.restore`, `backup.verify`, `backup.import`, `world.upload`, `world.reset` (progress 0–1, message e.g. `"archiving 1.2/3.4 GiB"`) |
| `server:<id>` | `{ type: "schedule_run", run: ScheduleRunSummary }` on start/finish; `{ type: "maintenance", active: boolean }` during restore |

## Events (`chunkyard_core::events::Event`)

`BackupStarted{server_id, backup_id}`, `BackupCompleted{…, size_bytes}`, `BackupFailed{…, code}`, `BackupDeleted`, `RestoreCompleted`, `RestoreFailed`, `ScheduleRunStarted`, `ScheduleRunFinished{outcome}`, `WorldReset`. Phase 8 notifications subscribe to these.

## Error codes

| Code | Status | When |
|---|---|---|
| `backup.locked` | 409 | Delete locked backup |
| `backup.not_complete` | 409 | Restore/download/verify of running/failed backup |
| `backup.server_starting` | 409 | Server did not become Running within 120 s |
| `backup.insufficient_space` | 507 | Restore pre-check (free space) |
| `backup.storage_full` | 507 | Local target out of space |
| `backup.cross_server` | 403 | Restore into a different server without `allowCrossServer` / non-admin |
| `backup.invalid_archive` | 422 | Import or restore archive fails validation |
| `backup.policy_confirm_required` | 409 | PUT policy would delete backups without `confirmDeletes` |
| `storage_target.in_use` | 409 | Delete target with backups |
| `upstream.s3` | 502 | S3 errors |
| `cron.invalid` / `cron.too_frequent` | 422 | Validation |
| `schedule.invalid_timezone` | 422 | Unknown IANA name |
| `schedule.running` | 409 | Run-now while a run is active |
| `schedule.limit` | 409 | > 50 schedules |
| `world.active` | 409 | Delete active world |
| `world.exists` | 409 | Upload with existing name without `replace` |
| `world.invalid` | 422 | Archive has no `level.dat` |
| `server.running` | 409 | Upload/reset while running (existing code) |
| `server.maintenance` | 409 | Start attempted during restore/reset ([process-model.md](../../architecture/process-model.md#server-state-machine)) |
| `backup.manifest_invalid` | 422 | Manifest/index over size cap or malformed (P6-FR-41) |

## Migration

File: `crates/chunkyard-db/migrations/<NNNN>_p6_backups_schedules.sql` (number assigned at merge time). Repos: `BackupRepo`, `StorageTargetRepo`, `BackupPolicyRepo`, `ScheduleRepo`, `ScheduleRunRepo` — traits in `chunkyard-core`, impls in `chunkyard-db`. **Overrides** the phase-6 sketch in [data-model.md](../../architecture/data-model.md#phase-6--backups--schedules): `backups.server_id` is nullable with `ON DELETE SET NULL` (P6-FR-22) and several columns are added.

```sql
CREATE TABLE storage_targets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('local','s3')),
  config TEXT NOT NULL,                 -- JSON LocalConfig | S3Config without secret
  secret_enc BLOB, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
  server_name TEXT NOT NULL, server_slug TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES storage_targets(id),
  object_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('full','world')),
  format TEXT NOT NULL DEFAULT 'tar.zst' CHECK (format IN ('tar.zst','tar.gz','zip')),
  state TEXT NOT NULL CHECK (state IN ('running','complete','failed')),
  size_bytes INTEGER, sha256 TEXT, hot INTEGER, mc_version TEXT,
  note TEXT, locked INTEGER NOT NULL DEFAULT 0, error_code TEXT,
  job_id TEXT, created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX backups_server ON backups(server_id, created_at DESC);
CREATE INDEX backups_target ON backups(target_id);
CREATE TABLE backup_policies (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES storage_targets(id),
  include TEXT NOT NULL DEFAULT '["**"]', exclude TEXT NOT NULL,
  keep_last INTEGER, keep_daily INTEGER, keep_weekly INTEGER, keep_monthly INTEGER,
  timezone TEXT NOT NULL DEFAULT 'UTC', updated_at INTEGER NOT NULL
);
CREATE TABLE schedules (
  id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, cron TEXT NOT NULL, timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, only_when_running INTEGER NOT NULL DEFAULT 0,
  misfire TEXT NOT NULL DEFAULT 'skip' CHECK (misfire IN ('skip','run_once')),
  misfire_grace_s INTEGER NOT NULL DEFAULT 300,
  steps TEXT NOT NULL, created_by TEXT,
  next_run_at INTEGER, last_scheduled_for INTEGER,   -- last fire time handled (dedupe on clock jumps)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX schedules_server ON schedules(server_id);
CREATE TABLE schedule_runs (
  id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron','manual','misfire')),
  scheduled_for INTEGER, started_at INTEGER NOT NULL, finished_at INTEGER,
  outcome TEXT, steps TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX schedule_runs_schedule ON schedule_runs(schedule_id, started_at DESC);
ALTER TABLE servers ADD COLUMN save_done_pattern TEXT;   -- body regex only; NULL = log-formats `save_done` (^Saved the game$)
INSERT INTO storage_targets (id, name, kind, config, created_at, updated_at)
  VALUES ('<uuidv7 generated by migration hook>', 'local', 'local', '{"path":"<data>/backups"}', 0, 0);
```

The default `local` target row is inserted by a Rust post-migration hook (`chunkyard-backup::bootstrap::ensure_default_target`) rather than literal SQL, because `<data>` is runtime config; the `INSERT` above illustrates the row only.

## Config additions (`[backup]`)

| Key | Default |
|---|---|
| `compression_level` | 3 |
| `max_concurrent` | 2 |
| `restore_keep_previous_h` | 24 (minimum; restore `previous/` is trash, GC per security.md) |
| `retention_sweep_cron` | `"30 3 * * *"` (UTC) |

## Server delete (extension)

`DELETE /servers/{id}?deleteBackups=true` → `202 { job }` ([server-api.md](../../architecture/server-api.md#delete--delete-serversid)). Without the flag, backup rows survive with `server_id = NULL`. Audit: `server.delete` (details `deleteBackups`), plus one `backup.delete` per removed backup.
