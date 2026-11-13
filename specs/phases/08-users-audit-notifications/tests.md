# Phase 8 — Test plan

Kinds: U unit, P property, I integration (crate), A API integration (`crates/mcm-api-tests/tests/p8_*.rs` via `TestApp`), C component (Vitest), E E2E (Playwright), F fuzz. Time: `FakeClock` only for pure logic (expiry, retention, backoff schedule); tests with fake-mc or wiremock use real time with short configured timeouts ([patterns.md §10](../../architecture/patterns.md#10-test-layout-rust)). Deferred 8b SFTP has no tests in this phase.

## mcm-auth

| Test | Location | FR | Kind |
|---|---|---|---|
| `authorize_table_role_grants_scopes_servers_runtime` (≥ 80 rows: owner/admin/user × grants × token scopes × serverIds × runtime × perm) | `mcm-auth/src/authorize.rs` | 09, 10, 16, 17 | U |
| `authorize_token_scope_never_exceeds_user` | `mcm-auth/src/authorize.rs` | 17 | P |
| `requires_admin_trust_table` (each perm × native/shim/docker) | `mcm-auth/src/trust.rs` | 10 | U |
| `authorize_denies_stale_admin_trust_grant_on_native` | `mcm-auth/src/authorize.rs` | 10 | U |
| `normalize_permissions_adds_implied` | `mcm-auth/src/permissions.rs` | 12 | U |
| `normalize_permissions_is_idempotent` | `mcm-auth/src/permissions.rs` | 12 | P |
| `trust_check_applies_after_normalization` (e.g. none of the implied perms bypass) | `mcm-auth/src/trust.rs` | 10, 12 | P |
| `presets_match_documented_sets` | `mcm-auth/src/presets.rs` | 11 | U |
| `manager_preset_grantable_only_on_docker_for_users` | `mcm-auth/src/presets.rs` | 11 | U |
| `hierarchy_admin_cannot_modify_owner` | `mcm-auth/src/hierarchy.rs` | 04, 08 | U |
| `invite_token_hash_roundtrip_and_constant_time_compare` | `mcm-auth/src/invite.rs` | 02 | U |
| `last_owner_guard_transactional_under_concurrency` | `mcm-auth/tests/last_owner.rs` | 05 | I |

## mcm-db

| Test | Location | FR | Kind |
|---|---|---|---|
| `migration_p8_applies_on_previous_release_snapshot` | `mcm-db/tests/migrate.rs` | all | I |
| `p8_migration_star_tokens_keep_admin_access` (snapshot with owner/admin `["*"]` tokens → `["*","admin"]`) | `mcm-db/tests/migrate.rs` | 19 | I |
| `p8_migration_star_tokens_non_admin_owner_not_upgraded` (`user` token stays `["*"]`; scoped tokens untouched) | `mcm-db/tests/migrate.rs` | 19 | I |
| `server_permissions_cascade_on_server_delete` | `mcm-db/tests/permissions_repo.rs` | 09 | I |
| `audit_filter_outcome_target_actor_prefix` | `mcm-db/tests/audit_repo.rs` | 22 | I |
| `audit_server_view_excludes_console_command_without_console_read` | `mcm-db/tests/audit_repo.rs` | 22 | I |
| `audit_retention_deletes_in_batches` (FakeClock, 12 000 rows) | `mcm-db/tests/audit_repo.rs` | 24 | I |
| `invite_consume_is_atomic` | `mcm-db/tests/invite_repo.rs` | 02 | I |

## mcm-notify

| Test | Location | FR | Kind |
|---|---|---|---|
| `event_mapping_covers_catalog` | `mcm-notify/src/mapping.rs` | 27 | U |
| `channel_filter_by_event_and_server` | `mcm-notify/src/dispatcher.rs` | 26, 28 | U |
| `queue_overflow_drops_player_events_first` | `mcm-notify/src/dispatcher.rs` | 28 | U |
| `coalesce_same_event_server_within_30s` (FakeClock) | `mcm-notify/src/dispatcher.rs` | 28 | U |
| `discord_embed_truncates_to_limits` | `mcm-notify/src/discord.rs` | 29 | U |
| `discord_embed_limits_never_exceeded` | `mcm-notify/src/discord.rs` | 29 | P |
| `discord_embed_escapes_mentions` | `mcm-notify/src/discord.rs` | 29 | U |
| `discord_429_waits_retry_after_without_consuming_attempt` (wiremock, `retry_after` 0.2 s) | `mcm-notify/tests/discord.rs` | 30 | I |
| `discord_404_is_permanent_failure` | `mcm-notify/tests/discord.rs` | 32 | I |
| `webhook_signature_matches_reference_hmac` | `mcm-notify/src/webhook.rs` | 31 | U |
| `webhook_headers_present` | `mcm-notify/tests/webhook.rs` | 31 | I |
| `retry_schedule_is_10s_then_60s` (pure, FakeClock) | `mcm-notify/src/retry.rs` | 32 | U |
| `webhook_retries_three_times` (real time, `retry_backoff = [50ms, 50ms]`) | `mcm-notify/tests/webhook.rs` | 32 | I |
| `webhook_4xx_not_retried` | `mcm-notify/tests/webhook.rs` | 32 | I |
| `webhook_redirect_not_followed` | `mcm-notify/tests/webhook.rs` | 34 | I |
| `notify_uses_safe_http_rejects_private_target` (SafeHttp with fake resolver → 10.0.0.5) | `mcm-notify/tests/ssrf.rs` | 34 | I |
| `notify_allows_private_when_configured` | `mcm-notify/tests/ssrf.rs` | 34 | I |
| `discord_url_pattern_enforced` | `mcm-notify/src/discord.rs` | 34 | U |
| `channel_auto_disables_after_50_permanent_failures` | `mcm-notify/tests/autodisable.rs` | 35 | I |

`SafeHttp` itself (resolver, pinning, redirect re-validation) is tested in `mcm-download` (phase 1).

## API integration (`mcm-api-tests`)

| Test | File | FR | Kind |
|---|---|---|---|
| **`permission_matrix_every_operation_enforced`** — loads OpenAPI; every operation has `x-mcm-permission`; principals {anonymous, user without grants, user with exactly the required perm on server A (Docker-runtime fake server where needed), same on server B, token missing the scope, token restricted to another serverId, admin token without `admin` scope}; synthesises requests (`mcm-testkit::openapi_fuzz::example_request`); asserts 401/403/404 vs not-403 | `p8_permission_matrix.rs` | 17, 18, 25 | A |
| `audit_written_for_every_mutating_operation` (catalog action, one row) | `p8_permission_matrix.rs` | 25 | A |
| `users_list_requires_admin` | `p8_users.rs` | 01 | A |
| `invite_create_accept_logs_in` | `p8_users.rs` | 02 | A |
| `invite_accept_expired_returns_410` (FakeClock via `test-hooks`) | `p8_users.rs` | 02 | A |
| `invite_accept_twice_second_410` | `p8_users.rs` | 02 | A |
| `admin_cannot_invite_owner` | `p8_users.rs` | 02 | A |
| `invite_with_files_write_on_native_rejected_422` | `p8_users.rs` | 02, 10 | A |
| `create_user_temp_password_forces_change` | `p8_users.rs` | 03 | A |
| `update_role_hierarchy_enforced` | `p8_users.rs` | 04 | A |
| `demote_admin_to_user_revokes_forbidden_grants` | `p8_users.rs` | 04, 10 | A |
| `demote_last_owner_returns_409` / `delete_last_owner_returns_409` / `disable_last_owner_returns_409` | `p8_users.rs` | 05 | A |
| `disable_user_revokes_sessions_tokens_and_closes_ws_4401` (< 1 s) | `p8_users.rs` | 06 | A |
| `delete_user_keeps_audit_rows` | `p8_users.rs` | 07 | A |
| `password_reset_link_flow` / `password_reset_temp_flow` | `p8_users.rs` | 08 | A |
| `grant_put_normalizes_and_returns` | `p8_permissions.rs` | 09, 12 | A |
| `grant_to_admin_is_redundant_422` / `grant_unknown_permission_422` | `p8_permissions.rs` | 09 | A |
| `grant_files_write_on_native_requires_admin_trust` | `p8_permissions.rs` | 10 | A |
| `grant_content_manage_on_native_requires_admin_trust` | `p8_permissions.rs` | 10 | A |
| `grant_server_settings_on_native_requires_admin_trust` | `p8_permissions.rs` | 10 | A |
| `grant_safe_permissions_on_native_allowed` (console.write, server.power, players.manage, files.read, backups.manage) | `p8_permissions.rs` | 10 | A |
| `catalog_marks_manager_not_grantable_on_native` | `p8_permissions.rs` | 11 | A |
| `user_without_view_gets_404_not_403` | `p8_permissions.rs` | 09 | A |
| `user_create_server_native_requires_admin_trust` / `user_create_server_docker_grants_manager` (Docker via fake spawner under `test-hooks`) | `p8_permissions.rs` | 13 | A |
| `runtime_change_to_native_with_conflicting_grants_409` | `p8_permissions.rs` | 14 | A |
| `runtime_change_with_revoke_flag_revokes_and_audits` | `p8_permissions.rs` | 14 | A |
| `revoking_console_read_drops_ws_subscription` | `p8_permissions.rs` | 15 | A |
| `grant_change_effective_on_next_request` | `p8_permissions.rs` | 16 | A |
| `token_scope_intersection_with_user_grants` / `token_server_ids_restriction` | `p8_tokens.rs` | 17 | A |
| `admin_area_requires_admin_scope_on_token` | `p8_tokens.rs` | 17 | A |
| `user_cannot_create_token_with_admin_scope` | `p8_tokens.rs` | 17 | A |
| `require_2fa_for_admins_blocks_until_enrolled` (incl. tokens; enrol routes still reachable) | `p8_twofa_policy.rs` | 20 | A |
| `cli_reset_2fa_clears_secret_and_recovery_codes` | `mcm-server/tests/cli.rs` | 20 | I |
| `admin_revokes_user_sessions` / `admin_cannot_revoke_owner_sessions` | `p8_sessions.rs` | 21 | A |
| `audit_filters_combined` | `p8_audit.rs` | 22 | A |
| `server_audit_hides_console_command_without_console_read` | `p8_audit.rs` | 22 | A |
| `server_audit_visible_with_server_view_only` | `p8_audit.rs` | 22 | A |
| `audit_export_csv_streams_and_escapes_injection` | `p8_audit.rs` | 23 | A |
| `audit_retention_setting_validated_range` | `p8_audit.rs` | 24 | A |
| `channel_crud_masks_url` | `p8_notifications.rs` | 26 | A |
| `channel_create_private_target_rejected_422` | `p8_notifications.rs` | 34 | A |
| `server_crash_triggers_discord_delivery` (fake-mc `crash_after_ms`, wiremock Discord, real time) | `p8_notifications.rs` | 27, 28, 29 | A |
| `channel_test_send_returns_status` | `p8_notifications.rs` | 33 | A |
| `deliveries_listed_after_send` | `p8_notifications.rs` | 35 | A |
| `in_app_notification_pushed_over_ws_and_listed` / `in_app_notification_respects_server_view` | `p8_notifications.rs` | 36 | A |
| `account_security_event_on_password_change` | `p8_notifications.rs` | 37 | A |
| `rate_limits_match_table` (invite accept, test-send, export concurrency) | `p8_hardening.rs` | 38 | A |
| `no_secrets_in_logs` (auto on `TestApp` drop, every suite) | `mcm-testkit/src/logs.rs` | 39 | A |

## Frontend (Vitest)

| Test | File | FR | Kind |
|---|---|---|---|
| `PermissionGrid › checking files.write auto-checks files.read and server.view` | `features/users/components/PermissionGrid.test.ts` | 12 | C |
| `PermissionGrid › implication vectors match testdata/validation/permissions.json` | same | 12 | C |
| `PermissionGrid › locks admin-trust permissions for users on native runtime` | same | 10 | C |
| `TrustWarning › shown on native and shim, hidden on docker` | `TrustWarning.test.ts` | 10 | C |
| `PresetSelect › shows Custom after manual edit; Manager disabled when not grantable` | `PresetSelect.test.ts` | 11 | C |
| `RuntimeConflictDialog › lists conflicts and sends revokeConflictingGrants` | `RuntimeConflictDialog.test.ts` | 14 | C |
| `InviteDialog › shows copyable URL after create` | `InviteDialog.test.ts` | 02 | C |
| `UserTable › disables delete for last owner` | `UserTable.test.ts` | 05 | C |
| `AuditFilterBar › syncs filters to URL` | `features/audit/components/AuditFilterBar.test.ts` | 22 | C |
| `ChannelForm › default events preselected, player events off` | `features/notifications/components/ChannelForm.test.ts` | 27 | C |
| `inbox.svelte › unread count derives and markRead updates` | `features/notifications/inbox.svelte.test.ts` | 36 | U |
| `ws client › close 4401 triggers signed-out handler` | `lib/ws/client.test.ts` | 06 | U |

## E2E (Playwright)

| Spec | Scenario | FR / US |
|---|---|---|
| `p8-users.spec.ts › invite and accept` | Owner invites; second context accepts; sees only granted server | 02, 09 / US-8.1, 8.2 |
| `p8-users.spec.ts › disable kicks open console` | User B has console open; owner disables B; B redirected to login | 06 / US-8.3 |
| `p8-users.spec.ts › moderator cannot stop server` | Moderator preset; power buttons hidden; direct API call 403 | 09, 11 / US-8.2 |
| `p8-users.spec.ts › native trust warning` | Access page of a native server shows callout; file-write checkbox locked; API PUT returns 422 | 10 / US-8.4 |
| `p8-2fa-policy.spec.ts › enforcement interstitial` | Owner enables requirement; admin forced to phase 0 enrolment | 20 / US-8.5 |
| `p8-sessions.spec.ts › admin revokes user session` | Two contexts; admin revokes; other signed out | 21 / US-8.6 |
| `p8-audit.spec.ts › filter and export` | Stop server, filter `server.stop`, download CSV, assert row | 22, 23 / US-8.7 |
| `p8-notifications.spec.ts › discord on crash` | Mock Discord; fake-mc crash; embed received; bell shows notification | 27–29, 36 / US-8.8 |
| `p8-notifications.spec.ts › webhook signature verifiable` | Mock verifies HMAC with secret shown on create | 31 / US-8.9 |
| `p8-tokens.spec.ts › scoped token restarts one server` | Token with `server.power` on A; restart A OK, B 404 | 17 / US-8.10 |
| axe + CSP-violation checks on `/admin/users`, `/admin/audit`, `/admin/notifications`, `/servers/[id]/settings/access` | — | — |

US-8.11 is covered by `p8_migration_star_tokens_keep_admin_access`.

## Fuzz

| Target | Crate | FR |
|---|---|---|
| `csv_escape` (no unescaped formula prefix; RFC 4180 roundtrip) | mcm-api | 23 |

## Non-test verification

| FR | Verified by |
|---|---|
| P8-FR-40 | CI `audit` job is a required check on PRs (exit checklist review) |
| P8-FR-41 | Threat-model table in [requirements.md](requirements.md#threat-model-walkthrough) complete, each row linking an existing passing test |
