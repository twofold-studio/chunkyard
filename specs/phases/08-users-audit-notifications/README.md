# Phase 8 — Users, permissions, audit, notifications

## Goal

Turn mcm from a single-admin tool into a multi-user panel: several people with scoped access per server under an explicit trust model, a browsable audit trail, Discord/webhook notifications, and a security review of everything shipped in phases 0–7.

## Native runtime is single-trust (read first)

On the **native** runtime every server runs as the mcm OS user. `files.write`, `content.manage` and `server.settings` (JVM args, launch, env, Java) on a native server let the holder **execute arbitrary code as mcm**: read the database, the master key and every other server. In native mode these permissions are therefore **admin-equivalent**:

- They can be granted only to admin-trust users (role `owner` or `admin`, who already hold them). Granting them to a `user` on a native server is rejected with `422 permission.requires_admin_trust`, and the grants screen explains why.
- Safe to delegate on any runtime: `server.view`, `console.read`, `console.write`, `server.power`, `players.manage`, `files.read`, `backups.read`, `backups.manage`, `schedules.manage`, `proxy.manage`.
- **Real multi-user isolation requires the Docker runtime ([phase 10](../10-isolation-limits/README.md)).** On Docker servers every per-server permission can be granted to any user, and non-admin JVM args are still limited by the allow-list.

Authoritative rule: [security.md § Native runtime is single-trust](../../architecture/security.md#native-runtime-is-single-trust).

## Scope

| Area | In scope |
|---|---|
| Users | CRUD by owner/admin, invitations (one-time link), admin-set temporary password, disable/enable, last-owner protection, forced password change |
| Permissions | Per-server grants (`server_permissions`) using the catalog in [auth.md](../../architecture/auth.md#permission-catalog-per-server); single-trust enforcement on native servers; presets (Viewer, Operator, Moderator, Manager); live revocation (sessions, tokens, WS subscriptions) |
| API tokens | Scope + `serverIds` enforcement on **every** endpoint (generated matrix test over the OpenAPI document); new `admin` scope with upgrade of existing `["*"]` tokens |
| 2FA policy | Owner-enforced 2FA for admins (`security.require_2fa_for_admins`). TOTP enrolment, recovery codes and the login step already ship in [phase 0](../00-foundation/README.md) |
| Admin session control | Admins list/revoke other users' sessions (own-session management is phase 0) |
| Audit | Audit UI with filters, per-server activity view, CSV export, configurable retention |
| Notifications | `mcm-notify`: Discord + signed generic webhook channels, event catalog, filters, retries, delivery log, test-send, in-app notifications. All outbound HTTP via `mcm_download::SafeHttp` |
| Security review | Rate-limit review, `no_secrets_in_logs` in every API suite, blocking dependency audit, threat-model walkthrough (T1–T13) |

## Non-goals

- TOTP enrolment, own-session list/revoke, security headers and CSP — **phase 0**.
- SSO / OIDC / LDAP, WebAuthn/passkeys, email delivery (invites are copy-paste links).
- Custom roles beyond owner/admin/user + per-server permission sets.
- Slack/Telegram/Matrix channels (generic webhook covers them).
- Audit tamper evidence (hash chain) — open question.
- **8b SFTP** — deferred, post-1.0 candidate; design sketch in [sftp-deferred.md](sftp-deferred.md), not part of this phase's exit checklist.

## User stories

| ID | Story |
|---|---|
| US-8.1 | As an owner, I invite a friend with a link so they can set their own password without me knowing it. |
| US-8.2 | As an admin, I give a moderator console and player-management access to one server only. |
| US-8.3 | As an admin, I disable a user and they are immediately logged out everywhere, including open consoles. |
| US-8.4 | As an admin, I try to give a user file-write access to a native server and am told why that would hand them the whole host. |
| US-8.5 | As an owner, I require 2FA for all admins. |
| US-8.6 | As an admin, I see a user's active sessions and revoke them. |
| US-8.7 | As an admin, I filter the audit log to "who stopped server X yesterday" and export it as CSV. |
| US-8.8 | As an admin, I get a Discord message when a server crash-loops or a backup fails. |
| US-8.9 | As an integrator, I receive signed JSON webhooks I can verify. |
| US-8.10 | As a token holder, my CI token scoped to `server.power` on one server can restart it and nothing else. |
| US-8.11 | As an admin who created an all-access token in phase 0, my token still works after upgrading. |

## Dependencies

| Phase | Needed for |
|---|---|
| [00-foundation](../00-foundation/README.md) | users/sessions/api_tokens/audit_log tables, TOTP, own sessions, security headers, `AuthService::authorize`, audit catalog |
| [01-lifecycle-console](../01-lifecycle-console/README.md) | Server events, console WS subscriptions to revoke, `SafeHttp` (`mcm-download`) |
| [05-monitoring](../05-monitoring/README.md) | Player join/leave events, disk usage for `disk.low` |
| [06-backups-scheduler-worlds](../06-backups-scheduler-worlds/README.md) | Backup and schedule events |
| Phases 2–4, 7 | Their endpoints are covered by the permission matrix test |
| [10-isolation-limits](../10-isolation-limits/README.md) (later) | Docker runtime unlocks code-execution grants for non-admins; runtime changes re-check grants (P8-FR-14) |

## Documents

[requirements](requirements.md) · [api](api.md) · [ui](ui.md) · [tests](tests.md) · [sftp-deferred](sftp-deferred.md)

## Exit checklist

- [ ] All `P8-FR-*` implemented; every FR has passing tests listed in [tests.md](tests.md).
- [ ] `permission_matrix_every_operation_enforced` passes over the full OpenAPI document.
- [ ] Single-trust: granting `files.write`/`content.manage`/`server.settings` to a `user` on a native server fails with `422 permission.requires_admin_trust` (API + UI warning tested).
- [ ] Existing `["*"]` tokens of admins/owners keep admin access after the P8 migration (`p8_migration_star_tokens_keep_admin_access`).
- [ ] Disabling a user closes their WS within 1 s and invalidates sessions + tokens (E2E `p8-users.spec.ts`).
- [ ] Admin 2FA enforcement covered by API + E2E tests.
- [ ] Discord 429 handling and webhook HMAC verified against wiremock fixtures; notifications use `SafeHttp` only.
- [ ] Per-server activity view hides `console.command` rows from users without `console.read`.
- [ ] Audit retention configurable and batched.
- [ ] `no_secrets_in_logs` runs at the end of every `mcm-api-tests` binary.
- [ ] `cargo deny` + `cargo audit` + `pnpm audit --prod` blocking in CI (high/critical).
- [ ] Threat-model walkthrough (T1–T13 in [security.md](../../architecture/security.md)) recorded in [requirements.md](requirements.md#threat-model-walkthrough) with each mitigation linked to a test.
- [ ] Coverage gates met; `mcm-auth` ≥ 95 %.
- [ ] SFTP (8b) explicitly **not** required.
