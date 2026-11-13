# Phase 8 — API, WebSocket, migration, events

Conventions: [api-conventions.md](../../architecture/api-conventions.md). Auth column: `none`, `self` (any authenticated principal acting on itself), `session` (cookie only), `admin`, `owner`, or a per-server permission. Every operation carries `x-mcm-permission` (P8-FR-18).

## Users and invites

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/v1/users` | admin | `limit, cursor, q?` | `200 Page<User>` | — |
| POST | `/api/v1/users` | admin | `CreateUserRequest` | `201 User` | `409 name.taken`, `403 user.hierarchy`, `422 auth.weak_password` |
| GET | `/api/v1/users/{userId}` | admin | — | `200 UserDetail` | `404 user.not_found` |
| PATCH | `/api/v1/users/{userId}` | admin | `{username?, role?, canCreateServers?}` | `200 {user: User, revokedGrants: RevokedGrant[]}` | `403 user.hierarchy`, `409 user.last_owner`, `409 name.taken` |
| POST | `/api/v1/users/{userId}/disable` | admin | — | `200 User` | `409 user.last_owner`, `409 user.self` |
| POST | `/api/v1/users/{userId}/enable` | admin | — | `200 User` | — |
| DELETE | `/api/v1/users/{userId}` | admin | — | `204` | `409 user.last_owner`, `409 user.self` |
| POST | `/api/v1/users/{userId}/password-reset` | admin | `{mode:"link"|"temp", reset2fa?: boolean}` | `200 {url?, tempPassword?, expiresAt?}` | `403 user.hierarchy` |
| GET | `/api/v1/users/{userId}/sessions` | admin | — | `200 {items: Session[]}` | — |
| DELETE | `/api/v1/users/{userId}/sessions` | admin | — | `204` | `403 user.hierarchy` |
| GET | `/api/v1/invites` | admin | — | `200 {items: Invite[]}` (pending) | — |
| POST | `/api/v1/invites` | admin (owner for `role:"owner"`) | `CreateInviteRequest` | `201 {invite: Invite, url: string}` | `403 user.hierarchy`, `422 permission.requires_admin_trust` |
| DELETE | `/api/v1/invites/{inviteId}` | admin | — | `204` | `404` |
| GET | `/api/v1/invites/accept/{token}` | none | — | `200 {username?, role, instanceName, expiresAt}` | `410 invite.gone` |
| POST | `/api/v1/invites/accept/{token}` | none (CSRF header + Origin) | `{username?, password}` | `201 {me: MeResponse, droppedGrants: RevokedGrant[]}` + `Set-Cookie` | `410 invite.gone`, `409 name.taken`, `422 auth.weak_password`, `429` |

`Session` is the phase 0 shape.

## Per-server permissions

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/v1/permissions/catalog` | self | `serverId?` | `200 {permissions: PermissionInfo[], presets: Preset[]}` | — |
| GET | `/api/v1/servers/{serverId}/permissions` | admin | — | `200 {runtime, items: {user: UserRef, permissions: string[]}[]}` | `404` |
| PUT | `/api/v1/servers/{serverId}/permissions/{userId}` | admin | `{permissions: string[]}` | `200 {permissions: string[]}` (normalised) | `422 permission.unknown`, `422 permission.redundant`, `422 permission.requires_admin_trust` |
| DELETE | `/api/v1/servers/{serverId}/permissions/{userId}` | admin | — | `204` | `404` |
| GET | `/api/v1/users/{userId}/permissions` | admin | — | `200 {items: {server: ServerRef, permissions}[]}` | — |
| GET | `/api/v1/servers/{serverId}/audit` | `server.view` | `/audit` filters minus `serverId` | `200 Page<AuditEntry>` (`console.command` rows only with `console.read`) | `404` |

`422 permission.requires_admin_trust` body: problem+json with `errors: [{field: "permissions", code: "requires_admin_trust", message: "<perm> executes code as the mcm user on native servers"}]` and extension `runtime: "native"|"shim"`.

