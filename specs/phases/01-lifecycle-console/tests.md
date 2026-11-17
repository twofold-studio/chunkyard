# Phase 1 — Test plan

Kinds: U unit, P property, F fuzz, I crate integration, A API integration (`crates/api-tests/tests/p1_*.rs` via `TestApp` built with `test-hooks`, + fake-mc), S snapshot, V Vitest unit, C component, E Playwright, X smoke.

Rules: lifecycle tests use `fake-mc-server` via `FakeJava` and **real time** with short timeouts (`stop_timeout_s = 2`, `RestartPolicy` base 100 ms, `start_timeout_s` set directly on `SpawnSpec` in crate tests) and `wait_until` polling; paused time / `FakeClock` only in pure-logic unit tests. `TestApp` registers wiremock's base URL as a `test-hooks` upstream so `SafeHttp` may reach loopback for URL sources; the SSRF tests use an app without that override.

## chunkyard-protocol

| Test | File | FR | Kind |
|---|---|---|---|
| `varint_known_vectors_roundtrip` (0, 1, 127, 128, 255, 25565, 2097151, i32::MAX, -1, i32::MIN) | `src/varint.rs` | 01 | U |
| `varint_roundtrip_any_i32` / `varlong_roundtrip_any_i64` | `src/varint.rs` | 01 | P |
| `varint_six_bytes_is_too_long` / `varint_truncated_is_eof` | `src/varint.rs` | 01 | U |
| `handshake_encode_decode_roundtrip` | `src/packet/handshake.rs` | 02 | P |
| `handshake_address_over_limit_rejected` | `src/packet/handshake.rs` | 02 | U |
| `handshake_normalized_host_strips_fml_marker` | `src/packet/handshake.rs` | 02 | U |
| `handshake_normalized_host_trailing_dot_and_case` | `src/packet/handshake.rs` | 02 | U |
| `handshake_next_state_transfer_and_unknown` | `src/packet/handshake.rs` | 02 | U |
| `frame_length_over_max_rejected` | `src/packet/frame.rs` | 02 | U |
| `slp_response_description_string_or_component` (fixtures `tests/fixtures/slp/*.json`) | `src/slp/model.rs` | 03 | U |
| `slp_response_unknown_fields_preserved` | `src/slp/model.rs` | 03 | U |
| `slp_ping_against_fake_returns_status_and_rtt` | `tests/slp.rs` | 03 | I |
| `slp_ping_timeout_on_silent_server` | `tests/slp.rs` | 03 | I |
| `slp_response_over_256k_rejected` | `tests/slp.rs` | 03 | I |
| `rcon_packet_roundtrip` | `src/rcon/codec.rs` | 04 | P |
| `rcon_packet_length_bounds_enforced` | `src/rcon/codec.rs` | 04 | U |
| `rcon_auth_failure_is_auth_failed` | `tests/rcon.rs` | 04 | I |
| `rcon_exec_reassembles_fragments_over_4096` (fake `rcon_fragment_bytes=20000`) | `tests/rcon.rs` | 04 | I |
| `rcon_sentinel_sent_only_after_first_fragment` (hand-rolled server records arrival order) | `tests/rcon.rs` | 04 | I |
| `rcon_exec_idle_fallback_without_sentinel_reply` | `tests/rcon.rs` | 04 | I |
| `rcon_command_over_1400_bytes_rejected` | `src/rcon/client.rs` | 04 | U |
| `log_prefix_vanilla_parses_fixture` / `_paper_` / `_forge_` / `_fabric_` | `src/text/log_prefix.rs` (fixtures `tests/fixtures/logs/`) | 05 | U |
| `ready_matcher_ignores_chat_spoof_vanilla` / `_paper` / `_forge` / `_fabric` | `src/text/log_prefix.rs` | 05 | U |
| `ready_matcher_custom_body_keeps_prefix_checks` | `src/text/log_prefix.rs` | 05, 17 | U |
| `eula_matcher_matches_exact_line_only` | `src/text/log_prefix.rs` | 05, 20 | U |
| `flavor_to_family_table_custom_defaults_vanilla` | `src/text/family.rs` | 05 | U |
| `log_matchers_never_panic` | `src/text/log_prefix.rs` | 05 | P |
| fuzz `varint_decode`, `handshake_parse`, `slp_response_parse`, `rcon_packet_decode`, `log_prefix_parse` | `fuzz/fuzz_targets/` | 01–05 | F |

