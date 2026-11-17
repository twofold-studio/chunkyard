# Phase 6 — Test plan

Layout per [patterns.md §10](../../architecture/patterns.md#10-test-layout-rust). Kinds: U unit, P property, I crate integration, A API integration (`TestApp` + fake-mc), C component, E E2E, F fuzz. Fake server commands used: `save-off`, `save-on`, `save-all flush`, `list`, `say`, `fakejoin`, `fakechat` ([fake-server.md](../../testing/fake-server.md)).

**Time:** `FakeClock`/paused time only for pure-logic tests that use in-memory fakes of the core traits (`FakeServerService`, `RecordingCommandSink`, `FakeBackupService`, `FakePlayerCountSource` from `chunkyard-testkit`). Every test that runs `fake-mc-server` uses real time with shortened timeouts injected via `test-hooks` (e.g. `save_done_timeout_s = 1`, `starting_wait_s = 2`).

## chunkyard-backup

| Test | Location | FR | Kind |
|---|---|---|---|
| `selection_full_excludes_defaults` | `src/selection.rs` | 02 | U |
| `selection_never_reads_state_dir` (state dir populated, not in archive) | `tests/archive.rs` | 02 | I |
| `selection_world_kind_uses_active_group` | `src/selection.rs` | 02, 35 | U |
| `selection_globs_match_relative_slash_paths` | `src/selection.rs` | 02 | P |
| `archive_first_entry_is_manifest_last_is_index` | `tests/archive.rs` | 03, 04 | I |
| `archive_skips_symlinks_and_lists_them` | `tests/archive.rs` | 03 | I |
| `archive_index_list_sha256_matches_contents` | `tests/archive.rs` | 04 | I |
| `archive_file_grows_during_read_truncated_and_recorded` | `tests/archive.rs` | 09 | I |
| `archive_file_shrinks_during_read_zero_padded_and_recorded` | `tests/archive.rs` | 09 | I |
| `pipeline_memory_bounded_for_large_tree` (2 GiB sparse files, assert peak RSS delta < 96 MiB) | `tests/pipeline.rs` | 05 | I |
| `pipeline_sha256_matches_stored_object` | `tests/pipeline.rs` | 05, 10 | I |
| `hot_backup_sends_save_off_flush_on_in_order` | `tests/hot.rs` (`RecordingCommandSink`) | 06 | I |
| `hot_backup_with_fake_mc_paper_and_vanilla_formats` (real `ServerCommandSink` from chunkyard-process, fake-mc `flavor=paper`/`vanilla`, real time) | `p6_hot_backup.rs` (chunkyard-api-tests) | 06 | A |
| `hot_backup_ignores_chat_saved_the_game_spoof` (`fakechat Mallory Saved the game` + `say Saved the game` before the real line; archive must start only after the real line) | `p6_hot_backup.rs` (chunkyard-api-tests) | 06, Sec | A |
| `save_done_custom_body_pattern_keeps_prefix_check` | `p6_hot_backup.rs` (chunkyard-api-tests) | 06 | A |
| `hot_backup_waits_for_saved_line_before_archiving` | `tests/hot.rs` | 06 | I |
| `hot_backup_save_on_sent_when_archive_fails` (fault-injecting `StorageTarget`) | `tests/hot.rs` | 07 | I |
| `hot_backup_save_on_sent_when_job_cancelled` | `tests/hot.rs` | 07 | I |
| `hot_backup_flush_timeout_proceeds_not_hot_with_warning` (`RecordingCommandSink` never answers; FakeClock) | `tests/hot.rs` | 06 | I |
| `hot_backup_server_exits_midway_completes_without_save_on` | `tests/hot.rs` | 07 | I |
| `backup_starting_server_waits_then_fails_after_timeout` (`FakeServerService` stuck in Starting; FakeClock) | `tests/hot.rs` | 08 | I |
| `backup_stopped_server_no_commands_sent` | `tests/hot.rs` | 08 | I |
| `backup_global_concurrency_limit_queues_excess_jobs` (max_concurrent=2, three servers) | `tests/concurrency.rs` | 11 | I |
| `backup_rejected_while_installing_server_busy` | `tests/concurrency.rs` | 08, 11 | I |
| `backup_failure_removes_partial_local_object` | `tests/local_storage.rs` | 10 | I |
| `local_storage_put_is_atomic_rename` | `tests/local_storage.rs` | 12 | I |
| `s3_storage_multipart_roundtrip_memory_store` | `tests/s3_storage.rs` (`object_store::memory`) | 12 | I |
| `s3_storage_failure_aborts_multipart` | `tests/s3_storage.rs` | 10, 12 | I |
| `s3_storage_minio_roundtrip` (gated `CHUNKYARD_TEST_DOCKER=1`) | `tests/s3_minio.rs` | 12 | I |
| `s3_storage_get_range_returns_slice` | `tests/s3_storage.rs` | 17 | I |
| `retention_*` (6 properties in [retention.md](retention.md)) | `src/retention.rs` | 14 | P |
| `retention_examples_from_spec` (table-driven, all examples) | `src/retention.rs` | 14 | U |
| `retention_skips_running_and_failed` | `tests/retention_apply.rs` | 14 | I |
| `retention_bucket_uses_policy_timezone` | `src/retention.rs` | 14 | U |
| `verify_detects_corrupted_byte` | `tests/verify.rs` | 19 | I |
| `verify_detects_missing_file_in_index` | `tests/verify.rs` | 19 | I |
| `restore_full_replaces_tree_previous_to_state_trash` | `tests/restore.rs` | 20 | I |
| `restore_world_mode_replaces_only_world_group` | `tests/restore.rs` | 20 | I |
| `restore_extract_failure_leaves_server_untouched` (dir hash before/after) | `tests/restore.rs` | 20 | I |
| `restore_swap_failure_rolls_back_renames` (fault-injecting fs hook) | `tests/restore.rs` | 20 | I |
| `restore_insufficient_space_rejected` (fake free-space provider) | `tests/restore.rs` | 20 | I |
| `restore_interrupted_recovered_on_startup` | `tests/restore.rs` | 20 | I |
| `restore_previous_trash_kept_24h_then_gc_by_free_disk` (FakeClock, fake free-space provider) | `tests/restore.rs` | 20 | I |
| `import_zip_with_single_top_dir_strips_prefix` | `tests/import.rs` | 21 | I |
| `import_rejects_traversal_and_symlink_entries` | `tests/import.rs` | 21 | I |
| `import_detects_format_by_magic_not_extension` | `tests/import.rs` | 21 | I |
| `manifest_with_custom_launch_and_java_path_ignored` | `tests/manifest.rs` | 41, Sec | I |
| `manifest_over_size_cap_rejected` | `tests/manifest.rs` | 41 | I |
| `manifest_relpath_escape_rejected` | `tests/manifest.rs` | 41, Sec | I |
| `restore_skips_legacy_mcm_dir_entries` | `tests/restore.rs` | 20, 41 | I |
| `prop_manifest_parse_never_panics` | `src/manifest.rs` | 41 | P |

## chunkyard-worlds

| Test | Location | FR | Kind |
|---|---|---|---|
| `worlds_discover_vanilla_layout` | `src/discover.rs` | 34 | U |
| `worlds_discover_bukkit_split_layout_groups_siblings` | `src/discover.rs` | 34 | U |
| `worlds_active_from_level_name_default_world` | `src/discover.rs` | 34, 35 | U |
| `world_upload_requires_level_dat` | `tests/worlds.rs` | 37 | I |
| `world_upload_replace_moves_old_to_state_trash` | `tests/worlds.rs` | 37 | I |
| `world_reset_backup_first_failure_aborts_reset` (`FakeBackupService`) | `tests/worlds.rs` | 38 | I |
| `world_reset_sets_seed_and_moves_group_to_trash` | `tests/worlds.rs` | 38 | I |
| `world_delete_moves_group_to_state_trash` | `tests/worlds.rs` | 40 | I |
| `world_download_running_holds_save_pause_guard` (`FakeSavePause` records acquire/release) | `tests/worlds.rs` | 36 | I |

## chunkyard-scheduler

Engine/steps tests use `FakeClock` + `tokio::time::pause()` with in-memory fakes (`RecordingCommandSink`, `FakeServerService`, `FakeBackupService`, `FakePlayerCountSource`) — no real processes. Fake-mc coverage of steps is in `api-tests/p6_schedules.rs` with real time.

| Test | Location | FR | Kind |
|---|---|---|---|
| `cron_parse_five_and_six_fields` | `src/cron.rs` | 24 | U |
| `cron_aliases_supported` | `src/cron.rs` | 24 | U |
| `cron_dom_dow_or_semantics` | `src/cron.rs` | 24 | U |
| `cron_too_frequent_rejected` | `src/cron.rs` | 24 | U |
| `cron_dst_spring_forward_skips_nonexistent_berlin` | `src/cron.rs` | 24 | U |
| `cron_dst_fall_back_fires_once_new_york` | `src/cron.rs` | 24 | U |
| `cron_next_never_panics_and_monotonic` | `src/cron.rs` | 24, 31 | P |
| `engine_fires_at_next_run_and_persists_next` | `tests/engine.rs` | 25 | I |
| `engine_reload_on_update_reschedules` | `tests/engine.rs` | 25 | I |
| `engine_disabled_schedule_never_fires` | `tests/engine.rs` | 23, 25 | I |
| `misfire_skip_records_missed` | `tests/misfire.rs` | 26 | I |
| `misfire_run_once_within_grace_runs_exactly_once` (3 missed fires) | `tests/misfire.rs` | 26 | I |
| `misfire_run_once_outside_grace_records_missed` | `tests/misfire.rs` | 26 | I |
| `clock_jump_forward_triggers_misfire_handling` | `tests/misfire.rs` | 26 | I |
| `clock_backwards_no_duplicate_fire` | `tests/misfire.rs` | 26 | I |
| `overlap_records_skipped_overlap` | `tests/runs.rs` | 27 | I |
| `only_when_running_skips_when_stopped` | `tests/runs.rs` | 27 | I |
| `step_command_requires_running` | `tests/steps.rs` | 28 | I |
| `step_announce_sends_at_countdown_offsets` (assert `RecordingCommandSink` FakeClock timestamps 0/240/270/290 s) | `tests/steps.rs` | 28 | I |
| `step_announce_renders_remaining_placeholder` | `src/steps/announce.rs` | 28 | U |
| `step_restart_waits_ready` | `tests/steps.rs` | 28 | I |
| `step_backup_awaits_job_and_fails_run_on_failure` | `tests/steps.rs` | 28 | I |
| `step_on_error_continue_runs_remaining` | `tests/steps.rs` | 28 | I |
| `step_condition_players_none_skips_rest` | `tests/steps.rs` | 28, 33 | I |
| `step_condition_since_last_run_uses_player_sessions` | `tests/steps.rs` | 28, 33 | I |
| `player_count_fallback_parses_list_output` (`RecordingCommandSink` answers `ListResponse`) | `tests/steps.rs` | 33 | I |
| `player_count_prefers_player_count_source_when_fresh` | `tests/steps.rs` | 33 | I |
| `run_now_ignores_cron_respects_overlap` | `tests/runs.rs` | 29 | I |
| `cancel_interrupts_wait_immediately` | `tests/runs.rs` | 29 | I |
| `cancel_cancels_backup_job_and_save_on_sent` | `tests/runs.rs` | 29, 07 | I |
| `history_retention_keeps_last_50` | `tests/runs.rs` | 30 | I |
| `server_delete_cancels_runs_and_removes_schedules` | `tests/runs.rs` | 32 | I |

## chunkyard-api-tests (`crates/api-tests/tests/p6_*.rs`)

| Test | File | FR | Kind |
|---|---|---|---|
| `backups_create_returns_202_and_job_completes` | `backups.rs` | 01, 10 | A |
| `backups_create_requires_backups_manage` / `backups_list_requires_backups_read` | `backups.rs` | 01, 16 | A |
| `backups_delete_locked_409` | `backups.rs` | 18 | A |
| `backups_patch_lock_and_note_audited` | `backups.rs` | 16 | A |
| `backups_download_streams_and_supports_range` | `backups.rs` | 17 | A |
| `backups_download_requires_console_write` (403 with only `backups.read`) | `backups.rs` | 17, Sec | A |
| `backups_download_orphan_admin_only` | `backups.rs` | 17, 22 | A |
| `backups_download_audited` | `backups.rs` | 17 | A |
| `backups_restore_cross_server_forbidden_for_non_admin` | `backups.rs` | 20 | A |
| `backups_restore_end_to_end_with_fake_mc` (start, create world data, backup, mutate, restore, assert content and running) | `backups.rs` | 20 | A |
| `backups_import_from_upload_id` | `backups.rs` | 21 | A |
| `server_delete_keeps_backups_orphaned` / `server_delete_with_delete_backups_removes_objects` (both `202 {job}`) | `backups.rs` | 22 | A |
| `restore_crafted_manifest_warns_and_keeps_launch` | `backups.rs` | 41, Sec | A |
| `start_during_restore_maintenance_409` | `backups.rs` | 20 | A |
| `policy_put_requires_confirm_when_deleting` | `backup_policy.rs` | 13, 15 | A |
| `policy_preview_matches_put_effect` | `backup_policy.rs` | 15 | A |
| `storage_targets_admin_only` | `storage_targets.rs` | 12 | A |
| `storage_targets_secret_never_returned` | `storage_targets.rs` | 12 | A |
| `storage_targets_local_path_inside_servers_rejected` | `storage_targets.rs` | 12 | A |
| `storage_targets_delete_in_use_409` | `storage_targets.rs` | 12 | A |
| `storage_targets_s3_endpoint_private_ip_rejected` | `storage_targets.rs` | 12 | A |
| `schedules_crud_validation_errors` (shared vectors `testdata/validation/schedule.json`) | `schedules.rs` | 23, 24 | A |
| `schedules_command_step_requires_console_write` | `schedules.rs` | 23 | A |
| `schedules_preview_returns_next_runs_with_offset` | `schedules.rs` | 31 | A |
| `schedules_run_now_emits_ws_schedule_run` | `schedules.rs` | 29 | A |
| `schedule_announce_countdown_reaches_fake_mc` (countdown `[2,1]` s, real time) | `schedules.rs` | 28 | A |
| `schedules_mutations_audited` (catalog names) | `schedules.rs` | 23, 29 | A |
| `worlds_list_and_download_zip` | `worlds.rs` | 34, 36 | A |
| `worlds_download_running_uses_save_protocol` | `worlds.rs` | 36 | A |
| `worlds_upload_while_running_409` | `worlds.rs` | 37 | A |
| `worlds_reset_requires_power_when_stop_if_running` | `worlds.rs` | 38 | A |
| `worlds_activate_sets_level_name_restart_required` | `worlds.rs` | 39 | A |
| `worlds_delete_active_409` | `worlds.rs` | 40 | A |
| `worlds_name_with_dotdot_rejected_422` | `worlds.rs` | 34 | A |
| `no_secrets_in_logs_s3_secret` | `storage_targets.rs` | 12 | A |

## Fuzz

| Target | FR |
|---|---|
| `backup_import_extract` (reuses `zip_extract`/`tar_extract` harness with gz/zst wrappers) | 21 |

## Frontend (Vitest)

| Test | File | FR | Kind |
|---|---|---|---|
| `BackupTable › disables delete when locked` | `features/backups/components/BackupTable.test.ts` | 18 | C |
| `BackupTable › running row shows job progress from ws` | same | 01 | C |
| `RestoreDialog › requires typing server name` | `RestoreDialog.test.ts` | 20 | C |
| `BackupPolicyCard › shows retention confirm when preview deletes` | `BackupPolicyCard.test.ts` | 13, 15 | C |
| `backups.svelte › lock toggle rolls back on error` | `backups.svelte.test.ts` | 16 | U |
| `ScheduleEditorSheet › live preview shows next runs and errors` | `features/schedules/components/ScheduleEditorSheet.test.ts` | 31 | C |
| `StepsBuilder › reorders with keyboard` | `StepsBuilder.test.ts` | 28 | C |
| `StepsBuilder › announce countdown presets serialise to seconds` | same | 28 | C |
| `parseDuration › "1h 30m" → 5400` | `features/schedules/duration.test.ts` | 28 | U |
| `WorldUploadDialog › disabled while running` | `features/worlds/components/WorldUploadDialog.test.ts` | 37 | C |
| `WorldResetDialog › unchecking backup shows warning` | `WorldResetDialog.test.ts` | 38 | C |
| `StorageTargetDialog › secret placeholder when hasSecret` | `features/storage/components/StorageTargetDialog.test.ts` | 12 | C |
| `BackupTable › download hidden without console.write` | `BackupTable.test.ts` | 17 | C |

## E2E (Playwright, fake-mc)

| Spec › test | US / FR |
|---|---|
| `p6-backups.spec.ts › backup running server, lock, download` | US-01, 04, 05 / 01, 06, 16, 17 |
| `p6-backups.spec.ts › download hidden without console.write` | US-05 / 17 |
| `p6-backups.spec.ts › restore after deleting a file brings it back` | US-03 / 20 |
| `p6-backups.spec.ts › configure retention and see old backups pruned` | US-02 / 13–15 |
| `p6-schedules.spec.ts › create daily restart from template, run now, see countdown in console and history` (countdown shortened to 3/1 s) | US-06, 08 / 23, 28–31 |
| `p6-schedules.spec.ts › conditional backup skipped when no players` | US-07 / 28, 33 |
| `p6-worlds.spec.ts › upload world zip, activate, reset with new seed` | US-09, 10 / 37–39 |
| `p6-admin.spec.ts › add S3 target (mock), test connection error shows detail` | US-02 / 12 |

## Smoke (real server, nightly)

`smoke_paper_hot_backup_restore`: real Paper; hot backup while a scripted RCON `setblock` loop runs; restore; verify world loads and region files from backup are byte-identical to the archive.