Runtime change conflict (endpoint owned by [phase 10](../10-isolation-limits/api.md)): `PATCH /servers/{id} {runtime}` → `409 server.runtime_grants_conflict` with extension `conflicts: {userId, username, permissions[]}[]`; query `revokeConflictingGrants=true` resolves it (P8-FR-14).

## Account (self-service)

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/v1/account/notifications` | self | `limit, cursor, unreadOnly?` | `200 Page<InAppNotification>` | — |
| POST | `/api/v1/account/notifications/read` | self | `{ids?: string[], all?: true}` | `204` | — |

Own sessions, TOTP enrolment/disable and recovery codes are phase 0 endpoints (`/auth/sessions`, `/auth/totp/*`).

## Audit

| Method | Path | Auth | Request | Success |
|---|---|---|---|---|
| GET | `/api/v1/audit` | admin | phase 0 filters + `outcome?`, `targetType?`, `actorUserId?`, `actionPrefix?` | `200 Page<AuditEntry>` (+`actorUsername`) |
| GET | `/api/v1/audit/export.csv` | admin | same filters | `200 text/csv` streamed, `Content-Disposition: attachment; filename="mcm-audit-<from>-<to>.csv"` |

CSV columns: `id,ts,actor_user_id,actor_username,actor_token_id,actor_ip,action,target_type,target_id,server_id,outcome,details`.

## Notifications

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/v1/notifications/events` | admin | — | `200 {items: {kind, description, defaultOn}[]}` | — |
| GET | `/api/v1/notifications/channels` | admin | — | `200 {items: Channel[]}` | — |
| POST | `/api/v1/notifications/channels` | admin | `CreateChannelRequest` | `201 {channel: Channel, secret?: string}` | `422 notify.url_invalid`, `422 notify.target_forbidden` |
| PATCH | `/api/v1/notifications/channels/{channelId}` | admin | partial; `rotateSecret?: true` | `200 {channel, secret?}` | as above |
| DELETE | `/api/v1/notifications/channels/{channelId}` | admin | — | `204` | `404 notify.channel_not_found` |
| POST | `/api/v1/notifications/channels/{channelId}/test` | admin | — | `200 {ok, status?, latencyMs, error?}` | `404` |
| GET | `/api/v1/notifications/channels/{channelId}/deliveries` | admin | `limit, cursor` | `200 Page<Delivery>` | — |

## Schemas

```ts
type User = { id: string; username: string; role: "owner"|"admin"|"user"; disabled: boolean; totpEnabled: boolean;
  canCreateServers: boolean; mustChangePassword: boolean; createdAt: string; lastLoginAt: string|null };
type UserDetail = User & { grants: { serverId: string; permissions: string[] }[]; tokenCount: number; sessionCount: number };
type CreateUserRequest = { username: string; role: "admin"|"user"; tempPassword: string; canCreateServers?: boolean };
type CreateInviteRequest = { role: "owner"|"admin"|"user"; username?: string; expiresInHours?: number;
  grants?: { serverId: string; permissions: string[] }[]; canCreateServers?: boolean };
type Invite = { id: string; role: string; username: string|null; createdBy: string; expiresAt: string; purpose: "invite"|"reset" };
type RevokedGrant = { serverId: string; permissions: string[]; reason: "requires_admin_trust" };
type PermissionInfo = { id: string; description: string; implies: string[];
  adminTrustOn: ("native"|"shim")[] };                 // runtimes where only admin-trust users may hold it
type Preset = { id: "viewer"|"operator"|"moderator"|"manager"; permissions: string[];
  grantable?: boolean };                                // present when ?serverId= given
type Channel = { id: string; name: string; kind: "discord"|"webhook"; urlPreview: string; events: string[];
  serverIds: string[]|null; enabled: boolean; consecutiveFailures: number; disabledReason: string|null };
type CreateChannelRequest = { name: string; kind: "discord"|"webhook"; url: string; secret?: string;
  events?: string[]; serverIds?: string[]|null; enabled?: boolean };
type Delivery = { id: number; event: string; ts: string; status: number|null; attempts: number; error: string|null };
type InAppNotification = { id: string; level: "info"|"warn"|"error"; title: string; body: string;
  serverId: string|null; link: string|null; createdAt: string; read: boolean };
```

`GET /auth/me` (phase 0) gains `serverPermissions: Record<ServerId, string[]>` (effective, normalised).

Generic webhook body (P8-FR-31):

```json
{ "id": "0193…", "event": "server.crashed", "ts": "2026-11-11T10:00:00Z", "instance": "My mcm",
  "server": { "id": "0193…", "name": "Survival" }, "data": { "exitCode": 1, "restartCount": 2 } }
```

## WebSocket

| Topic | Payload | Notes |
|---|---|---|
| `notifications` | `{type:"notification", notification: InAppNotification}` | Per user |
| any | close code `4401` reason `revoked` | User disabled/deleted or sessions revoked |
| any | `{op:"error", problem:{code:"auth.forbidden"}, topic}` | Subscription removed after grant change (P8-FR-15) |

## Events (new)

`UserCreated`, `UserUpdated`, `UserDisabled`, `UserDeleted`, `PermissionsChanged { user_id, server_id }`, `NotifyChannelDisabled { channel_id }`, `AccountSecurity { user_id, kind }`. Reused: `SessionsRevoked { user_id }` (phase 0).

## Rate limits

| Route group | Key | Limit |
|---|---|---|
| `/auth/login`, `/auth/login/totp` | (IP, username) + per IP | phase 0 throttling ([auth.md](../../architecture/auth.md#login-throttling)) |
| `/invites/accept/*` | IP | 5/min |
| `/notifications/channels/*/test` | principal | 6/min |
| `/audit/export.csv` | principal | 2 concurrent |
| other authenticated | principal | 600/min (phase 0) |

## DB migration

File: `crates/mcm-db/migrations/<NNNN>_p8_users_permissions_notifications.sql` (number assigned at merge). TOTP columns and `totp_recovery_codes` already exist from phase 0.

```sql
ALTER TABLE users ADD COLUMN can_create_servers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at INTEGER;

