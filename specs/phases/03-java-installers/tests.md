# Phase 3 — Test plan

Kinds: **U** unit, **P** proptest, **F** fuzz, **I** crate integration (wiremock / FakeJre / fake shims), **A** API integration (`chunkyard-api-tests`, `TestApp` built with `test-hooks` + `Upstreams` + fake-mc; real time, short timeouts), **C** frontend, **E** Playwright, **S** real-server smoke (nightly, `CHUNKYARD_SMOKE=1`). Fixtures per [fixtures.md](../../testing/fixtures.md); shims per [fake-server.md](../../testing/fake-server.md).

## chunkyard-java (`crates/chunkyard-java/src/**`, `tests/*.rs`)

| Test | Kind | FR |
|---|---|---|
| `parse_version_output_legacy_1_8_scheme` (`java version "1.8.0_432"` → 8) | U | 01 |
| `parse_version_output_modern` (`openjdk version "21.0.5" 2024-10-15` → 21; `"25-ea"` → 25; `"17"` → 17) | U | 01 |
| `parse_release_file_fields` | U | 01 |
| `elf_arch_detection_x86_64_and_aarch64` (fixture headers) | U | 01 |
| `discover_finds_java_home_path_and_jvm_dir_dedupes_symlinks` (FakeJre trees + symlinks in temp dirs, `PATH` override) | I | 01 |
| `discover_removes_vanished_and_flags_servers_auto` | I | 01 |
| `discover_disabled_hides_system_runtimes` | I | 01 |
| `adoptium_asset_selection_picks_jre_targz` (fixture with jdk+jre entries) | I | 03 |
| `adoptium_os_alpine_when_musl_detected` (injected libc detector) | U | 03 |
| `install_runtime_downloads_verifies_extracts_and_verifies_version` (FakeJre tarball served by wiremock) | I | 03 |
| `install_runtime_sha256_mismatch_fails_and_cleans` | I | 03, 11 |
| `install_runtime_internal_symlink_allowed_external_rejected` | I | 03 |
| `install_runtime_idempotent_same_version` | I | 03 |
| `install_runtime_concurrent_same_major_single_download` | I | 03 |
| `remove_runtime_in_use_conflict_lists_servers` / `remove_system_runtime_not_managed` | I | 04 |
| `requirement_forge_1_12_2_is_strict_8` | U | 05 |
| `requirement_uses_mojang_major_version` (fixture 1.21.1 → 21, 1.18.2 → 17) | U | 05 |
| `requirement_fallback_table_by_release_time` (no meta source) | U | 05 |
| `requirement_1_17_uses_17` | U | 05 |
| `requirement_year_version_without_meta_is_unknown` | U | 05 |
| `requirement_proxy_rule_velocity_bungee_waterfall` | U | 05, 26 |
| `prop_fallback_table_monotonic_in_release_time` | P | 05 |
| `ensure_prefers_managed_exact_then_system_then_higher_nonstrict` | U | 06 |
| `ensure_strict_mismatch_manual_requires_override` | U | 06 |

## chunkyard-download (`crates/chunkyard-download/tests/downloader.rs`)

| Test | Kind | FR |
|---|---|---|
| `downloader_cache_hit_skips_network` | I | 11 |
| `downloader_hash_mismatch_errors_and_removes_part` | I | 11 |
| `downloader_truncated_body_errors` | I | 11 |
| `downloader_redirect_to_disallowed_host_rejected` | I | 11 |
| `downloader_429_retry_after_then_success` / `downloader_5xx_retries_exhausted` | I | 11 |
| `downloader_resume_with_range` | I | 11 |
| `downloader_over_1gib_content_length_rejected` | I | 11 |
| `downloader_lru_eviction_keeps_pinned` | I | 11 |
| `downloader_sends_user_agent_with_contact` | I | 11 |
| `downloader_rejects_private_ip_target_via_safe_http` | I | 11 |

## chunkyard-installers (`crates/chunkyard-installers/tests/*.rs`)

