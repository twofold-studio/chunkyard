# Phase 5 — Test plan

`FakeClock` / `tokio::time::pause()` are used **only** in pure-logic unit tests (rollups, retention, probe back-off, availability). Every test that runs `fake-mc-server` uses real time with short intervals (`sample_interval_s = 1` via `test-hooks`, minimum 5 s otherwise) and `wait_until`. Fake-server profiles: `memory_mb`, `tps`, `players`, `flavor`, `spawn_child`, `rcon_fragment_bytes`, `fakejoin`/`fakeleave`/`fakechat`, management protocol ([testing/fake-server.md](../../testing/fake-server.md)). `/proc` parsing is tested with fixture trees under `crates/mcm-metrics/tests/fixtures/proc/` (sampler takes a configurable proc root).

## `mcm-protocol` unit (pure text parsers, `src/text/*.rs`)

| Test | File | FR | Kind |
|---|---|---|---|
| `list_parses_modern_format` | text/list.rs | 06 | unit |
| `list_parses_pre_1_13_two_line_format` | text/list.rs | 06 | unit |
| `list_zero_players_empty_names` | text/list.rs | 06 | unit |
| `list_strips_section_colour_codes` | text/list.rs | 06 | unit |
| `tps_paper_parses_three_windows_and_star_prefix` | text/tps.rs | 08 | unit (fixture) |
| `tps_forge_overall_mean_tick_time` | text/tps.rs | 08 | unit (fixture) |
| `tps_vanilla_tick_query_derives_tps_from_mspt` | text/tps.rs | 08 | unit (fixture) |
| `tps_unknown_command_is_unsupported` | text/tps.rs | 08 | unit |
| `join_matcher_ignores_chat_spoof_vanilla` | text/log_prefix.rs | 07, Sec | unit (fixture) |
| `join_matcher_ignores_chat_spoof_paper` | text/log_prefix.rs | 07, Sec | unit (fixture) |
| `join_matcher_ignores_chat_spoof_fabric` | text/log_prefix.rs | 07, Sec | unit (fixture) |
| `join_matcher_ignores_chat_spoof_forge` | text/log_prefix.rs | 07, Sec | unit (fixture) |
| `leave_matcher_rejects_say_broadcast_body` (`[Server] Bob left the game`) | text/log_prefix.rs | 07, Sec | unit |
| `uuid_matcher_requires_user_authenticator_thread_vanilla` | text/log_prefix.rs | 07 | unit |
| `uuid_matcher_paper_body_anchored` | text/log_prefix.rs | 07 | unit |
| `mgmt_players_response_deserializes` | mgmt.rs | 06, 20 | unit (fixture) |
| `mgmt_join_left_notifications_deserialize` | mgmt.rs | 07, 20 | unit (fixture) |
| `prop_text_parsers_never_panic` | text/mod.rs | 06–08 | property |

