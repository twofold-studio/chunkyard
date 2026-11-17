# Phase 0 — Test plan

Time: `FakeClock`/paused time only where marked and only for logic without real processes (P0 has none).

Kinds: U = unit, P = property, I = crate integration, A = API integration (`crates/api-tests/tests/p0_*.rs` via `TestApp`, built with `test-hooks`), S = snapshot, C = frontend component, V = Vitest unit, E = Playwright E2E, X = xtask/CI.

## Rust

| Test | Location | FR | Kind |
|---|---|---|---|
| `workspace_members_match_p0_crate_list` (cargo metadata) | `xtask/tests/workspace.rs` | 01 | X |
| `ci_workflow_declares_required_jobs` (parses `.github/workflows/*.yml`) | `xtask/tests/workflows.rs` | 03 | X |
| `docker_image_healthcheck_passes` (`docker build` + `docker run` + `curl /healthz`) | CI job `docker-build` | 35 | X |
| `systemd_unit_has_hardening_keys` | `xtask/tests/packaging.rs` | 35 | X |
| `contributing_md_has_required_sections` | `xtask/tests/docs.rs` | 36 | X |
| `check_deps_forbidden_edge_fails` | `xtask/src/check_deps.rs` (uses a synthetic metadata JSON) | 02 | U |
| `check_deps_axum_outside_api_fails` | `xtask/src/check_deps.rs` | 02 | U |
| `check_deps_current_workspace_passes` | `xtask/tests/workspace.rs` | 02 | X |
| `coverage_gate_below_threshold_fails` | `xtask/src/coverage_gate.rs` | 02 | U |
| `config_defaults_are_valid` | `config/src/lib.rs` | 04 | U |
| `config_env_overrides_file` | `config/tests/load.rs` | 04 | I |
| `config_unknown_key_is_rejected` | `config/tests/load.rs` | 04 | I |
| `config_validate_reports_all_errors` | `config/src/validate.rs` | 04 | U |
| `config_insecure_public_url_requires_flag` | `config/src/validate.rs` | 04 | U |
| `config_non_loopback_listen_requires_public_url` | `config/src/validate.rs` | 04 | U |
| `config_non_config_mcm_env_vars_ignored` (`CHUNKYARD_CONFIG`, `CHUNKYARD_SMOKE`, `CHUNKYARD_TEST_FOO`, `CHUNKYARD_CURSEFORGE_TEST_KEY` set → loads) | `config/tests/load.rs` | 04 | I |
| `config_unknown_sectioned_env_var_rejected` (`CHUNKYARD_HTTP__BOGUS`) | `config/tests/load.rs` | 04 | I |
| `startup_creates_data_tree_with_modes` | `server/tests/startup.rs` | 05 | I |
| `startup_second_instance_fails_on_lock` | `server/tests/startup.rs` | 05 | I |
| `secret_key_created_0600_and_reused` | `server/tests/startup.rs` | 06 | I |
| `secret_key_world_readable_refuses_start` | `server/tests/startup.rs` | 06 | I |
| `secret_box_roundtrip_with_aad` | `core/src/crypto.rs` | 06 | U |
| `secret_box_wrong_aad_fails` | `core/src/crypto.rs` | 06 | U |
| `secret_box_ciphertext_swapped_between_rows_fails` (AAD `users.totp_secret_enc:<id>`) | `core/src/crypto.rs` | 06 | U |
| `aad_format_is_table_column_row_id` | `core/src/crypto.rs` | 06 | U |
| `secret_box_tampered_ciphertext_fails` | `core/src/crypto.rs` | 06 | P |
| `secret_debug_is_redacted` | `core/src/secret.rs` | 06 | U |
| `shutdown_drains_inflight_request` | `server/tests/shutdown.rs` | 07 | I |
| `migrations_apply_on_empty_db` | `db/tests/migrate.rs` | 08 | I |
| `db_pragmas_wal_and_foreign_keys_on` | `db/tests/migrate.rs` | 08 | I |
| `user_repo_username_case_insensitive_unique` | `db/tests/users.rs` | 08 | I |
| `session_repo_crud_and_expiry_query` | `db/tests/sessions.rs` | 08 | I |
| `token_repo_lookup_by_hash` | `db/tests/tokens.rs` | 08 | I |
| `job_repo_state_transitions_persist` | `db/tests/jobs.rs` | 08, 22 | I |
| `audit_repo_filters_and_cursor_paging` | `db/tests/audit.rs` | 08, 24 | I |
| `sweeper_removes_expired_sessions_and_old_jobs` | `server/tests/sweeper.rs` (FakeClock) | 09 | I |
| `setup_mode_blocks_api_routes` | `api-tests/p0_setup.rs` | 10 | A |
| `setup_token_file_created_0600` | `api-tests/p0_setup.rs` | 10 | A |
| `setup_with_valid_token_creates_owner_and_session` | `api-tests/p0_setup.rs` | 11 | A |
| `setup_with_wrong_token_is_401` | `api-tests/p0_setup.rs` | 11 | A |
| `setup_concurrent_requests_single_owner` | `api-tests/p0_setup.rs` | 11 | A |
| `setup_after_done_is_409` | `api-tests/p0_setup.rs` | 11 | A |
| `password_hash_verify_roundtrip` | `auth/src/password.rs` | 12 | U |
| `password_rehash_when_params_change` | `auth/src/password.rs` | 12 | U |
| `login_success_sets_cookie_attributes` | `api-tests/p0_auth.rs` | 12 | A |
| `login_unknown_user_and_bad_password_same_response` | `api-tests/p0_auth.rs` | 12 | A |
| `login_disabled_user_is_401` | `api-tests/p0_auth.rs` | 12 | A |
| `throttle_after_five_failures_returns_429_with_retry_after` | `auth/src/throttle.rs` (FakeClock) | 13 | U |
| `throttle_keyed_by_ip_and_username` | `auth/src/throttle.rs` | 13 | U |
| `throttle_per_ip_cap_across_usernames` | `auth/src/throttle.rs` | 13 | U |
| `throttle_failures_from_other_ip_do_not_block_owner` (two IPs via `X-Forwarded-For` from a trusted proxy) | `api-tests/p0_auth.rs` | 13 | A |
| `throttle_success_resets_counters` | `auth/src/throttle.rs` | 13 | U |
| `throttle_map_is_bounded` | `auth/src/throttle.rs` | 13 | U |
| `logout_deletes_session` | `api-tests/p0_auth.rs` | 14 | A |
| `me_returns_principal_kind_for_token` | `api-tests/p0_auth.rs` | 14, 16 | A |
| `password_change_revokes_other_sessions` | `api-tests/p0_auth.rs` | 15 | A |
| `password_change_rejects_common_password` | `auth/src/policy.rs` | 15 | U |
| `password_change_with_bearer_is_403` | `api-tests/p0_auth.rs` | 15 | A |
| `password_change_wrong_current_is_403_reauth_failed_and_session_kept` | `api-tests/p0_auth.rs` | 15 | A |
| `session_idle_expiry_enforced` | `api-tests/p0_auth.rs` (FakeClock) | 16 | A |
| `session_absolute_expiry_enforced` | `api-tests/p0_auth.rs` | 16 | A |
| `bearer_expired_token_is_401` | `api-tests/p0_auth.rs` | 16 | A |
| `csrf_missing_header_is_403` | `api-tests/p0_csrf.rs` | 17 | A |
| `csrf_foreign_origin_is_403` | `api-tests/p0_csrf.rs` | 17 | A |
| `csrf_not_required_for_bearer` | `api-tests/p0_csrf.rs` | 17 | A |
| `setup_csrf_accepts_host_origin_on_loopback_without_public_url` | `api-tests/p0_csrf.rs` | 17, 11 | A |
| `setup_csrf_rejects_foreign_origin_and_missing_header` | `api-tests/p0_csrf.rs` | 17 | A |
| `csrf_uses_public_url_origin_when_configured` | `api-tests/p0_csrf.rs` | 17 | A |
| `authorize_decision_table` (table-driven: role × scopes × perm) | `auth/src/authorize.rs` | 18 | U |
| `authorize_token_scopes_never_exceed_user` | `auth/src/authorize.rs` | 18 | P |
| `token_create_returns_secret_once` | `api-tests/p0_tokens.rs` | 19 | A |
| `token_list_never_contains_secret` | `api-tests/p0_tokens.rs` | 19 | A |
| `token_revoked_is_401` | `api-tests/p0_tokens.rs` | 19 | A |
| `token_cannot_create_token` | `api-tests/p0_tokens.rs` | 19 | A |
| `token_limit_is_409` | `api-tests/p0_tokens.rs` | 19 | A |
| `token_invalid_scope_is_422` | `api-tests/p0_tokens.rs` | 19 | A |
| `cli_reset_password_sets_must_change` | `server/tests/cli.rs` | 20 | I |
| `cli_reset_password_disable_2fa_clears_totp_and_codes` | `server/tests/cli.rs` | 20, 37 | I |
| `must_change_password_blocks_mutations` | `api-tests/p0_auth.rs` | 20 | A |
| `job_runner_respects_concurrency_limit` | `core/src/jobs/runner.rs` | 21 | U |
| `job_runner_per_server_lock_serialises` | `core/src/jobs/runner.rs` | 21 | U |
| `job_progress_rate_limited_to_4hz` | `core/src/jobs/ctx.rs` (paused time; pure logic) | 21 | U |
| `job_cancel_sets_cancelled` | `api-tests/p0_jobs.rs` | 21, 22 | A |
| `job_cancel_finished_is_409` | `api-tests/p0_jobs.rs` | 22 | A |
| `job_running_at_startup_marked_interrupted` | `server/tests/startup.rs` | 22 | I |
| `job_handler_panic_marks_failed` | `core/src/jobs/runner.rs` | 22 | U |
| `router_without_test_hooks_has_no_debug_routes` (compiled `#[cfg(not(feature = "test-hooks"))]`, run by CI step `cargo test -p chunkyard-server --lib --no-default-features --features embed-ui`) | `server/src/routes.rs` | 23 | U |
| `release_binary_lacks_test_hooks` (`mcm version --features`) | CI job `release-features` | 23 | X |
| `debug_job_route_available_with_test_hooks` | `api-tests/p0_jobs.rs` | 23 | A |
| `audit_records_login_success_and_failure` | `api-tests/p0_audit.rs` | 24, 12 | A |
| `audit_catalog_names_are_unique_and_well_formed` | `core/src/audit.rs` | 24 | U |
| `audit_details_only_contain_allow_listed_fields` (fuzzed input maps per action) | `core/src/audit.rs` | 24 | P |
| `audit_action_enum_in_openapi` | `api-tests/p0_openapi.rs` | 24, 30 | A |
| `audit_list_admin_only` | `api-tests/p0_audit.rs` | 24 | A |
| `ws_requires_auth` | `api-tests/p0_ws.rs` | 25 | A |
| `ws_bad_origin_rejected` | `api-tests/p0_ws.rs` | 25 | A |
| `ws_subscribe_jobs_receives_updates` | `api-tests/p0_ws.rs` | 25, 22 | A |
| `ws_unknown_topic_returns_error_and_keeps_connection` | `api-tests/p0_ws.rs` | 25 | A |
| `ws_ping_pong` | `api-tests/p0_ws.rs` | 25 | A |
| `ws_subscription_limit_enforced` | `api-tests/p0_ws.rs` | 25 | A |
| `ws_slow_consumer_closed_1013` | `api-tests/p0_ws.rs` | 25 | A |
| `ws_closed_on_sessions_revoked` | `api-tests/p0_ws.rs` | 25, 15 | A |
| `ws_envelope_serde_snapshot` | `api/src/ws/msg.rs` | 25 | S |
| `healthz_ok_in_setup_mode` | `api-tests/p0_system.rs` | 26 | A |
| `system_info_hides_path_for_non_admin` | `api-tests/p0_system.rs` | 26 | A |
| `rate_limit_auth_routes_per_ip` | `api-tests/p0_ratelimit.rs` | 27 | A |
| `client_ip_from_trusted_proxy_only` | `api/src/client_ip.rs` | 27 | U |
| `security_headers_present` (exact values from security.md) | `api-tests/p0_headers.rs` | 28 | A |
| `csp_header_on_html_contains_index_html_hashes` | `server/tests/spa.rs` | 28 | I |
| `csp_meta_missing_fails_startup` | `server/tests/spa.rs` | 28 | I |
| `csp_header_absent_on_api_json` | `api-tests/p0_headers.rs` | 28 | A |
| `tls_listener_serves_with_provided_cert` | `server/tests/tls.rs` (rcgen cert) | 29 | I |
| `openapi_document_snapshot` | `api-tests/p0_openapi.rs` | 30 | S |
| `openapi_every_route_documented` | `api-tests/p0_openapi.rs` (compare router paths vs spec) | 30 | A |
| `spa_fallback_serves_index_for_deep_link` | `server/tests/spa.rs` | 33 | I |
| `spa_immutable_assets_cached_forever` | `server/tests/spa.rs` | 33 | I |
| `spa_api_404_is_problem_json` | `server/tests/spa.rs` | 33 | I |
| `spa_serves_brotli_when_accepted` | `server/tests/spa.rs` | 33 | I |
| `cli_version_prints_target` | `server/tests/cli.rs` | 34 | I |
| `cli_config_check_invalid_exits_1` | `server/tests/cli.rs` | 34 | I |
| `cli_openapi_matches_served_spec` | `server/tests/cli.rs` | 30, 34 | I |
| `totp_verify_accepts_window_plus_minus_one` | `auth/src/totp.rs` (FakeClock) | 38 | U |
| `totp_rejects_reused_step` | `auth/src/totp.rs` | 38 | U |
| `totp_enroll_confirm_enables_and_returns_ten_codes` | `api-tests/p0_totp.rs` | 37 | A |
| `totp_confirm_wrong_code_does_not_enable` | `api-tests/p0_totp.rs` | 37 | A |
| `totp_enroll_when_enabled_is_409` | `api-tests/p0_totp.rs` | 37 | A |
| `totp_disable_wrong_password_is_403_reauth_failed` | `api-tests/p0_totp.rs` | 37 | A |
| `recovery_codes_regenerate_invalidates_old` | `api-tests/p0_totp.rs` | 37 | A |
| `totp_secret_encrypted_at_rest` | `db/tests/users.rs` | 37 | I |
| `login_with_totp_returns_challenge_then_session` | `api-tests/p0_totp.rs` | 38, 12 | A |
| `login_totp_challenge_single_use` | `api-tests/p0_totp.rs` | 38 | A |
| `login_totp_challenge_expires_after_5_min` (FakeClock via test-hooks) | `api-tests/p0_totp.rs` | 38 | A |
| `recovery_code_login_consumes_code` | `api-tests/p0_totp.rs` | 38 | A |
| `totp_step_throttled_like_password` | `api-tests/p0_totp.rs` | 38, 13 | A |
| `sessions_list_marks_current_and_hides_hash` | `api-tests/p0_sessions.rs` | 39 | A |
| `session_revoke_other_session_invalidates_it` | `api-tests/p0_sessions.rs` | 39 | A |
| `sessions_revoke_others_keeps_current` | `api-tests/p0_sessions.rs` | 39 | A |
| `sessions_endpoints_reject_bearer` | `api-tests/p0_sessions.rs` | 39 | A |
| `session_revoke_closes_its_ws_1008` | `api-tests/p0_ws.rs` | 39, 25 | A |
| `me_reports_totp_enabled` | `api-tests/p0_auth.rs` | 40 | A |
| `no_secrets_in_logs` (incl. TOTP secrets, recovery codes, challenges) | `api-tests/p0_logging.rs` | sec, 40 | A |