## chunkyard-download

| Test | File | FR | Kind |
|---|---|---|---|
| `safe_http_rejects_private_loopback_cgnat_linklocal_ula_mapped` (table) | `src/safe_http.rs` | 06 | U |
| `safe_http_allows_private_when_configured` | `src/safe_http.rs` | 06 | U |
| `safe_http_rejects_plain_http` | `src/safe_http.rs` | 06 | U |
| `safe_http_pins_resolved_ip_against_dns_rebinding` (stub resolver: 1st answer public test IP, 2nd private; assert socket connects to 1st) | `tests/safe_http.rs` | 06 | I |
| `safe_http_redirect_to_private_ip_rejected` | `tests/safe_http.rs` | 06 | I |
| `safe_http_more_than_five_redirects_fails` | `tests/safe_http.rs` | 06 | I |
| `downloader_hash_mismatch_removes_tmp` | `tests/downloader.rs` | 06 | I |
| `downloader_content_length_over_cap_aborts_before_write` | `tests/downloader.rs` | 06 | I |

## chunkyard-db / chunkyard-core

| Test | File | FR | Kind |
|---|---|---|---|
| `launch_spec_serde_tagged_kind` | `core/src/server.rs` | 07 | U |
| `server_repo_roundtrip_and_port_unique_with_null_node` | `db/tests/servers.rs` | 07, 10 | I |

## chunkyard-fs (P1 modules)

| Test | File | FR | Kind |
|---|---|---|---|
| `properties_merge_sets_only_server_port` | `src/properties.rs` | 11 | U |
| `properties_merge_preserves_comments_and_order` | `src/properties.rs` | 11 | U |
| `properties_merge_is_idempotent` | `src/properties.rs` | 11 | P |
| `copy_tree_excludes_patterns_and_skips_symlinks` | `tests/copy.rs` | 09, 28 | I |
| `copy_tree_aborts_on_fifo` | `tests/copy.rs` | 09 | I |
| `eula_write_and_parse` / `eula_parse_garbage_is_false` | `src/eula.rs` | 30 | U |
| `trash_move_then_purge` | `tests/trash.rs` | 29 | I |

## chunkyard-process

