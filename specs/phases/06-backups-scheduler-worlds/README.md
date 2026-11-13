# Phase 6 — Backups, scheduler, worlds

## Goal

Protect player data and automate routine operations: consistent hot backups to local disk or S3 with retention and one-click restore, cron-scheduled task sequences (restart with countdown, backup, commands, announcements), and world management (list, download, upload, reset, switch active world).

## Scope

| Area | Included |
|---|---|
| `mcm-backup` | `BackupService`, streaming `.tar.zst` writer with in-archive manifest, include/exclude globs, hot-backup consistency protocol (`save-off` / `save-all flush` / `save-on`), sha256, `StorageTarget` trait with `LocalStorage` and `S3Storage` (object_store, multipart), GFS retention, restore with rollback, import of external archives, streamed download |
| `mcm-scheduler` | Cron engine (croner + chrono-tz), per-schedule timezone, step sequences, countdown announcements, conditions on player count, misfire policy, overlap prevention, run-now, run history, next-run preview |
| `mcm-worlds` (new crate: core, fs) | World discovery (vanilla and Bukkit layouts), download as zip (consistent when running), upload zip, reset/regenerate with optional seed, set active world (`level-name`) |
| API/UI | Backups tab, Schedules tab, Worlds tab, admin Storage targets page |

## Non-goals

- Incremental/deduplicated backups (restic/borg-style chunking). Every backup is a full archive of its selection. Revisit after 1.0.
- Backup encryption at rest (client-side). S3 server-side encryption can be configured on the bucket.
- Storage targets other than local and S3-compatible (SFTP, Google Drive, B2 native API — B2/R2/MinIO work through S3 API).
- Per-region/chunk world editing, world pre-generation, MCA trimming.
- Converting worlds between vanilla and Bukkit dimension layouts (Paper/CraftBukkit migrates vanilla layout on first load itself).
- Schedules spanning multiple servers ("restart all"). Each schedule belongs to one server.
- Bedrock worlds.

## User stories

| ID | Story |
|---|---|
| P6-US-01 | As an operator I click "Back up now" while players are online and get a consistent archive without stopping the server. |
| P6-US-02 | As an operator I configure nightly backups to an S3 bucket keeping 7 daily, 4 weekly and 6 monthly copies. |
| P6-US-03 | As an operator I restore yesterday's backup after griefing; if the restore fails the server is left exactly as it was. |
| P6-US-04 | As an operator I lock an important backup ("before 1.21 upgrade") so retention never deletes it. |
| P6-US-05 | As an operator I download a backup to my PC, and import an archive made by another tool. |
| P6-US-06 | As an operator I schedule a daily 04:00 Europe/Berlin restart that warns players at 5 min, 1 min, 30 s and 10 s. |
| P6-US-07 | As an operator I schedule an hourly backup that only runs if players were online. |
| P6-US-08 | As an operator I see the next 5 run times of a cron expression before saving and the history of past runs. |
| P6-US-09 | As an operator I download the world as a zip, upload a world from a map site, and switch `level-name` to it. |
| P6-US-10 | As an operator I reset the world with a new seed, with an automatic backup taken first. |

## Dependencies

| Phase | Needed |
|---|---|
| [0](../00-foundation/README.md) | Jobs, audit, settings table, secrets encryption, problem+json |
| [1](../01-lifecycle-console/README.md) | Core traits `ServerService` (status, start/stop/restart, maintenance flag) and `ServerCommandSink` (`send_command`, `expect_line`) implemented by `mcm-process` |
| [2](../02-settings-files/README.md) | `mcm-fs` `SandboxRoot`, archive extraction limits, streaming zip writer, `uploadId` chunked uploads, properties service (`level-name`, `level-seed`) |
| [5](../05-monitoring/README.md) | `PlayerCountSource` core trait (online count, `player_sessions`) for player conditions; without it the conditions fall back to `list` via stdin (P6-FR-33) |

## Files in this phase

[requirements.md](requirements.md) · [retention.md](retention.md) · [api.md](api.md) · [ui.md](ui.md) · [tests.md](tests.md)

## Exit checklist

- [ ] All `P6-FR-*` implemented and mapped to passing tests in [tests.md](tests.md).
- [ ] Hot backup of a running fake-mc server issues `save-off` → `save-all flush` → `save-on` in that order, and `save-on` is sent even when archiving fails (fault-injection test).
- [ ] Restore rollback proven by fault-injection test (extraction fails mid-way → original directory byte-identical).
- [ ] Retention algorithm proptests pass (locked never deleted; result independent of input order; idempotent).
- [ ] S3 target tested against `object_store::memory` in default CI and MinIO under `CHUNKYARD_TEST_DOCKER=1`.
- [ ] Scheduler logic tests run on `FakeClock` with in-memory fakes of the core traits; tests touching fake-mc use real time with short countdowns. DST transitions covered for `Europe/Berlin` and `America/New_York`.
- [ ] Untrusted-manifest tests pass (crafted `launch`/`javaPath` ignored, oversize manifest rejected).
- [ ] Backup download denied without `console.write`.
- [ ] Every mutating endpoint writes an audit entry (asserted).
- [ ] E2E `p6-backups.spec.ts`, `p6-schedules.spec.ts`, `p6-worlds.spec.ts` green.
- [ ] Docs: backup format, restore semantics, S3 setup, cron syntax help.

## Open questions / to verify

| Topic | Question |
|---|---|
| Save messages | `save-all flush` completion body is `Saved the game` on 1.13+; older versions print `Saved the world`. Forge/NeoForge prefixes per [log-formats.md](../../architecture/log-formats.md#open-questions--to-verify); fixtures captured by `smoke_capture_log_fixtures`; body regex configurable per server. |
| `save-off` semantics | Since 1.20-ish, `save-off` may still flush on chunk unload in some versions; Paper documents it as safe. Verify that region files are not written during archiving on vanilla 1.21 (smoke: compare mtimes). |
| croner DST | Exact croner behaviour for nonexistent (spring-forward) and ambiguous (fall-back) local times; spec requires skip / run-once (P6-FR-24). Verify, wrap if needed. |
| Dimension layout | Whether year-versioned releases (26.x) changed world folder layout (`dimensions/minecraft/the_nether` vs `DIM-1`). Discovery must use `level.dat` presence, not folder names. |
| object_store | Multipart part size defaults and minimum (S3: 5 MiB minimum except last part); confirm `object_store` `put_multipart` buffering memory bound. |