CREATE TABLE user_invites (
  id TEXT PRIMARY KEY, token_hash BLOB NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('invite','reset')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,   -- set for purpose='reset'
  role TEXT NOT NULL CHECK (role IN ('owner','admin','user')), username TEXT,
  grants TEXT NOT NULL DEFAULT '[]', can_create_servers INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE TABLE server_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  permissions TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, server_id)
);
CREATE INDEX server_permissions_server ON server_permissions(server_id);
CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('discord','webhook')),
  url_enc BLOB NOT NULL, url_preview TEXT NOT NULL, secret_enc BLOB,
  events TEXT NOT NULL, server_ids TEXT, enabled INTEGER NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0, disabled_reason TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE notification_deliveries (
  id INTEGER PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  event TEXT NOT NULL, ts INTEGER NOT NULL, status INTEGER, attempts INTEGER NOT NULL, error TEXT
);
CREATE INDEX notification_deliveries_channel ON notification_deliveries(channel_id, ts);
CREATE TABLE user_notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, server_id TEXT, link TEXT,
  created_at INTEGER NOT NULL, read_at INTEGER
);
CREATE INDEX user_notifications_user ON user_notifications(user_id, created_at);

-- P8-FR-19: existing all-access tokens of admins/owners keep admin-area access.
UPDATE api_tokens SET scopes = '["*","admin"]'
 WHERE scopes = '["*"]'
   AND user_id IN (SELECT id FROM users WHERE role IN ('owner','admin'));
```

## Error codes introduced

`user.not_found`, `user.last_owner`, `user.hierarchy`, `user.self`, `invite.gone`, `permission.unknown`, `permission.redundant`, `permission.requires_admin_trust`, `server.runtime_grants_conflict` (raised by phase 10's endpoint), `auth.2fa_enrolment_required`, `notify.url_invalid`, `notify.target_forbidden`, `notify.channel_not_found`.

## CLI additions

`mcm user reset-2fa <username>` (P8-FR-20).