Note: SPA tests embed a tiny fixture build (`server/tests/fixtures/web-build/`) via a test-only `rust-embed` folder override, so they don't require `pnpm build`.

## Frontend (Vitest)

| Test | File | FR | Kind |
|---|---|---|---|
| `client › adds X-MCM-CSRF header on mutations` | `lib/api/client.test.ts` | 31 | V |
| `client › maps problem+json to ApiProblem` | `lib/api/client.test.ts` | 31 | V |
| `client › 401 redirects to /login with next` | `lib/api/client.test.ts` | 31 | V |
| `ws › reconnects with jittered backoff` | `lib/ws/client.svelte.test.ts` | 32 | V |
| `ws › resubscribes topics after reconnect` | `lib/ws/client.svelte.test.ts` | 32 | V |
| `ws › correlates ack/error by id` | `lib/ws/client.svelte.test.ts` | 32 | V |
| `auth schema › shared validation vectors` | `features/auth/schema.test.ts` | 12, 15 | V |
| `LoginForm › shows throttle countdown` | `features/auth/components/LoginForm.test.ts` | 13 | C |
| `LoginForm › rejects external next param` | `features/auth/components/LoginForm.test.ts` | sec | C |
| `LoginForm › switches to TotpStep on totp_required` | `features/auth/components/LoginForm.test.ts` | 38 | C |
| `TotpStep › recovery code mode sends recoveryCode` | `features/auth/components/TotpStep.test.ts` | 38 | C |
| `TotpEnrollDialog › confirm shows recovery codes and requires acknowledgement` | `features/auth/totp/components/TotpEnrollDialog.test.ts` | 37 | C |
| `ChangePasswordForm › reauth_failed shows field error and stays logged in` | `features/auth/components/ChangePasswordForm.test.ts` | 15 | C |
| `SessionList › revoke row and revoke others` | `features/auth/sessions/components/SessionList.test.ts` | 39 | C |
| `theme-init › applies stored theme class before app boot` | `static/theme-init.test.ts` | 31 | V |
| `SetupForm › password confirmation mismatch` | `features/auth/components/SetupForm.test.ts` | 11 | C |
| `CreateTokenDialog › sends scopes and expiry` | `features/tokens/components/CreateTokenDialog.test.ts` | 19 | C |
| `TokenRevealDialog › requires confirmation to close` | `features/tokens/components/TokenRevealDialog.test.ts` | 19 | C |
| `jobs store › updates from ws events` | `features/jobs/jobs.svelte.test.ts` | 21 | V |
| `AuditTable › loads more with cursor` | `features/audit/components/AuditTable.test.ts` | 24 | C |

## E2E (Playwright, `e2e/tests/p0-*.spec.ts`)

| Test | FR |
|---|---|
| `p0-setup › completes setup with token from data dir and lands on dashboard` | 10, 11 |
| `p0-auth › login, logout, wrong password message` | 12, 14 |
| `p0-auth › change password logs out other context` | 15 |
| `p0-tokens › create token, use it with request API, revoke` | 19 |
| `p0-2fa › enroll TOTP (code computed from secret in test), log out, log in with code, log in with recovery code` | 37, 38 |
| `p0-sessions › second browser context appears in list and is revoked` | 39 |
| `p0-csp › zero CSP violations on setup, login, account, audit (fixture-level check also runs on every test)` | 28, 31 |
| `p0-audit › audit page lists login events` | 24 |
| `p0-shell › theme toggle persists across reload` | 31 |
| `p0-shell › deep link reload serves SPA` | 33 |
| `p0-a11y › axe has no serious violations on setup/login/account/audit` | exit |

## Coverage of FRs

FR-01, FR-02 (also unit-tested), FR-03, FR-35, FR-36 are verified by CI itself (workspace builds, workflows run, Docker image build job `docker-build` runs `docker build` and `docker run … curl /healthz`). FR-31 additionally by `pnpm check`.