| Test | File | FR | Kind |
|---|---|---|---|
| `log_ring_evicts_by_lines` / `_by_bytes` | `src/log_ring.rs` | 32 | U |
| `log_ring_since_evicted_returns_full_snapshot` | `src/log_ring.rs` | 32 | U |
| `log_ring_seq_monotonic_under_any_ops` | `src/log_ring.rs` | 32 | P |
| `line_splitter_truncates_over_16k` / `line_splitter_lossy_utf8` | `src/stdio.rs` | 31 | U |
| `console_line_carries_current_epoch` | `src/stdio.rs` | 31 | U |
| `exit_classifier_table` | `src/exit.rs` | 20 | U |
| `backoff_schedule_and_budget` (paused time, pure logic) | `src/restart_policy.rs` | 21 | U |
| `command_line_builder_snapshot` (jar, argsFile, custom) | `src/spawn.rs` | 16 | S |
| `child_env_is_cleared_except_allowlist` | `tests/spawn.rs` | 15 | I |
| `spawner_runs_all_spawns_on_one_named_thread` | `tests/spawner.rs` | 15 | I |
| `native_spawn_survives_blocking_pool_thread_reaping` (request spawn from inside `spawn_blocking`, idle 15 s > 10 s keep-alive, assert child alive via control channel) | `tests/spawner.rs` | 15 | I |
| `supervisor_start_reaches_running_on_done_line` | `tests/supervisor.rs` | 16, 17 | I |
| `supervisor_chat_spoof_done_line_does_not_mark_running` (`fakechat` before real ready, `done_line` delayed, SLP disabled via profile) | `tests/supervisor.rs` | 17 | I |
| `supervisor_ready_uses_paper_family_for_paper_profile` | `tests/supervisor.rs` | 17 | I |
| `supervisor_ready_via_slp_when_no_done_line` | `tests/supervisor.rs` | 17 | I |
| `supervisor_start_slow_event_emitted_once` (real time, `start_timeout` 1 s on SpawnSpec) | `tests/supervisor.rs` | 17 | I |
| `supervisor_stop_graceful_exit_zero` | `tests/supervisor.rs` | 18 | I |
| `supervisor_stop_escalates_to_sigterm` / `_to_sigkill` | `tests/supervisor.rs` | 18 | I |
| `supervisor_kill_terminates_process_group_children` (`spawn_child`) | `tests/supervisor.rs` | 19 | I |
| `supervisor_restart_is_atomic` | `tests/supervisor.rs` | 19 | I |
| `supervisor_eula_exit_not_restarted` | `tests/supervisor.rs` | 20 | I |
| `supervisor_crash_restarts_with_backoff` / `supervisor_crash_loop_stops_after_budget` | `tests/supervisor.rs` | 21 | I |
| `supervisor_crash_log_in_state_dir_pruned_to_20` | `tests/supervisor.rs` | 21 | I |
| `supervisor_user_stop_cancels_pending_restart` | `tests/supervisor.rs` | 21 | I |
| `supervisor_pidfile_in_state_dir_with_epoch` | `tests/supervisor.rs` | 16, 23 | I |
| `adopt_native_returns_none_and_kills_verified_orphan` | `tests/orphan.rs` | 23 | I |
| `orphan_pid_reused_by_other_process_is_ignored` (start time mismatch) | `tests/orphan.rs` | 23 | I |
| `orphan_with_wrong_cwd_is_ignored` | `tests/orphan.rs` | 23 | I |
| `forged_pidfile_inside_server_dir_is_never_read` | `tests/orphan.rs` | 23 | I |
| `flood_does_not_block_child_with_stalled_consumer` (50k lines/s) | `tests/backpressure.rs` | 31 | I |
| `console_file_in_state_dir_rotates_at_10mib` | `tests/console_file.rs` | 35 | I |
| `shutdown_stops_all_servers_within_deadline` | `tests/shutdown.rs` | 24 | I |