| Test | Kind | FR |
|---|---|---|
| `vanilla_versions_ordered_and_snapshot_filter` | I | 09, 12 |
| `vanilla_version_json_sha1_verified` | I | 12 |
| `vanilla_version_without_server_download_unavailable` | I | 12 |
| `vanilla_execute_produces_jar_launch` | I | 12 |
| `paper_v3_selects_latest_stable_build` | I | 10, 13 |
| `paper_v3_only_beta_builds_warns_experimental` | I | 13 |
| `paper_v3_404_falls_back_to_v2` / `paper_v3_parse_error_falls_back_to_v2` | I | 13 |
| `paper_both_apis_fail_upstream_error` | I | 13 |
| `purpur_skips_failed_builds_and_verifies_md5` | I | 14 |
| `fabric_downloads_launcher_and_predownloads_vanilla_and_writes_properties` | I | 15 |
| `fabric_loader_list_marks_stable` | I | 10, 15 |
| `quilt_runs_installer_shim_with_expected_args` (shim records argv via `FAKE_MC_CONTROL`) | I | 16, 19 |
| `forge_resolves_recommended_and_latest_from_promotions` | U | 10, 17 |
| `forge_legacy_full_version_string_used_in_url` (`1.7.10-10.13.4.1614-1.7.10`) | U | 17 |
| `forge_modern_installer_shim_yields_argsfile_launch` (shim writes `run.sh` with `@…unix_args.txt`) | I | 17, 28 |
| `forge_1_20_4_shim_jar_run_sh_yields_jar_launch` (shim writes `run.sh` with `-jar forge-…-shim.jar`) | I | 17, 28 |
| `forge_no_run_script_falls_back_to_era_table` | I | 17, 28 |
| `forge_1_16_5_yields_jar_launch` / `forge_1_12_2_universal_preferred` / `forge_ambiguous_jars_launch_not_found` | I | 17 |
| `forge_legacy_preplaces_vanilla_server_jar` | I | 17 |
| `forge_cleanup_moves_run_scripts_to_state_dir` (copied to `<data>/state/<id>/install/`, removed from server dir) | I | 17, 28 |
| `neoforge_version_to_mc_mapping` (`21.1.77` → 1.21.1, `21.0.3` → 1.21, `20.2.86` → 1.20.2, beta unstable) | U | 18 |
| `neoforge_1_20_1_uses_forge_artifact_path` | U | 18 |
| `neoforge_installer_shim_yields_argsfile_launch` | I | 18, 28 |
| `run_script_parse_fixtures` (`forge-1.17.1.sh`, `forge-1.20.1.sh` → ArgsFile; `forge-1.20.4.sh`, `forge-1.21.x.sh` → Jar; `neoforge-21.1.sh` → ArgsFile) | U | 28 |
| `run_script_ignores_user_jvm_args_and_dollar_at` | U | 28 |
| `run_script_quoting_single_double_backslash` | U | 28 |
| `run_script_bat_fallback_strips_percent_star` | U | 28 |
| `run_script_rejects_pipes_substitution_and_non_java_exec` | U | 28 |
| `run_script_path_escape_rejected` (`-jar ../../x.jar`) | U | 28 |
| `prop_run_script_parse_never_panics` | P | 28 |
| fuzz `run_script_parse` | F | 28 |
| `velocity_fill_v3_selects_stable_build_sha256` | I | 26 |
| `waterfall_plan_carries_eol_warning` | I | 26 |
| `bungeecord_jenkins_latest_build_no_hash_warning` | I | 26 |
| `proxy_install_writes_no_eula_or_server_properties_sets_stop_command` | I | 21, 26 |
| `proxy_config_bind_port_parsers` (velocity.toml `bind`, config.yml `listeners[0].host`; malformed → none) | U | 27 |
| `installer_process_nonzero_exit_reports_last_lines` | I | 19 |
| `installer_process_timeout_kills_group` (shim `stop_behaviour = "hang"`, timeout shortened via ctx) | I | 19 |
| `installer_cancel_kills_group_and_removes_staging` | I | 19 |
| `owned_paths_per_flavor_table` | U | 25 |

## chunkyard-api-tests (`crates/chunkyard-api-tests/tests/p3_*.rs`)

