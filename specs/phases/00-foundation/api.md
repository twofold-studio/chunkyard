# Phase 0 — API, WebSocket, migration, events

Conventions: [api-conventions.md](../../architecture/api-conventions.md). All bodies JSON camelCase; errors problem+json. "Auth" column: `none`, `session` (cookie only), `any` (cookie or bearer), `admin`.

## REST endpoints

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/healthz` | none | — | `200 {status:"ok"}` | `503 {status:"db_unavailable"}` |
| GET | `/api/v1/setup/status` | none | — | `200 {required: bool}` | — |
| POST | `/api/v1/setup` | none (+ `X-MCM-CSRF`, Origin per P0-FR-17) | `SetupRequest` | `201 MeResponse` + `Set-Cookie` | `401 setup.invalid_token`, `403 auth.csrf`, `409 setup.already_done`, `422 validation`, `429` |
| POST | `/api/v1/auth/login` | none | `LoginRequest` | `200 LoginResponse` (+ `Set-Cookie` when `kind:"session"`) | `401 auth.invalid_credentials`, `429 auth.throttled`, `422` |
| POST | `/api/v1/auth/login/totp` | none | `TotpLoginRequest` | `200 {kind:"session", me: MeResponse}` + `Set-Cookie` | `401 auth.totp_invalid`, `401 auth.challenge_invalid`, `429 auth.throttled` |
| POST | `/api/v1/auth/logout` | session | — | `204` + cookie cleared | `401` |
| GET | `/api/v1/auth/me` | any | — | `200 MeResponse` | `401 auth.required` |
| POST | `/api/v1/auth/password` | session | `ChangePasswordRequest` | `204` + new `Set-Cookie` | `403 auth.reauth_failed` (current wrong), `403 auth.session_required`, `422 auth.weak_password` |
| POST | `/api/v1/auth/totp/enroll` | session | — | `200 {secret: string, otpauthUri: string}` | `409 totp.already_enabled` |
| POST | `/api/v1/auth/totp/confirm` | session | `{code: string}` | `200 {recoveryCodes: string[]}` | `401 auth.totp_invalid`, `409 totp.no_pending_enrollment` |
| POST | `/api/v1/auth/totp/disable` | session | `{password: string, code: string}` | `204` | `403 auth.reauth_failed`, `409 totp.not_enabled` |
| POST | `/api/v1/auth/totp/recovery-codes` | session | `{password: string}` | `200 {recoveryCodes: string[]}` | `403 auth.reauth_failed`, `409 totp.not_enabled` |
| GET | `/api/v1/auth/sessions` | session | — | `200 {items: SessionInfo[]}` | `403 auth.session_required` |
| DELETE | `/api/v1/auth/sessions/{sessionId}` | session | — | `204` (revoking current also clears cookie) | `404 session.not_found` |
| POST | `/api/v1/auth/sessions/revoke-others` | session | — | `200 {revoked: number}` | — |
| GET | `/api/v1/auth/tokens` | session | — | `200 {items: ApiToken[]}` | — |
| POST | `/api/v1/auth/tokens` | session | `CreateTokenRequest` | `201 {token: ApiToken, secret: string}` | `403 auth.session_required`, `409 token.limit`, `422 validation` |
| DELETE | `/api/v1/auth/tokens/{tokenId}` | session | — | `204` | `404 token.not_found` |
| GET | `/api/v1/jobs` | any | query `serverId?`, `state?`, `kind?`, `limit`, `cursor` | `200 Page<Job>` | — |
| GET | `/api/v1/jobs/{jobId}` | any | — | `200 Job` | `404 job.not_found` |
| POST | `/api/v1/jobs/{jobId}/cancel` | any (creator or admin) | — | `202 Job` | `404`, `409 job.finished` |
| GET | `/api/v1/audit` | admin | query `actorUserId?`, `action?`, `serverId?`, `from?`, `to?`, `limit`, `cursor` | `200 Page<AuditEntry>` | `403` |
| GET | `/api/v1/system/info` | any | — | `200 SystemInfo` | — |
| GET | `/api/v1/openapi.json` | any | — | `200` OpenAPI 3.1 JSON | — |
| GET | `/api/v1/ws` | any | WS upgrade | `101` | `401`, `403 ws.origin` |
| POST | `/api/v1/debug/jobs` | admin; **exists only with `test-hooks` feature** | `{kind:"debug.sleep", params:{ms:number, failWith?:string}}` | `202 {job: Job}` | route absent (`404`) in release builds |

## Schemas

```ts
type SetupRequest   = { setupToken: string; username: string; password: string };
type LoginRequest   = { username: string; password: string };
type LoginResponse  = { kind: "session"; me: MeResponse } | { kind: "totp_required"; challenge: string };
type TotpLoginRequest = { challenge: string; code?: string; recoveryCode?: string };   // exactly one of code/recoveryCode
type SessionInfo = { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; current: boolean };
type ChangePasswordRequest = { currentPassword: string; newPassword: string };
type MeResponse = {
  user: { id: string; username: string; role: "owner" | "admin" | "user"; createdAt: string };
  principal: { kind: "session" } | { kind: "token"; tokenId: string; scopes: string[] };
  mustChangePassword: boolean;
  totpEnabled: boolean;
  isAdmin: boolean;
};
type CreateTokenRequest = { name: string /*1..64*/; scopes: string[] /* Permission | "*" */; serverIds?: string[]; expiresAt?: string | null };
type ApiToken = { id: string; name: string; prefix: string /* "mcm_ab12" */; scopes: string[]; serverIds: string[] | null;
                  expiresAt: string | null; lastUsedAt: string | null; createdAt: string };
