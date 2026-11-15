# Phase 4 — Test plan

Fixtures per [testing/fixtures.md](../../testing/fixtures.md) under `crates/chunkyard-modplatforms/tests/fixtures/{curseforge,modrinth,hangar}/`. Synthetic packs built by helpers in `chunkyard-testkit::packs` (`CfClientPackBuilder`, `CfServerPackBuilder` incl. `::server_starter()` (ServerStarter-style zip, see [import-pipeline.md](import-pipeline.md#starter-detection)), `MrpackBuilder`, `JarBuilder` that writes `fabric.mod.json` / `mods.toml` / `plugin.yml`). Loader installs use the phase-3 fake installers (fake-mc installer shim).

## Rust — `chunkyard-modplatforms` unit (inline)

| Test | File | FR | Kind |
|---|---|---|---|
| `fingerprint_strips_whitespace_bytes_before_hashing` | curseforge/fingerprint.rs | 15, 17 | unit |
| `fingerprint_matches_known_vectors` | curseforge/fingerprint.rs | 17 | unit |
| `cf_manifest_valid_parses_loader_and_files` | pack/cf_client_pack.rs | 11 | unit |
| `cf_manifest_wrong_type_is_invalid` | pack/cf_client_pack.rs | 11 | unit |
| `cf_manifest_multiple_loaders_picks_primary` | pack/cf_client_pack.rs | 11 | unit |
| `loader_id_neoforge_1_20_1_maps_to_forge_artifact` | pack/detect_loader.rs | 10, 11 | unit |
| `detect_loader_from_variables_txt` | pack/detect_loader.rs | 10 | unit |
| `detect_loader_from_forge_libraries_dir` | pack/detect_loader.rs | 10 | unit |
| `detect_loader_from_neoforge_libraries_dir` | pack/detect_loader.rs | 10 | unit |
| `detect_loader_fabric_launch_jar` | pack/detect_loader.rs | 10 | unit |
| `detect_loader_unknown_is_unsupported` | pack/detect_loader.rs | 10 | unit |
| `strip_single_top_level_dir_only_when_sole_entry` | pack/cf_server_pack.rs | 10 | unit |
| `flow_selection_server_pack_file_uses_server_flow` | pack/plan.rs | 9 | unit |
| `flow_selection_prefer_server_pack_false_uses_client_flow` | pack/plan.rs | 9 | unit |
| `plan_null_download_url_becomes_manual` | pack/plan.rs | 15 | unit |
| `plan_allow_mod_distribution_false_becomes_manual` | pack/plan.rs | 15 | unit |
| `plan_optional_files_excluded_unless_opted_in` | pack/plan.rs | 11 | unit |
| `plan_duplicate_paths_last_wins_with_warning` | pack/plan.rs | 12 | unit |
| `plan_scripts_listed_as_inert_warnings` | pack/plan.rs | 10 | unit |
| `mrpack_index_skips_server_unsupported` | pack/mrpack.rs | 12 | unit |
| `mrpack_index_missing_env_treated_as_required` | pack/mrpack.rs | 12 | unit |
| `mrpack_path_traversal_is_invalid_manifest` | pack/mrpack.rs | 12 | unit |
| `mrpack_download_host_not_allowed_is_skipped` | pack/mrpack.rs | 12 | unit |
| `mrpack_two_loaders_is_invalid` | pack/mrpack.rs | 12 | unit |
| `client_only_cf_client_tag_is_strong_signal` | client_only.rs | 14 | unit |
| `client_only_modrinth_server_supported_overrides_cf_tag` | client_only.rs | 14 | unit |
| `client_only_jar_environment_client_not_overridden` | client_only.rs | 14 | unit |
| `client_only_denylist_matches_by_mod_id` | client_only.rs | 14 | unit |
| `client_only_weak_signal_alone_not_suspect` | client_only.rs | 14 | unit |
| `denylist_file_parses_and_has_notes` | client_only.rs | 14 | unit |
| `jarmeta_reads_fabric_quilt_forge_neoforge_bukkit_paper` | jarmeta.rs | 21 | unit |
| `jarmeta_corrupt_jar_returns_none_not_error` | jarmeta.rs | 21 | unit |
| `deps_closure_includes_required_only` | content/deps.rs | 22 | unit |
| `deps_closure_cycle_terminates` | content/deps.rs | 22 | unit |
| `deps_closure_depth_limit_five` | content/deps.rs | 22 | unit |
| `deps_incompatible_relation_reported_as_conflict` | content/deps.rs | 22 | unit |
| `target_dir_by_kind_and_flavor` | content/service.rs | 23 | unit |
| `target_dir_plugin_on_fabric_is_incompatible` | content/service.rs | 23 | unit |
| `search_cursor_beyond_10000_returns_empty` | curseforge/map.rs | 5 | unit |
| `modrinth_facets_built_for_server_side_filter` | modrinth/map.rs | 5 | unit |
| `hangar_mod_kind_is_unsupported` | hangar/map.rs | 5 | unit |
| `starter_server_setup_config_yaml_is_starter` | pack/starter.rs | 30 | unit |
| `starter_script_with_curl_or_installer_is_starter` | pack/starter.rs | 30 | unit |
| `starter_forge_generated_run_sh_is_not_starter` | pack/starter.rs | 30 | unit |
| `starter_near_empty_mods_vs_manifest_is_starter` | pack/starter.rs | 30 | unit |
| `starter_full_mods_dir_is_not_starter` | pack/starter.rs | 30 | unit |
| `untrusted_manifest_over_8_mib_rejected` | pack/untrusted.rs | 31 | unit |
| `untrusted_pack_never_yields_custom_launch_or_java_path` | pack/untrusted.rs | 31 | unit |
| `untrusted_pack_properties_cannot_set_managed_keys` | pack/untrusted.rs | 31 | unit |
| `prop_manifest_parse_never_panics` | pack/cf_client_pack.rs | 11 | property |
| `prop_mrpack_paths_never_escape` | pack/mrpack.rs | 12 | property |

## Rust — `chunkyard-modplatforms` integration (`crates/chunkyard-modplatforms/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `curseforge_sends_api_key_header_only_to_api_host` | curseforge_client.rs | 1, Sec | wiremock |
| `curseforge_403_maps_to_api_key_invalid` | curseforge_client.rs | 2 | wiremock |
| `curseforge_batch_files_chunks_requests` | curseforge_client.rs | 11 | wiremock |
| `curseforge_429_retries_then_rate_limited` | curseforge_client.rs | 3 | wiremock |
| `modrinth_sends_user_agent` | modrinth_client.rs | 3 | wiremock |
| `modrinth_low_remaining_waits_before_request` | modrinth_client.rs | 3 | wiremock, real time (wait shortened via client option `min_wait = 50ms`) |
| `modrinth_version_files_lookup_by_sha1` | modrinth_client.rs | 14, 26 | wiremock |
| `hangar_versions_filter_platform_paper` | hangar_client.rs | 7 | wiremock |
| `meta_cache_serves_second_search_without_request` | cache.rs | 4 | wiremock |
| `all_requests_go_through_safe_http` (private-IP base URL rejected without `test-hooks` allowance) | safe_http.rs | 3, Sec | wiremock |
| `import_cf_server_pack_installs_loader_and_keeps_mods` | pack_import.rs | 8, 9, 10, 19 | wiremock + fake installer |
| `import_cf_server_pack_merges_properties_and_ignores_eula` | pack_import.rs | 10 | integration |
| `import_cf_client_pack_downloads_files_and_overrides` | pack_import.rs | 11 | integration |
| `import_cf_client_pack_disables_client_only` | pack_import.rs | 14 | integration |
| `import_cf_with_restricted_files_needs_manual` | pack_import.rs | 15, 16 | integration |
| `import_hash_mismatch_retries_then_fails` | pack_import.rs | 10, 12 | wiremock |
| `import_missing_required_file_fails_unless_allow_missing` | pack_import.rs | 11 | integration |
| `import_mrpack_from_upload_applies_server_overrides_last` | pack_import.rs | 12 | integration |
| `import_mrpack_sha512_verified` | pack_import.rs | 12 | integration |
| `import_pack_zip_bomb_rejected` | pack_import.rs | 12, Sec | integration |
| `import_cancel_removes_server_dir` | pack_import.rs | 20 | integration |
| `import_plan_persisted_before_downloads` | pack_import.rs | 13 | integration |
| `import_cf_server_pack_with_starter_falls_back_to_client_conversion` | pack_import.rs | 30 | wiremock + fake installer |
| `import_uploaded_starter_pack_without_manifest_fails_with_hint` | pack_import.rs | 30 | integration |
| `import_report_written_to_state_dir_not_server_dir` | pack_import.rs | 20, 31 | integration |
| `content_scan_adds_manual_rows_and_drops_vanished` | content.rs | 21 | integration |
| `content_install_with_required_dependency` | content.rs | 22 | wiremock |
| `content_toggle_renames_disabled_suffix` | content.rs | 24 | integration |
| `content_remove_reports_dependents` | content.rs | 25 | integration |
| `content_update_failure_restores_old_file` | content.rs | 27 | wiremock |
| `update_check_modrinth_batch_and_cf_files` | content.rs | 26 | wiremock |

## Rust — `chunkyard-db` (`crates/chunkyard-db/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `content_repo_rejects_modpack_kind` | p4_content_repo.rs | 21 | integration (SQLite) |
| `pending_repo_filters_by_server_and_state` | p4_content_repo.rs | 15, 17 | integration (SQLite) |

## Rust — API (`crates/chunkyard-api-tests/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `integrations_put_key_validates_and_hides_value` | p4_integrations.rs | 1 | API |
| `integrations_delete_env_key_conflict` | p4_integrations.rs | 1 | API |
| `integrations_require_admin` | p4_integrations.rs | 1 | API |
| `search_curseforge_without_key_424` | p4_browse.rs | 2, 5 | API |
| `search_modrinth_returns_page_and_cursor` | p4_browse.rs | 5 | API |
| `project_and_versions_shapes_snapshot` | p4_browse.rs | 6, 7 | API + insta |
| `import_pack_requires_server_create` | p4_packs.rs | 8 | API |
| `import_pack_returns_202_with_server_job_warnings` | p4_packs.rs | 8 | API |
| `post_servers_pack_source_matches_import_pack_shape` | p4_packs.rs | 8 | API + insta |
| `import_pack_starter_fallback_warning_in_job_result` | p4_packs.rs | 30 | API |
| `import_preview_returns_plan` | p4_packs.rs | 13 | API |
| `start_blocked_while_pending_downloads_unless_force` | p4_packs.rs | 16 | API + fake-mc |
| `resolve_pending_by_sha1_moves_file` | p4_packs.rs | 17 | API |
| `resolve_pending_by_fingerprint_renames_file` | p4_packs.rs | 17 | API |
| `resolve_unmatched_upload_422_and_file_deleted` | p4_packs.rs | 17, Sec | API |
| `resolve_zip_of_jars_matches_each_entry` | p4_packs.rs | 17 | API |
| `skip_last_pending_triggers_finalize_job` | p4_packs.rs | 18 | API |
| `import_memory_suggestion_applied_only_when_unset` | p4_packs.rs | 19 | API |
| `import_explicit_memory_wins_with_warning` | p4_packs.rs | 19 | API |
| `content_list_requires_server_view` | p4_content.rs | 21 | API |
| `content_plan_reports_conflict` | p4_content.rs | 22 | API |
| `content_install_plugin_on_fabric_409` | p4_content.rs | 23 | API |
| `content_toggle_while_running_flags_restart_required` | p4_content.rs | 24, 28 | API + WS |
| `pack_info_update_available_informational` | p4_content.rs | 29 | API |
| `p4_mutations_write_audit_entries` (names from audit catalog, incl. `integrations.curseforge.update`) | p4_audit.rs | all | API |
| `content_page_native_notice_warning_returned` | p4_content.rs | Sec (D1) | API |
| `p4_no_secrets_in_logs_curseforge_key` | p4_audit.rs | 1, Sec | API + capture_logs |

## Repo-wide checks

| Test | Location | FR |
|---|---|---|
| `no_forgecdn_url_construction` | `xtask` lint (greps `crates/` for `forgecdn` outside `tests/fixtures`) | Policy |
| Fuzz `cf_manifest_parse`, `mrpack_index_parse`, `jar_meta_parse` | `fuzz/fuzz_targets/` | 11, 12, 21 |

## Frontend (Vitest)

| Test | File | FR |
|---|---|---|
| `BrowseState › debounces query and resets cursor on filter change` | features/content/browse.svelte.test.ts | 5 |
| `SafeMarkdown › strips script, iframe, style and on* attributes` | features/content/components/SafeMarkdown.test.ts | 6, Sec |
| `PlatformTabs › hides Hangar for non-Paper servers` | PlatformTabs.test.ts | 5 |
| `CurseForge tab › shows key-missing empty state on 424` | PlatformTabs.test.ts | 2 |
| `InstallPlanDialog › lists dependencies and requires confirm for conflicts` | InstallPlanDialog.test.ts | 22 |
| `InstalledTable › optimistic toggle rolls back on error` | InstalledTable.test.ts | 24 |
| `SideBadge › shows reasons tooltip for client_suspected` | SideBadge.test.ts | 14 |
| `PlanReview › shows manual-download explanation and counts` | PlanReview.test.ts | 13, 15 |
| `ManualDropzone › reports matched and unmatched files` | ManualDropzone.test.ts | 17 |
| `ImportProgress › renders stages from job messages` | ImportProgress.test.ts | 8 |
| `ImportReport › shows starter fallback banner for pack.server_pack_starter_fallback` | ImportReport.test.ts | 30 |
| `MemoryField › leaves memory unset when user does not touch the suggestion` | MemoryField.test.ts | 19 |
| `CurseForgeKeyCard › read-only when set by env` | CurseForgeKeyCard.test.ts | 1 |

## E2E (`e2e/tests/p4-packs.spec.ts`, `p4-content.spec.ts`)

| Test | FR / story |
|---|---|
| `admin sets CurseForge key and browses packs` | US-1, FR-01, 05 |
| `import CurseForge server pack and start server` | US-2, FR-08–10 |
| `starter server pack falls back to client conversion with banner` | US-9, FR-30 |
| `import pack with restricted mods via manual upload` | US-3, FR-15–18 |
| `upload mrpack creates server` | US-4, FR-12 |
| `install Modrinth mod with dependency on Fabric server` | US-5, FR-22 |
| `install Hangar plugin on Paper server` | US-6, FR-22, 23 |
| `installed list shows dropped-in jar and toggles it` | US-7, FR-21, 24 |
| `client-only mod disabled and re-enabled` | US-8, FR-14, 24 |

## Smoke (nightly, real network)

`smoke_curseforge_server_pack`, `smoke_mrpack_import` ([testing/e2e.md](../../testing/e2e.md#real-server-smoke-suite-opt-in)).
