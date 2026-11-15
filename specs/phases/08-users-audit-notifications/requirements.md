# Phase 8 — Requirements

Conventions: [patterns.md](../../architecture/patterns.md). "Crates" lists crates touched (short names, `mcm-` prefix omitted; `db` = repo impls of `chunkyard-core` traits). "Perm" is the permission/role checked by `AuthService::authorize`. "Audit" names come only from [audit.md](../../architecture/audit.md); detail fields follow its per-action allow-list. "Events" are `chunkyard_core::events::Event` variants.

## Users

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P8-FR-01 | List users (`id, username, role, disabled, totpEnabled, canCreateServers, createdAt, lastLoginAt`). Owners/admins see all; users see only themselves via `/auth/me`. | auth, db, api | admin | — | — |
| P8-FR-02 | **Invitation flow (default):** admin creates invite `{role, username?, grants?, canCreateServers?, expiresInHours (1–168, default 72)}` → one-time URL `<public_url>/invite/<token>` (32 random bytes base64url, stored as sha256). Accepting sets username (if not preset) + password; consumption atomic; expired/consumed → `410 invite.gone`. Admins invite `user`/`admin`; only owners invite `owner`. Initial `grants` are validated by P8-FR-10 at creation **and** at acceptance. | auth, db, api | admin (owner for owner role) | `user.invite.create`, `user.invite.accept`, `user.invite.revoke` | `UserCreated` |
| P8-FR-03 | **Admin-set password (fallback):** create user with a temporary password; `must_change_password` set (phase 0 mechanism). | auth, api | admin | `user.create` | `UserCreated` |
| P8-FR-04 | Update user: role, username, `canCreateServers`. Hierarchy: admins cannot modify owners or promote to owner; owners can change anyone. Demoting an admin to `user` re-validates their existing grants under P8-FR-10 and **revokes** grants that become forbidden (one `permission.revoke` row each, `details.trigger = "role_change"`); the response lists them. | auth, api | admin/owner | `user.update` | `UserUpdated`, `PermissionsChanged` |
| P8-FR-05 | **Last-owner protection:** any operation (delete, disable, demote) leaving zero enabled owners → `409 user.last_owner`, enforced in one DB transaction (count + update). | auth, db | — | failure recorded under the attempted action | — |
| P8-FR-06 | Disable/enable. Disable atomically sets `disabled=1`, deletes all sessions **and API tokens** (not restored on enable), publishes `SessionsRevoked { user_id }` and `UserDisabled`; WS hub closes that user's sockets with code `4401` within 1 s. Jobs already accepted continue as system work. | auth, db, api | admin | `user.disable`, `user.enable` | `SessionsRevoked`, `UserDisabled` |
| P8-FR-07 | Delete user: same revocation, then delete row (cascades sessions, tokens, grants). Audit rows keep `actor_user_id` (no FK); UI shows "deleted user (id)". | auth, db | admin | `user.delete` | `SessionsRevoked`, `UserDeleted` |
| P8-FR-08 | Admin password reset: reset link (invite mechanism, `purpose=reset`) or temp password; all sessions revoked; 2FA kept unless `reset2fa=true` (owner only when target is admin/owner). | auth, api | admin | `user.password.reset` | `SessionsRevoked` |