type Job = { id: string; kind: string; serverId: string | null;
             state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
             progress: number | null /*0..1*/; message: string | null;
             error: { code: string; detail: string } | null; result: unknown | null;
             createdBy: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null };
type AuditEntry = { id: number; ts: string; actor: { userId: string | null; username: string | null; tokenId: string | null; ip: string | null };
                    action: AuditAction /* enum from chunkyard_core::audit::Action */; target: { type: string; id: string } | null; serverId: string | null;
                    outcome: "success" | "failure"; details: Record<string, unknown> | null };
type SystemInfo = { version: string; gitSha: string; buildDate: string; uptimeS: number;
                    platform: { os: string; arch: string; libc: "glibc" | "musl" | "unknown" };
                    dataDir: { path: string | null; freeBytes: number; totalBytes: number };
                    features: string[] /* includes "test-hooks" only in test builds */; instanceName: string };
type Page<T> = { items: T[]; nextCursor: string | null };
```

## WebSocket

Envelope per [api-conventions](../../architecture/api-conventions.md#envelope). Phase 0 topics: `jobs`.

| Direction | Message | Notes |
|---|---|---|
| C→S | `{op:"subscribe", id, topic:"jobs"}` | → `{op:"ack", id}` then events |
| S→C | `{op:"event", topic:"jobs", data:{type:"job", job: Job}}` | On every state change and throttled progress (≤ 4 Hz per job). Non-admins only receive jobs they created. |
| C→S | `{op:"unsubscribe", id, topic}` | → `ack`; unknown subscription → `error ws.not_subscribed` |
| C→S | `{op:"ping", id}` | → `{op:"pong", id}` |
| S→C | `{op:"error", id, problem}` | codes: `ws.unknown_op`, `ws.unknown_topic`, `ws.too_many_subscriptions`, `ws.bad_message` (invalid JSON; connection kept), `auth.forbidden` |

Close codes: `1008` auth expired/revoked, `1013` outbound queue overflow, `1001` server shutdown.

## Events (`chunkyard_core::events::Event`)

| Variant | Emitted when |
|---|---|
| `JobUpdated(Job)` | Any job state/progress change |
| `UserLoggedIn { user_id, ip }` | Successful login (consumed by notifications in phase 8) |
| `SessionsRevoked { user_id, session_ids: Option<Vec<..>> }` | Password change/reset, session revoke (one/others); WS hub closes the affected sockets (all of the user's except the caller's new session when `None`) |
| `TotpChanged { user_id, enabled }` | Enable/disable (P8 notifications may consume) |

## Error codes introduced

`setup_required`, `setup.invalid_token`, `setup.already_done`, `auth.required`, `auth.invalid_credentials`, `auth.throttled`, `auth.session_required`, `auth.csrf`, `auth.forbidden`, `auth.reauth_failed`, `auth.totp_invalid`, `auth.challenge_invalid`, `auth.weak_password`, `auth.password_change_required`, `totp.already_enabled`, `totp.not_enabled`, `totp.no_pending_enrollment`, `session.not_found`, `config.public_url_required` (startup), `config.secret_key_permissions` (startup), `config.csp_missing` (startup), `token.limit`, `token.not_found`, `job.not_found`, `job.finished`, `job.interrupted`, `job.panicked`, `ws.origin`, `ws.unknown_op`, `ws.unknown_topic`, `ws.not_subscribed`, `ws.too_many_subscriptions`, `ws.bad_message`, `rate_limited`, `validation`, `internal`.

## DB migration

File: `crates/chunkyard-db/migrations/<NNNN>_p0_foundation.sql`

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','user')),
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret_enc BLOB,            -- AAD users.totp_secret_enc:<id>
  totp_last_step INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash BLOB PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,   -- UUIDv7 shown in GET /auth/sessions
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash BLOB NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scopes TEXT NOT NULL,
  server_ids TEXT,
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);

CREATE TABLE totp_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,          -- argon2id PHC
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX totp_recovery_codes_user ON totp_recovery_codes(user_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor_user_id TEXT,
  actor_token_id TEXT,
  actor_ip TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  server_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure')),
  details TEXT
);
CREATE INDEX audit_ts ON audit_log(ts);
CREATE INDEX audit_server ON audit_log(server_id, ts);
CREATE INDEX audit_actor ON audit_log(actor_user_id, ts);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  server_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
  progress REAL,
  message TEXT,
  error_code TEXT,
  error_detail TEXT,
  params TEXT NOT NULL,
  result TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX jobs_server ON jobs(server_id, created_at);
CREATE INDEX jobs_state ON jobs(state);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

`must_change_password`, `api_tokens.server_ids`, `sessions.public_id` and the TOTP columns/table match or extend the sketch in [data-model.md](../../architecture/data-model.md). The numeric prefix is assigned at merge time ([patterns §3](../../architecture/patterns.md#3-repository-pattern)).

## Response headers (all routes)

`X-Request-Id`, security headers (P0-FR-28; CSP on HTML only), `Cache-Control: no-store` on all `/api/*` responses.