| Test | Kind | FR |
|---|---|---|
| `java_endpoints_admin_only` | A | 01–04 |
| `java_available_proxies_and_caches` | A | 02 |
| `java_install_job_progress_ws_and_row_created` | A | 03 |
| `java_requirement_endpoint_sources` | A | 05 |
| `installers_catalog_versions_builds_endpoints` | A | 08–10 |
| `installers_unknown_flavor_404` | A | 08 |
| `plan_has_no_side_effects_and_reports_cached_artifacts` | A | 20 |
| `create_paper_server_end_to_end_starts_with_fake_jre` (installs FakeJre 21 via Adoptium mock, downloads fake paper jar, fake-mc starts, SLP ok) | A | 03, 06, 13, 21 |
| `create_forge_server_runs_installer_and_launches_args_file` (asserts spawn argv contains `@libraries/.../unix_args.txt` and no `run.sh`) | A | 17, 19, 21, 28 |
| `create_server_installer_source_returns_server_job_warnings_shape` | A | 21 |
| `create_with_both_java_and_javapath_422` | A | 07, 21 |
| `create_velocity_proxy_starts_and_stops_with_shutdown_command` (fake-mc `flavor=velocity`) | A | 26 |
| `proxy_port_mismatch_emits_warning_event` | A | 27 |
| `reinstall_proxy_to_game_flavor_422_unsupported` | A | 22, 26 |
| `create_with_accept_eula_writes_eula_and_audits` | A | 21 |
| `create_install_failure_sets_last_install_error_and_cleans_staging` | A | 21 |
| `create_start_after_install_starts` | A | 21 |
| `install_streams_lines_to_console_topic_with_prefix` | A | 19 |
| `reinstall_requires_stopped_409` / `reinstall_busy_409` | A | 22 |
| `reinstall_downgrade_requires_confirmation_422` / `reinstall_flavor_change_requires_confirmation_422` | A | 22 |
| `reinstall_moves_owned_paths_to_state_previous_keeps_world_and_mods` | A | 22, 25 |
| `reinstall_keeps_only_three_previous` | A | 22 |
| `rollback_restores_previous_and_row_fields` | A | 23 |
| `previous_manifest_in_server_dir_is_ignored` (forged `servers/<id>/.mcm/previous` never listed) | A | 23 |
| `software_endpoint_reports_updates_and_tolerates_upstream_failure` | A | 24 |
| `start_with_missing_java_returns_409_java_installing_with_job` | A | 06 |
| `patch_java_runtime_strict_mismatch_needs_override` / `patch_java_path_mode_admin_only` | A | 07 |
| `interrupted_install_on_restart_marks_failed_and_cleans_tmp` | A | 21 |
| `p3_every_mutation_writes_audit_entry` / `p3_permission_matrix` | A | all |
| `dedupe_same_paper_build_two_servers_single_download` (wiremock request count = 1) | A | 11 |

## chunkyard-db

| Test | Kind | FR |
|---|---|---|
| `migration_p3_applies_on_phase2_snapshot` (`crates/chunkyard-db/tests/migrations.rs`) | I | all |
| `java_runtime_repo_crud_and_unique_path` | I | 01, 03 |

## chunkyard-core

| Test | Kind | FR |
|---|---|---|
| `flavor_table_proxies_have_stop_command_and_log_family` | U | 26 |

## Frontend (Vitest)

| Test | Kind | FR |
|---|---|---|
| `wizard.svelte.test.ts` — step gating, vanilla skips build step, plan fetched on review; proxies hide EULA | C | 20, 21, 26 |
| `VersionPicker.test.ts` — snapshot toggle, unavailable disabled, search | C | 09 |
| `BuildPicker.test.ts` — Forge recommended/latest labels, beta badges | C | 10 |
| `PlanReview.test.ts` — warnings, EULA checkbox required to submit when `startAfterInstall` | C | 20, 21 |
| `ChangeVersionDialog.test.ts` — downgrade/flavor confirmations required | C | 22 |
| `JavaSelect.test.ts` — override checkbox on strict mismatch; path mode hidden for non-admins | C | 07 |
| `FlavorPicker.test.ts` — proxies group, Waterfall EOL badge | C | 08, 26 |
| `RuntimeTable.test.ts` — delete disabled when used/system | C | 04 |
| `StartButton.test.ts` — 409 java.installing → waits for job → retries start | C | 06 |

## E2E (`e2e/tests/p3-*.spec.ts`, upstream mocks + FakeJre)

| Test | FR |
|---|---|
| `p3-create › paper server via wizard, java auto-downloaded, starts, console shows Done` | 03, 06, 13, 21 |
| `p3-create › forge server shows [install] output and cancel works` | 17, 19 |
| `p3-version › update paper build from Software card; rollback restores previous` | 22, 23, 24 |
| `p3-java › admin installs Java 17, cannot delete while used` | 03, 04 |
| `p3-create › velocity proxy via wizard starts, console shows Done` | 26 |
| axe scan of wizard and `/admin/java` | — |

## Real-server smoke (`crates/chunkyard-server/tests/smoke_*.rs`)

`smoke_vanilla_latest`, `smoke_paper_latest`, `smoke_fabric_1_20_1`, `smoke_forge_1_20_1`, `smoke_forge_1_21` (launch parsed from real `run.sh`; captures run-script fixtures), `smoke_neoforge_latest`, `smoke_legacy_1_12_2_java8` — see [e2e.md](../../testing/e2e.md#real-server-smoke-suite-opt-in). Also `smoke_quilt_latest`, `smoke_velocity_latest` (added by this phase) and `smoke_paper_v3_contract` (asserts fill v3 response shape matches our model; resolves the open question).
