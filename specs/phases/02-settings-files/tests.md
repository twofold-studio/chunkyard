# Phase 2 — Test plan

Layout per [patterns.md §10](../../architecture/patterns.md#10-test-layout-rust) and [testing/strategy.md](../../testing/strategy.md). Kinds: **U** unit, **P** proptest, **F** fuzz, **I** crate integration, **A** API integration (`mcm-api-tests`, `TestApp` + fake-mc, real time), **C** frontend component/unit, **E** Playwright. `FakeClock` is used only in pure-logic tests (GC policies, caches).

## mcm-fs — sandbox (`crates/mcm-fs/src/sandbox.rs`, `tests/sandbox.rs`)

| Test | Kind | FR |
|---|---|---|
| `resolve_plain_relative_path_inside_root_ok` | U | 01 |
| `resolve_leading_slash_treated_as_relative` | U | 01 |
| `resolve_dotdot_within_root_normalises` (`a/../b` → `b`) | U | 01 |
| `resolve_dotdot_outside_root_is_rejected` | U | 01 |
| `resolve_nul_byte_is_rejected` | U | 01 |
| `resolve_component_over_255_bytes_is_rejected` | U | 01 |
| `resolve_path_over_4096_bytes_is_rejected` | U | 01 |
| `resolve_backslash_traversal_is_rejected` (`..\\..\\etc`) | U | 01 |
| `resolve_user_dot_mcm_dir_is_ordinary` | U | 01 |
| `resolve_unicode_fullwidth_dots_stay_inside` | U | 01 |
| `prop_resolve_never_escapes_root` (random component sequences incl. `..`, `.`, `/`, symlinks created in tmp tree) | P | 01, 02 |
| `open_through_symlink_dir_is_refused` | I | 02 |
| `open_symlink_file_is_refused` | I | 02 |
| `symlink_swapped_in_after_resolve_is_not_followed` (race: replace dir with symlink between resolve and open) | I | 02 |
| `delete_symlink_removes_link_not_target` | I | 02 |
| `list_reports_symlink_target` | I | 02, 18 |
| fuzz `sandbox_resolve` (asserts result is inside root or error; never panics) | F | 01 |

## mcm-fs — archives (`src/archive/*.rs`, `tests/archive.rs`)

| Test | Kind | FR |
|---|---|---|
| `zip_extract_basic_tree_ok` | I | 03 |
| `zip_slip_entry_is_rejected` (`../../evil`) | I | 03 |
| `zip_absolute_entry_is_rejected` | I | 03 |
| `zip_windows_drive_entry_is_rejected` (`C:\x`) | I | 03 |
| `zip_symlink_entry_is_skipped_and_reported` | I | 03 |
| `tar_hardlink_and_device_entries_skipped` | I | 03 |
| `zip_bomb_ratio_aborts` (synthesised 10 GiB-of-zeros entry) | I | 03 |
| `extract_total_size_limit_aborts_and_cleans_staging` | I | 03 |
| `extract_entry_count_limit_aborts` | I | 03 |
| `extract_conflict_fail_leaves_dest_untouched` | I | 03 |
| `extract_conflict_skip_and_overwrite` | I | 03 |
| `extract_cancel_removes_partial_output` | I | 03, 29 |
| `extract_free_space_precheck_fails_with_no_space` (injected `DiskSpace` fake: free < uncompressed + 512 MiB) | I | 03 |
| `extract_margin_is_max_of_10_percent_and_512_mib` | U | 03 |
| `extract_inflating_beyond_declared_size_rechecks_and_aborts` | I | 03 |
| `zip_cp437_names_decoded` | U | 03 |
| `tar_zst_and_tgz_extract_ok` | I | 03 |
| `create_zip_stores_jars_uncompressed` | I | 04 |
| `create_tar_zst_roundtrip` | I | 04 |
| `stream_zip_is_valid_zip64_for_large_input` (sparse 5 GiB file) | I | 05 |
| `stream_zip_memory_bounded` (tracking allocator, ≤ 4 MiB peak) | I | 05 |
| `prop_extract_never_writes_outside_dest` (random entry names) | P | 03 |
| fuzz `zip_extract`, `tar_extract` | F | 03 |

## mcm-fs — properties (`src/properties/*.rs`)

| Test | Kind | FR |
|---|---|---|
| `parse_vanilla_generated_file` (fixture from 1.21.1) | U | 06 |
| `parse_colon_and_whitespace_separators` | U | 06 |
| `parse_line_continuation_strips_leading_ws` | U | 06 |
| `parse_even_trailing_backslashes_no_continuation` | U | 06 |
| `parse_unicode_escape` / `parse_malformed_unicode_escape_errors_with_line` | U | 06 |
| `parse_bang_and_hash_comments` | U | 06 |
| `parse_iso_8859_1_fallback` | U | 06 |
| `duplicate_key_last_wins_and_is_edited` | U | 07 |
| `write_unchanged_file_is_byte_identical` | U | 07 |
| `write_changed_key_only_touches_that_line` | U | 07 |
| `escape_value_leading_space_and_specials` | U | 07 |
| `escape_non_ascii_as_u_escapes_with_surrogates` (emoji) | U | 07 |
| `prop_roundtrip_set_then_parse_returns_value` (arbitrary unicode key/value) | P | 06, 07 |
| `prop_unmodified_roundtrip_identical` | P | 07 |
| `schema_validates_types_and_ranges` (table-driven) | U | 10, 11 |
| `schema_legacy_numeric_difficulty_accepted_for_1_12` | U | 11 |
| `apply_managed_sets_server_port_preserving_comments` | U | 12 |
| `managed_registry_p2_contains_only_server_port` (no `rcon.*`/`management-server-*` written) | U | 12 |
| `redact_replaces_only_secret_values_byte_preserving` (`rcon.password`, `management-server-secret`, `management-server-tls-keystore-password`) | U | 32 |
| `restore_placeholders_keeps_stored_secret` / `restore_placeholders_new_value_replaces` | U | 32 |
| `schema_management_keys_marked_secret_and_since_1_21_9` | U | 10, 32 |
| fuzz `properties_parse` (parse → serialize → parse equality) | F | 06 |

## mcm-fs — players (`src/players/*.rs`)

| Test | Kind | FR |
|---|---|---|
| `offline_uuid_matches_java_nameuuidfrombytes` (vectors: `Notch` → known value computed by Java, stored in fixture) | U | 17 |
| `mojang_lookup_parses_undashed_id` / `mojang_lookup_204_and_404_are_unknown` / `mojang_lookup_429_is_upstream_error` (`crates/mcm-download/tests/mojang.rs`, wiremock via `test-hooks` base URL) | I | 17 |
| `mojang_lookup_uses_safe_http_and_rejects_private_target` (`mcm-download`) | I | 17 |
| `lookup_cache_hits_and_negative_cache_expires` (FakeClock) | U | 17 |
| `ban_entry_serialises_vanilla_date_format` | U | 15 |
| `ban_ip_guard_rejects_loopback_unspecified_and_trusted_proxies` (table: `127.0.0.1`, `127.8.8.8`, `::1`, `0.0.0.0`, `::`, a trusted CIDR address; `203.0.113.7` allowed) | U | 15 |
| `list_files_roundtrip_preserve_unknown_fields` | U | 14, 15 |
| `malformed_list_file_reports_line` | U | 14 |

## mcm-core

| Test | Kind | FR |
|---|---|---|
| `jvm_allowlist_vectors` (`testdata/validation/jvm_args.json`: G1/ZGC flags, `-XX:MaxGCPauseMillis=200`, vetted `-D` keys allowed; `-javaagent:x`, `-XX:OnError=sh`, `@args`, `-Dfoo=bar`, `-XX:+StartAttachListener` rejected) | U | 08 |
| `jvm_allowlist_rejects_xmx_xms_for_everyone` | U | 08 |
| `prop_jvm_allowlist_never_panics` | P | 08 |

## mcm-process

| Test | Kind | FR |
|---|---|---|
| `restart_required_set_on_settings_change_while_running_cleared_on_start` (`crates/mcm-process/tests/supervisor.rs`) | I | 09 |

## mcm-api-tests (`crates/mcm-api-tests/tests/p2_*.rs`, fake-mc)

| Test | Kind | FR |
|---|---|---|
| `patch_server_validates_memory_bounds` / `patch_server_memory_over_host_ram_rejected` / `patch_server_warns_overcommit` | A | 08 |
| `patch_server_rejects_xmx_in_jvm_args` | A | 08 |
| `patch_server_non_admin_arg_off_allowlist_422_names_token` | A | 08 |
| `patch_server_admin_freeform_args_ok_with_warning` (`warnings[].code = jvm_args_admin_freeform`) | A | 08 |
| `patch_server_returns_server_and_warnings_shape` | A | 08 |
| `patch_server_env_forbidden_keys_rejected` | A | 08 |
| `patch_server_port_conflict_409_and_syncs_properties` | A | 08, 12 |
| `patch_server_audit_lists_field_names_only` | A | 08 |
| `get_properties_merges_schema` | A | 10 |
| `properties_api_redacts_secrets_without_console_write` / `..._shows_secrets_with_console_write` | A | 10, 32 |
| `files_read_server_properties_redacted_without_console_write` | A | 19, 32 |
| `files_download_server_properties_redacted_without_console_write` | A | 25, 32 |
| `files_download_zip_redacts_server_properties_entry` | A | 26, 32 |
| `put_properties_placeholder_keeps_secret` / `files_write_placeholder_keeps_secret` | A | 11, 20, 32 |
| `put_properties_requires_if_match_428` / `put_properties_stale_etag_412` | A | 11 |
| `put_properties_managed_key_rejected` | A | 11 |
| `put_properties_while_running_sets_restart_required_ws_event` | A | 09, 11 |
| `start_applies_managed_keys_fake_mc_listens_on_assigned_port` | A | 12 |
| `eula_get_reflects_file_and_accept_writes_header` | A | 13 |
| `whitelist_add_stopped_edits_json_with_uuid` | A | 15, 17 |
| `whitelist_add_running_sends_command_and_confirms_from_file` (FAKE_MC_CONTROL asserts `whitelist add Alice`) | A | 15 |
| `op_with_custom_level_running_returns_409` | A | 15 |
| `ban_ip_invalid_ip_422` / `add_duplicate_409` / `remove_missing_404` | A | 15 |
| `ban_ip_loopback_422_ban_ip_forbidden` (running and stopped) | A | 15 |
| `players_audit_actions_use_catalog_names` (`players.whitelist.update`, `players.ops.update`, `players.bans.update`) | A | 15, 16 |
| `players_mutation_while_starting_409_busy` | A | 15 |
| `whitelist_toggle_running_and_stopped` | A | 16 |
| `players_lookup_offline_mode_uses_offline_uuid` | A | 17 |
| `files_list_sorted_dirs_first` / `files_list_truncates_at_10000` | A | 18 |
| `files_read_binary_415` / `files_read_over_5mib_413` | A | 19 |
| `files_write_create_requires_if_none_match` / `files_write_etag_flow` | A | 20 |
| `files_write_server_properties_reapplies_managed_keys` | A | 20, 12 |
| `files_traversal_matrix_all_endpoints_403_or_400` (table of hostile paths × every files endpoint) | A | 01, 18–30 |
| `files_move_dir_into_itself_409` / `files_mkdir_parents` | A | 21 |
| `files_copy_job_progress_and_result` | A | 22 |
| `files_delete_moves_to_state_dir_trash_and_restore` (payload + `trash.json` under `<data>/state/<id>/trash`, nothing under the server dir) / `files_restore_conflict_409` / `files_delete_permanent` | A | 23, 24 |
| `forged_trash_metadata_in_server_dir_is_ignored` | A | 23, 24 |
| `trash_gc_never_removes_entries_younger_than_24h_even_when_disk_low` (FakeClock + `DiskSpace` fake) | U (`mcm-fs`) | 23 |
| `trash_gc_removes_oldest_first_while_free_below_threshold` | U (`mcm-fs`) | 23 |
| `trash_gc_removes_all_entries_older_than_7_days` | U (`mcm-fs`) | 23 |
| `files_download_range_206` / `files_download_multirange_200` / `files_download_416` / `files_download_head` | A | 25 |
| `files_download_sets_nosniff_and_octet_stream_for_html` | A | 25 |
| `files_download_zip_streams_valid_zip` | A | 26 |
| `files_upload_multipart_ok_and_rejects_slash_names` / `files_upload_multipart_over_100mib_413` | A | 27 |
| `upload_session_full_flow_sha256_ok` | A | 28 |
| `upload_session_resume_after_disconnect` (drop connection mid-chunk; status shows last durable offset) | A | 28 |
| `upload_offset_mismatch_409_returns_received` / `upload_hash_mismatch_422` / `upload_other_principal_404` | A | 28 |
| `upload_insufficient_space_507` (small tmpfs via `CHUNKYARD_TEST_DOCKER` or injected `DiskSpace` fake) | A | 28 |
| `upload_session_gc_after_24h` (FakeClock) | U (`mcm-fs`) | 28 |
| `archive_and_extract_jobs_end_to_end` / `extract_job_zip_slip_fails_with_code` | A | 29, 03 |
| `extract_job_insufficient_space_fails_fs_no_space` (injected `DiskSpace`) | A | 29, 03 |
| `files_job_conflicts_with_running_install_job_409` | A | 31 |
| `files_search_glob_and_partial` | A | 30 |
| `p2_every_mutation_writes_audit_entry` (table over all mutating endpoints) | A | all |
| `p2_permission_matrix` (token scoped to `files.read` cannot write; `server.view` cannot read properties) | A | all |
| `no_secrets_in_logs_p2` (secret property values never in captured logs or audit details) | A | 10, 32 |

## Frontend (Vitest, `web/src/lib/features/...`)

| Test | Kind | FR |
|---|---|---|
| `settings/schema.test.ts` — shared vectors `server-settings.json` | C | 08 |
| `properties-form.svelte.test.ts` — dirty tracking, reset, managed keys immutable | C | 10, 11 |
| `PropertyField.test.ts` — renders switch/number/select/secret by spec; range errors; placeholder untouched keeps value | C | 10, 32 |
| `PropertiesEditor.test.ts` — 412 → reload/overwrite dialog (MSW) | C | 11 |
| `MemoryField.test.ts` — warning when above recommended | C | 08 |
| `JvmArgsEditor.test.ts` — rejects `-Xmx` client-side; allow-list vectors for non-admin; admin free-form warning; presets insert args | C | 08 |
| `EulaCard.test.ts` — link attrs, accept posts | C | 13 |
| `AddPlayerDialog.test.ts` — debounced lookup, offline source label, 202 toast; IP-ban loopback rejected | C | 15, 17 |
| `upload.svelte.test.ts` — chunking, resume from `received` after 409/network error, retry backoff (fake timers), hash computation | C | 28 |
| `selection.svelte.test.ts` — shift-range, ctrl toggle | C | 18 |
| `language.test.ts` — extension mapping, logs read-only | C | 19 |
| `FileEditor.test.ts` — Mod-s saves with If-Match; dirty guard; 415 message | C | 19, 20 |
| `FileTable.test.ts` — keyboard nav, F2 rename, Del → confirm | C | 18, 21, 23 |
| `McText.test.ts` — `§` codes to spans, no HTML injection (`<script>` rendered as text) | C | 10 |

## E2E (`e2e/tests/p2-*.spec.ts`)

| Test | FR |
|---|---|
| `p2-settings › edit motd and max-players, restart banner appears, restart clears it` | 09, 10, 11 |
| `p2-settings › accept EULA then start succeeds (fake-mc require_eula)` | 13 |
| `p2-settings › memory above host RAM shows validation error` | 08 |
| `p2-settings › properties page as console-less user shows ******** for rcon.password, save keeps it` | 32 |
| `p2-players › whitelist add while running and while stopped; ban with reason` | 14–16 |
| `p2-files › browse, create folder, edit yaml with highlighting, save, concurrent edit conflict` | 18–21 |
| `p2-files › upload 4 GiB sparse file, abort network mid-way (route.abort), resume completes, hash ok` | 28 |
| `p2-files › drag-drop folder upload creates tree` | 27, 28 |
| `p2-files › zip a folder, download it, extract into new dir` | 25, 26, 29 |
| `p2-files › delete and restore from trash` | 23, 24 |
| `p2-files › unsaved changes guard on navigation` | 20 |
| axe scan of settings and files pages | — |