## API (`crates/api-tests/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `create_server_from_url_downloads_and_sets_launch` | `p1_servers_create.rs` | 08, 09 | A |
| `create_server_response_shape_server_job_warnings` | `p1_servers_create.rs` | 08 | A |
| `create_server_admin_jvm_args_returns_freeform_warning` | `p1_servers_create.rs` | 08 | A |
| `create_server_later_phase_fields_are_422` (`java`, `acceptEula`, `source.kind=installer`) | `p1_servers_create.rs` | 08, 13 | A |
| `create_server_creates_servers_and_state_dirs_by_id` | `p1_servers_create.rs` | 08 | A |
| `create_server_url_sha256_mismatch_fails_job` | `p1_servers_create.rs` | 09 | A |
| `create_server_url_private_target_blocked_by_default` | `p1_servers_create.rs` | 06, 09 | A |
| `create_server_url_too_large_fails` | `p1_servers_create.rs` | 09 | A |
| `create_server_import_copies_tree` / `_outside_roots_is_422` / `_ambiguous_jar_fails_job` | `p1_servers_create.rs` | 09 | A |
| `create_server_validation_errors_table` (`testdata/validation/create_server.json`) | `p1_servers_create.rs` | 13 | A |
| `create_server_non_admin_custom_launch_forbidden` | `p1_servers_create.rs` | 13 | A |
| `create_server_does_not_enable_rcon` (properties lack `enable-rcon=true`, DTO has no rcon fields) | `p1_servers_create.rs` | 11 | A |
| `port_allocation_skips_used_and_unbindable` | `crates/server/src/ports.rs` | 10 | U |
| `port_explicit_conflict_is_409` / `concurrent_creates_get_distinct_ports` | `p1_servers_create.rs` | 10 | A |
| `java_detected_lists_fake_java_from_java_home` / `java_invalid_path_is_422` | `p1_java.rs` | 12 | A |
| `start_stop_roundtrip_updates_status_over_ws` | `p1_servers_power.rs` | 14, 16, 18, 25 | A |
| `start_when_running_is_409` / `start_with_port_in_use_is_409` / `start_with_missing_jar_is_409` / `start_during_job_is_409_busy` | `p1_servers_power.rs` | 16 | A |
| `kill_sets_reason_killed` / `restart_emits_stopping_then_running` | `p1_servers_power.rs` | 19 | A |
| `power_requires_server_power_permission` | `p1_servers_power.rs` | 16 | A |
| `autostart_starts_flagged_servers_with_stagger_and_audits_trigger` | `crates/server/tests/autostart.rs` | 22 | I |
| `list_and_get_embed_status_and_my_permissions` | `p1_servers_crud.rs` | 26 | A |
| `patch_returns_server_and_warnings` / `patch_unknown_field_is_422` / `patch_name_conflict_is_409` | `p1_servers_crud.rs` | 27 | A |
| `patch_validation_table_p1_rows` (shared vectors `testdata/validation/patch_server.json`) | `p1_servers_crud.rs` | 27 | A |
| `patch_log_family_changes_ready_matcher` | `p1_servers_crud.rs` | 27, 17 | A |
| `clone_copies_excluding_logs_without_state_with_new_port` / `clone_running_source_is_409` / `clone_failure_cleans_up_destination` | `p1_servers_clone.rs` | 28 | A |
| `delete_stopped_server_removes_row_and_dirs` / `delete_running_without_force_is_409` / `delete_running_with_force_kills_then_deletes` | `p1_servers_delete.rs` | 29 | A |
| `delete_job_keeps_own_job_row_and_removes_others` | `p1_servers_delete.rs` | 29 | A |
| `eula_accept_writes_file_and_flag` / `eula_required_exit_surfaced_in_status` | `p1_servers_eula.rs` | 30, 20 | A |
| `console_subscribe_receives_live_lines_with_epoch` | `p1_console.rs` | 31, 33 | A |
| `console_resume_since_seq_no_gaps_no_duplicates` | `p1_console.rs` | 33 | A |
| `console_since_evicted_seq_sends_reset` | `p1_console.rs` | 33 | A |
| `console_resume_after_manager_restart_resets` (`TestApp::restart()`, subscribe with old epoch → `reset` with new epoch) | `p1_console.rs` | 33, 31 | A |
| `console_slow_client_gets_lagged` / `console_requires_console_read` | `p1_console.rs` | 33 | A |
| `command_via_ws_reaches_stdin_and_echoes_input_line` | `p1_console.rs` | 34 | A |
| `command_via_rest_audited_as_console_command` | `p1_console.rs` | 34 | A |
| `command_with_newline_is_422` / `command_when_stopped_is_409` / `command_rate_limit_is_429` | `p1_console.rs` | 34 | A |
| `console_rest_fallback_honours_epoch` / `console_log_download_streams_file` | `p1_console.rs` | 35 | A |
| `crash_logs_list_and_fetch` / `crash_log_name_traversal_is_422` | `p1_crashes.rs` | 36 | A |
| `ws_servers_topic_filters_by_permission` | `p1_ws_servers.rs` | 25 | A |
| `ws_console_payload_snapshot` | `p1_ws_servers.rs` | 33 | S |
| `audit_entries_for_all_phase1_mutations_use_catalog_names` | `p1_audit.rs` | 08, 16, 18, 19, 27–30, 34 | A |