## Per-server permissions

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P8-FR-09 | Grants: `PUT /servers/{id}/permissions/{userId} {permissions}` replaces the set; `DELETE` removes. Only `user`-role targets (admins/owners already have everything → `422 permission.redundant`); unknown strings → `422 permission.unknown`. | auth, db, api | admin | `permission.grant`, `permission.revoke` | `PermissionsChanged { user_id, server_id }` |
| P8-FR-10 | **Single-trust rule (D1).** `chunkyard_auth::trust::requires_admin_trust(perm, runtime)` returns true for `files.write`, `content.manage`, `server.settings` when the server's runtime is `native` or `shim` (both run as the mcm OS user). Granting such a permission to a `user` (directly, via preset, via invite, or via implication) → `422 permission.requires_admin_trust` with `errors[]` naming each offending permission. `authorize()` also checks it at decision time (defence in depth: a stale grant on a native server is denied and logged `warn`). | auth, api | admin | failure recorded as `permission.grant` | — |
| P8-FR-11 | Presets (`chunkyard-auth::presets`, exposed via API): **Viewer** = `server.view, console.read`; **Operator** = Viewer + `server.power, console.write`; **Moderator** = Operator + `players.manage, files.read, backups.read`; **Manager** = all per-server permissions except `server.delete`. Manager contains admin-trust permissions, so for `user` targets it is **only grantable on Docker-runtime servers**; the catalog response marks each preset `grantable` per server. Presets are templates; stored grants are explicit lists. | auth, api | — | — | — |
| P8-FR-12 | Implications: every permission implies `server.view`; `console.write` ⇒ `console.read`; `files.write` ⇒ `files.read`; `backups.manage` ⇒ `backups.read`. Normalised on save before P8-FR-10 is checked. | auth | — | — | — |
| P8-FR-13 | `server.create` is a global flag `users.can_create_servers`. For a `user` it permits creating/cloning **Docker-runtime** servers only (`runtime: "native"`/`"shim"` → `422 permission.requires_admin_trust`; if Docker is unavailable the flag is shown disabled). The creator receives the Manager preset on the new server. | auth, api | `server.create` | `permission.grant` (`trigger = "creator"`) | `PermissionsChanged` |
| P8-FR-14 | **Runtime changes vs grants.** Changing a server's runtime to `native`/`shim` (phase 10 `PATCH /servers/{id}` `runtime`) while `user`s hold admin-trust permissions on it is **blocked** with `409 server.runtime_grants_conflict` whose body lists `{userId, username, permissions[]}`. The admin either revokes those grants first or repeats the request with `revokeConflictingGrants=true`, which revokes them in the same transaction (one `permission.revoke` row each, `trigger = "runtime_change"`). Rationale: no silent privilege loss and no silent escalation. Before phase 10 ships, the check is a no-op (all servers native, grants already blocked). | auth, api, process | admin | `server.runtime.change`, `permission.revoke` | `PermissionsChanged` |
| P8-FR-15 | Live effect: `PermissionsChanged` makes the WS hub re-evaluate the user's subscriptions; lost ones get `{op:"error", problem:{code:"auth.forbidden"}, topic}` and are removed. In-flight HTTP requests finish under the old decision. | api | — | — | — |
| P8-FR-16 | No cross-request authorization cache; decision = O(1) lookup by `(user_id, server_id)`. | auth, db | — | — | — |

## API tokens