Chat-spoof tests use the per-family fixtures in `crates/mcm-protocol/tests/fixtures/logs/` ([log-formats.md](../../architecture/log-formats.md#fixtures)); e.g. `<Mallory> Bob left the game` must not close Bob's session.

## `mcm-protocol` integration (RCON client, `crates/mcm-protocol/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `rcon_sentinel_sent_only_after_first_fragment` | rcon_client.rs | 05 | fake-mc (`rcon_fragment_bytes=10000`, control channel records packet order) |
| `rcon_fragmented_response_reassembled_over_4096` | rcon_client.rs | 05 | fake-mc |
| `rcon_sentinel_unanswered_falls_back_to_idle_timeout` | rcon_client.rs | 05 | in-test TCP stub |

## `mcm-metrics` unit (inline)

| Test | File | FR | Kind |
|---|---|---|---|
| `proc_stat_parses_comm_with_spaces_and_parens` | proc_sampler.rs | 02 | unit |
| `proc_sampler_sums_all_pids_in_group` | proc_sampler.rs | 02 | unit (fixture proc root) |
| `proc_sampler_ignores_reused_pid_with_new_starttime` | proc_sampler.rs | 02 | unit |
| `cpu_delta_negative_resets_baseline` | proc_sampler.rs | 02 | unit |
| `host_cpu_from_proc_stat_deltas` | host.rs | 09 | unit |
| `host_mem_used_from_meminfo_available` | host.rs | 09 | unit |
| `disk_walk_does_not_follow_symlinks` | disk.rs | 03 | unit (tempdir) |
| `disk_walk_timeout_marks_approx` | disk.rs | 03 | unit |
| `player_source_prefers_management_then_rcon_slp_query` | players.rs | 06, 20 | unit (fakes) |
| `rcon_exposure_loopback_only_when_server_ip_loopback` | managed_keys.rs | 19 | unit |
| `managed_keys_skip_rcon_when_rcon_disabled` | managed_keys.rs | 04, 19 | unit |
| `managed_keys_management_only_for_supported_versions` | managed_keys.rs | 20 | unit |
| `tracker_reconcile_opens_missing_and_closes_absent` | players.rs | 07 | unit |
| `tracker_slp_partial_never_closes_sessions` | players.rs | 07 | unit |
| `probe_disabled_after_three_parse_failures_for_30_min` | tps.rs | 08 | unit (FakeClock) |
| `probe_selection_by_flavor_prefers_spark` | tps.rs | 08 | unit |
| `rollup_60s_averages_ignoring_nulls` | rollup.rs | 11 | unit |
| `rollup_is_idempotent_on_rerun` | rollup.rs | 11 | unit |
| `rollup_players_uses_max_rss_max_tracked` | rollup.rs | 11 | unit |
| `history_resolution_auto_pick_thresholds` | rollup.rs | 12 | unit |
| `downsample_to_max_points_bucket_average` | rollup.rs | 12 | unit |
| `history_gaps_emitted_as_null_points` | rollup.rs | 12 | unit |
| `availability_excludes_intentional_stops` | availability.rs | 14 | unit |
| `availability_counts_slow_start_beyond_timeout` | availability.rs | 14 | unit |
| `availability_null_when_never_ran` | availability.rs | 14 | unit |
| `prometheus_render_escapes_labels_and_types` | prometheus.rs | 16 | unit + insta |
| `prop_downsample_preserves_time_order_and_bounds` | rollup.rs | 12 | property |

## `mcm-metrics` integration (`crates/mcm-metrics/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `collector_samples_fake_mc_rss_and_cpu` | collector.rs | 01, 02 | fake-mc (`memory_mb=256`) |
| `collector_includes_child_processes_in_group` | collector.rs | 02 | fake-mc (`spawn_child`) |
| `collector_slow_rcon_does_not_delay_other_servers` | collector.rs | 01, 17 | fake-mc (RCON delay via profile), real time |
| `collector_writes_one_transaction_per_tick` | collector.rs | 10, 17 | counting fake `MetricRepo` |
| `rcon_actor_single_persistent_connection` | rcon_actor.rs | 05 | fake-mc control channel counts connections |
| `rcon_actor_auth_failure_stops_retrying` | rcon_actor.rs | 05 | fake-mc wrong password |
| `rcon_actor_reconnects_after_server_restart` | rcon_actor.rs | 05 | fake-mc |
| `players_from_rcon_list_full_names` | players.rs | 06 | fake-mc |
| `players_fallback_to_slp_when_rcon_disabled` | players.rs | 06, 19 | fake-mc |
| `players_from_management_protocol_when_supported` | players.rs | 06, 20 | fake-mc (`version_name=1.21.9`) |
| `management_auth_failure_falls_back_to_rcon` | mgmt_actor.rs | 20 | fake-mc wrong secret |
| `sessions_from_management_notifications` | sessions.rs | 07, 20 | fake-mc |
| `sessions_ignore_fakechat_spoof_lines` | sessions.rs | 07, Sec | fake-mc (`fakechat Mallory Bob left the game`, each flavour) |
| `players_query_used_when_enabled_and_no_rcon` | players.rs | 06 | fake-mc |
| `sessions_from_fakejoin_fakeleave` | sessions.rs | 07 | fake-mc |
| `sessions_closed_on_server_stop` | sessions.rs | 07 | fake-mc |
| `sessions_dangling_closed_on_startup` | sessions.rs | 07 | fake `PlayerSessionRepo` |
| `tps_probe_paper_via_rcon_not_stdin` | tps.rs | 08, US-7 | fake-mc control channel: no stdin events |
| `tps_probe_forge_flavor` | tps.rs | 08 | fake-mc `flavor=forge` |
| `rollup_and_retention_with_fake_clock_over_401_days` | retention.rs | 11 | in-memory `MetricRepo` + FakeClock (pure logic) |
| `state_history_recorded_from_status_events` | availability.rs | 14 | event bus + fake repo |

## `mcm-db` (`crates/mcm-db/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `metric_repo_upsert_rollup_idempotent` | p5_metrics_repo.rs | 10, 11 | SQLite |
| `metric_repo_delete_server_removes_samples_sessions_history` | p5_metrics_repo.rs | 18 | SQLite |
| `p5_migration_adds_rcon_disabled_and_management_columns` | p5_migration.rs | 19, 20 | SQLite |

## API (`crates/mcm-api-tests/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `metrics_snapshot_shape_snapshot` | p5_metrics.rs | 13 | API + insta |
| `metrics_requires_server_view_404_otherwise` | p5_metrics.rs | 13 | API |
| `metrics_history_validation_errors` | p5_metrics.rs | 12 | API |
| `metrics_history_auto_resolution_and_max_points` | p5_metrics.rs | 12 | API |
| `ws_metrics_topic_sends_latest_on_subscribe_then_samples` | p5_ws.rs | 13 | API + WS + fake-mc |
| `ws_players_topic_joined_left_events` | p5_ws.rs | 07, 13 | API + WS + fake-mc |
| `players_online_and_sessions_paging` | p5_players.rs | 15 | API |
| `players_top_by_playtime` | p5_players.rs | 15 | API |
| `availability_windows_endpoint` | p5_metrics.rs | 14 | API |
| `host_metrics_absolute_fields_admin_only` | p5_host.rs | 09, 13 | API |
| `summary_filters_invisible_servers` | p5_metrics.rs | 13 | API |
| `prometheus_disabled_returns_404` | p5_prometheus.rs | 16 | API |
| `prometheus_requires_metrics_read_scope` | p5_prometheus.rs | 16 | API |
| `prometheus_output_contains_server_gauges` | p5_prometheus.rs | 16 | API |
| `managed_rcon_properties_applied_on_start` | p5_rcon.rs | 04 | API + fake-mc (reads written properties) |
| `rcon_password_redacted_in_properties_for_non_console_write` | p5_rcon.rs | 04, Sec | API |
| `rcon_exposure_public_reported_when_server_ip_empty` | p5_rcon.rs | 19 | API |
| `patch_rcon_disabled_writes_enable_rcon_false_on_next_start` | p5_rcon.rs | 19 | API + fake-mc |
| `patch_rcon_disabled_audited_as_settings_update` | p5_rcon.rs | 19 | API |
| `management_keys_written_for_1_21_9_vanilla` | p5_mgmt.rs | 20 | API + fake-mc |
| `allowlist_add_uses_management_protocol_when_connected` | p5_mgmt.rs | 20 | API + fake-mc control channel (no stdin `whitelist` command) |
| `deleting_server_job_removes_metrics` | p5_metrics.rs | 18 | API |

## Smoke (nightly, real Java) — `crates/mcm-server/tests/smoke_metrics.rs`

| Test | FR |
|---|---|
| `smoke_paper_metrics_console_silent` — run collector 5 min, assert no console lines originated from RCON/monitoring | 05, 08, US-7 |
| `smoke_capture_tps_fixtures` — writes real outputs for each flavor into an artifact for fixture refresh | 08 |
| `smoke_vanilla_management_protocol_players` — vanilla ≥ 1.21.9: management keys applied, `minecraft:players` and allowlist add work | 20 |

## Frontend (Vitest)

| Test | File | FR |
|---|---|---|
| `LiveMetrics › keeps bounded sample window and resubscribes` | features/metrics/live.svelte.test.ts | 13 |
| `HistoryState › range change aborts previous fetch` | history.svelte.test.ts | 12 |
| `HistoryState › appends live samples only for 10s resolution` | history.svelte.test.ts | 12 |
| `TpsGauge › colour thresholds and unsupported tooltip` | TpsGauge.test.ts | 08 |
| `RconStatusBadge › public exposure shows warning and disable action` | RconStatusBadge.test.ts | 19 |
| `MemoryCard › shows -Xmx as reference not limit` | MemoryCard.test.ts | 02 |
| `MetricChart › breaks line on null points` | MetricChart.test.ts | 12 |
| `PlayerAvatar › renders initials when avatars off and never requests external URL` | PlayerAvatar.test.ts | Sec |
| `AvailabilityStrip › null days rendered as no-data` | AvailabilityStrip.test.ts | 14 |
| `format › bytes, durations, percent` | format.test.ts | — |

## E2E (`e2e/tests/p5-monitoring.spec.ts`)

| Test | Story |
|---|---|
| `overview cards update live while fake server runs` | US-1 |
| `metrics page range switch renders charts` | US-2 |
| `player joins via fakejoin appear in players panel and sessions` | US-3 |
| `availability strip shows crash day` | US-4 |
| `dashboard host widget visible` | US-5 |
| `prometheus endpoint scraped with API token` (request-only test) | US-6 |
| `public RCON warning and one-click disable` | US-8, FR-19 |