## fake-mc-server (`crates/fake-mc-server/tests/`) — FR 37

`slp_roundtrip_with_mcm_protocol_client`, `rcon_auth_failure_returns_minus_one`, `rcon_fragmentation_over_4096`, `stop_command_exits_zero`, `eula_missing_exits_with_message`, `java_shim_parses_jar_and_ignores_jvm_flags`, `java_version_flag_prints_to_stderr`, `sigterm_exits_143`, `fakechat_logs_in_family_chat_format`, `log_format_matches_family_fixture_for_each_flavor`.

## chunkyard-testkit — FR 38

`fake_java_install_creates_executable_symlink`, `test_app_create_server_reaches_running`, `test_app_restart_changes_epoch_keeps_data` (`crates/testkit/tests/`).

## Frontend

| Test | File | FR | Kind |
|---|---|---|---|
| `ServersState › applies created/updated/deleted/status events` | `features/servers/servers.svelte.test.ts` | 25 | V |
| `schema › create server shared vectors` / `patch server shared vectors` | `features/servers/schema.test.ts` | 13, 27 | V |
| `ConsoleSession › resubscribes with epoch and lastSeq after reconnect` | `features/console/console.svelte.test.ts` | 33 | V |
| `ConsoleSession › reset with new epoch clears terminal` / `lagged writes notice` | `features/console/console.svelte.test.ts` | 33 | V |
| `CommandHistory › caps at 100, dedupes consecutive, per server` | `features/console/history.svelte.test.ts` | 34 | V |
| `CommandInput › arrow keys navigate history` / `disabled when stopped` | `features/console/components/CommandInput.test.ts` | 34 | C |
| `PowerControls › buttons per state and kill confirmation` | `features/servers/components/PowerControls.test.ts` | 16, 19 | C |
| `CreateServerWizard › url source submits source.kind payload and shows warnings` | `features/servers/components/CreateServerWizard.test.ts` | 08, 09 | C |
| `CreateServerWizard › import disabled without import feature` | same | 09 | C |
| `LifecyclePolicyDialog › sends logFamily and renders warnings` | `features/servers/components/LifecyclePolicyDialog.test.ts` | 27 | C |
| `EulaBanner › accept then start` | `features/servers/components/EulaBanner.test.ts` | 30 | C |
| `DeleteServerDialog › requires typed name` | `features/servers/components/DeleteServerDialog.test.ts` | 29 | C |
| `StatusBadge › label and colour per state` | `features/servers/components/StatusBadge.test.ts` | 25 | C |

## E2E (`e2e/tests/p1-*.spec.ts`)

| Test | FR |
|---|---|
| `p1-lifecycle › create from URL, accept EULA, start, see Running, stop` | 08, 09, 16–18, 30 |
| `p1-console › live output colours, send command, history with ArrowUp` | 31–34 |
| `p1-console › reload page resumes without duplicate lines` | 33 |
| `p1-console › mcm restart redraws console from reset` | 33 |
| `p1-crash › crashing server restarts then shows crash-loop banner` | 21 |
| `p1-clone-delete › clone appears on dashboard; delete requires name` | 28, 29 |
| `p1-a11y › axe on dashboard, wizard, overview, console` (CSP check runs in the shared fixture) | exit |

## Smoke (nightly, real Java)

`smoke_p1_custom_jar_lifecycle` — URL source from the Mojang manifest's server jar, `javaPath` from `actions/setup-java` (Temurin 21; the documented exception until P3), start → Running via the real `ready` matcher, `say` command, graceful stop. FR 08, 09, 16–18, 34. Also contributes vanilla output to `smoke_capture_log_fixtures`.