| ID | Requirement | Crates | Perm | Audit |
|---|---|---|---|---|
| P8-FR-17 | Effective token permission = `role/grants(owner user) ∩ scopes ∩ serverIds`; `"*"` = all **server** permissions the user holds. Admin-only areas require scope `admin` **and** an admin/owner user ([auth.md](../../architecture/auth.md#api-tokens)). Token creation offers `admin` only to admins/owners. | auth | — | — |
| P8-FR-18 | Every OpenAPI operation declares `x-chunkyard-permission` (`"server.power"`, `"admin"`, `"owner"`, `"self"`, `"public"`), attached by the `RequirePerm<…>` extractor macro. The matrix test fails for any operation without it. | api | — | — |
| P8-FR-19 | **Upgrade semantics:** the P8 migration rewrites `scopes` of every token equal to `["*"]` whose owner has role `owner`/`admin` to `["*","admin"]`; tokens of `user`s are unchanged. Tokens created afterwards include `admin` only when requested. | db | — | — |

## Admin 2FA enforcement and sessions

| ID | Requirement | Crates | Perm | Audit |
|---|---|---|---|---|
| P8-FR-20 | Setting `security.require_2fa_for_admins` (owner only). When on, admin/owner principals without TOTP (phase 0 enrolment) get `403 auth.2fa_enrolment_required` on every route except `/auth/me`, `/auth/logout`, `/auth/totp/enroll` and `/auth/totp/confirm`; their API tokens are rejected with the same code. New offline CLI `mcm user reset-2fa <username>` (DB opened directly) clears the TOTP secret and recovery codes so a locked-out owner can recover. | auth, api, server | owner | `settings.update`; CLI: `auth.totp.disable` (actor null, `details.via = "cli"`) |
| P8-FR-21 | Admin session control: `GET/DELETE /users/{id}/sessions` (owners' sessions only by an owner). | auth, api | admin | `auth.session.revoke` |

## Audit log

| ID | Requirement | Crates | Perm | Audit |
|---|---|---|---|---|
| P8-FR-22 | Extend phase 0 `GET /audit` with `outcome`, `targetType`, `actorUserId`, `action` prefix filters and joined `actorUsername`; ordered `id DESC`. Per-server view `GET /servers/{id}/audit` for `server.view` holders: rows with `server_id = id`; **`console.command` rows are excluded unless the caller has `console.read`** ([audit.md](../../architecture/audit.md#visibility)). `details` is rendered as stored (already allow-listed per action at write time). | db, api | admin / `server.view` | — |
| P8-FR-23 | Export `GET /audit/export.csv`, same filters, streamed, max 1 000 000 rows, RFC 4180, CSV-injection-safe (cells starting with `= + - @ \t \r` prefixed with `'`). | api | admin | `audit.export` |
| P8-FR-24 | Retention: setting `audit.retention_days` (30–3650, default 365) replaces phase 0's fixed value; hourly sweeper deletes in batches of 5 000. | db, server | admin (`settings.update`) | — |
| P8-FR-25 | Completeness: every mutating operation writes exactly one audit row (success or failure; failures for 403/409/422; 401 only for `auth.login`), with an action from the catalog. Verified by the matrix harness. | api, core | — | — |

## Notifications (`chunkyard-notify`)

| ID | Requirement | Crates | Perm | Audit |
|---|---|---|---|---|
| P8-FR-26 | Channel CRUD `{name, kind: discord|webhook, url, secret?, events, serverIds|null, enabled}`; URL and secret encrypted (AAD per [security.md](../../architecture/security.md#secrets-storage)); responses show `urlPreview` (scheme+host). | notify, db, api | admin | `notify.channel.create`, `notify.channel.update`, `notify.channel.delete` |
| P8-FR-27 | Notification event catalog (past-tense, separate from audit actions): `server.started`, `server.stopped`, `server.crashed`, `server.crash_loop`, `backup.succeeded`, `backup.failed`, `job.failed`, `schedule.failed`, `player.joined`, `player.left` (opt-in), `disk.low` (data dir free < 10 % or < 5 GiB), `auth.login_failed_burst` (≥ 10 failures / 5 min). Defaults: crashed, crash_loop, backup.failed, job.failed, schedule.failed, disk.low. Phase 9 adds `relay.disconnected`, phase 10 adds `server.oom_killed`, `disk.quota_exceeded`, `runtime.unavailable`. | notify, core | — | — |
| P8-FR-28 | Dispatcher actor: subscribes to `EventBus`, maps events, matches channels, bounded queue 4096 (overflow drops oldest `player.*` first, `warn`); identical `(event, server)` within 30 s coalesced with `count`. | notify | — | — |
| P8-FR-29 | Discord payload `{username:"mcm", embeds:[…], allowed_mentions:{parse:[]}}`, limits (title ≤ 256, description ≤ 4096, ≤ 25 fields, total ≤ 6000; truncated with `…`), markdown in player names/MOTDs escaped. | notify | — | — |
| P8-FR-30 | Discord 429: wait `retry_after` (JSON, seconds) or `Retry-After`, retry without consuming an attempt (max wait 60 s). Serial queue per channel. | notify | — | — |
| P8-FR-31 | Generic webhook: JSON `{id, event, ts, instance, server?, data}`; headers `X-MCM-Event`, `X-MCM-Delivery`, `X-MCM-Timestamp`, `X-MCM-Signature: sha256=<hex(HMAC-SHA256(secret, timestamp + "." + body))>`; secret auto-generated (32 bytes) if absent. | notify | — | — |
| P8-FR-32 | Retries: 3 attempts, backoff 10 s then 60 s (`NotifyConfig.retry_backoff` overridable in tests), 2xx success, 4xx except 408/429 permanent, 10 s timeout; each attempt in `notification_deliveries`. | notify, db | — | — |
| P8-FR-33 | Test send `POST /notifications/channels/{id}/test` → synchronous synthetic `test` event, `{ok, status, latencyMs, error?}`. | notify, api | admin | `notify.channel.test` |
| P8-FR-34 | Outbound HTTP exclusively through `chunkyard_download::SafeHttp` ([security.md § Outbound HTTP](../../architecture/security.md#outbound-http-ssrf)): shared resolver with private-range rejection and IP pinning, honouring `security.allow_private_targets`. Notifications set `redirects: none` (a 3xx is a delivery failure). Discord URLs must match `https://discord.com/api/webhooks/…` or `https://discordapp.com/api/webhooks/…`. Channel create/update validates the URL eagerly (`422 notify.target_forbidden`). No notifier-specific resolver exists. | notify, download | — | — |
| P8-FR-35 | Delivery log `GET /notifications/channels/{id}/deliveries` (cursor), 30-day retention; auto-disable after 50 consecutive permanent failures (`NotifyChannelDisabled` → in-app notification to admins). | notify, db, api | admin | — |
| P8-FR-36 | In-app notifications: WS topic `notifications` per user `{type:"notification", …}` for events on servers the user can `server.view` plus admin system events; stored in `user_notifications` (last 200/user); `GET /account/notifications`, `POST /account/notifications/read`. | notify, api | self | — |
| P8-FR-37 | Account security events (login failure burst, password change, 2FA disable, token create) surfaced to the affected user as in-app notifications. | auth, notify | — | — |

## Security review

| ID | Requirement | Crates |
|---|---|---|
| P8-FR-38 | Rate-limit table per route group committed in [api.md](api.md#rate-limits); invite accept 5/min/IP. | api |
| P8-FR-39 | `no_secrets_in_logs`: `chunkyard-testkit` installs the capture subscriber for every `TestApp`; on drop asserts no registered secret (passwords, tokens, webhook URLs, TOTP secrets, CF key, RCON/management secrets) appears. | testkit |
| P8-FR-40 | Supply chain: CI `audit` job becomes blocking on PRs for high/critical (`cargo deny check advisories`, `pnpm audit --prod --audit-level high`). | CI |
| P8-FR-41 | Threat-model walkthrough below completed; each row links ≥ 1 passing test. | — |

### Threat-model walkthrough

| Threat | Mitigation test(s) |
|---|---|
| T1 brute force | phase 0 throttling tests (`(IP, username)` + per-IP) |
| T2 CSRF/clickjacking | phase 0 CSRF + header tests |
| T3 XSS | phase 0 E2E CSP check; `discord_embed_escapes_mentions` |
| T4 path traversal | phase 2 fuzz; `permission_matrix_every_operation_enforced` (files routes) |
| T5 JVM args | phase 2 allow-list tests; `grant_server_settings_on_native_requires_admin_trust` |
| T6 untrusted server dir / malicious upload | phase 2/6 tests; `grant_files_write_on_native_requires_admin_trust` |
| T7/T8 downloads | phase 3/4 hash tests |
| T9 relay | phase 9 tests |
| T10 RCON/management | phase 5 tests |
| T11 secret leakage | `no_secrets_in_logs` (all suites) |
| T12 SSRF | `notify_uses_safe_http_rejects_private_target`, phase 1 `SafeHttp` tests |
| T13 player IP integrity | phase 2/7 tests |

## Edge cases & failure modes

| Case | Behaviour |
|---|---|
| Two admins demote the last two owners concurrently | Transactional check; second fails `409 user.last_owner` |
| User disabled while holding a console subscription | Socket closed `4401`; client redirects to `/login` |
| Invite accepted twice simultaneously | `UPDATE … WHERE consumed_at IS NULL` affects 1 row; second gets `410` |
| Invite carries `files.write` on a server that became native after creation | Acceptance creates the user but rejects that grant; response and admin in-app notification list dropped grants |
| Grant row exists for admin-trust perm on a native server (e.g. DB edited by hand) | `authorize()` denies, logs `warn` (P8-FR-10) |
| Webhook endpoint hangs | 10 s timeout counts as an attempt |
| Discord returns 404 | Permanent failure; counts toward auto-disable |
| Master key missing → channel URL undecryptable | Channel `error: secret_unreadable`; admin re-enters URL |
| Audit export of a huge range | Streamed; client disconnect cancels the query |

## Security considerations

- Invite/reset tokens: single-use, hashed, expiring, constant-time compared.
- Admins cannot escalate to owner; owners cannot be modified by admins.
- Single-trust is enforced at grant time **and** at decision time; the UI warning is informational only.
- Webhook signing secret shown only on create/rotate.
- Notifications never include console contents or file data; Discord mentions disabled.

## Open questions / to verify

- Discord `retry_after` units in the current API version and `X-RateLimit-*` headers.
- Audit tamper evidence (per-row hash chain) — decide before 1.0.
- Whether `player.joined/left` needs a per-channel cap (proposed 30/min).
