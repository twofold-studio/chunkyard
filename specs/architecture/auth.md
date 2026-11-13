# Authentication and authorization

> Current scope override: this is a single-owner service with simple email/password login. `MCM_AUTH__ENABLED=false` disables account setup and session requirements for local/protected deployments. Host/origin/CSRF checks still apply. Multi-user permissions, scoped API tokens and TOTP below are deferred, not prerequisites for the core. Current implemented contracts are in `docs/http-api.md`.


Owned by `mcm-auth`; HTTP extraction in `mcm-api::auth`.

## Principals

```rust
pub enum Principal {
    User  { user_id: UserId, role: Role, session_id: SessionHash },
    Token { user_id: UserId, role: Role, token_id: TokenId, scopes: Scopes },
}
```

A token acts as its owning user **intersected** with its scopes. Disabling a user invalidates all its sessions and tokens immediately.

## First-run setup

- If `users` is empty, the server is in **setup mode**: all API routes except `/healthz`, `/api/v1/setup/*`, and static assets return `503 setup_required`.
- `POST /api/v1/setup` creates the `owner` user. It requires the **setup token** printed to the log (and written to `<data>/setup-token`, mode 0600) on startup, preventing a race by anyone who reaches the port first. The token file is deleted after setup.
- **First-run CSRF**: `/setup` requests must carry `X-MCM-CSRF: 1` and an `Origin`. The allowed origin is `public_url` if configured; if not configured **and** mcm listens on loopback, the request's `Host` (scheme from the connection) is accepted as the origin until setup completes. Listening on a non-loopback address without `public_url` is a startup error (`config.public_url_required`), so `Host`-derived origins never apply to network-exposed instances.

## Sessions (browser)

| Property | Value |
|---|---|
| Token | 32 random bytes, base64url; only `sha256(token)` stored |
| Cookie | `mcm_session`; `HttpOnly; Secure` (unless `allow_insecure_http`); `SameSite=Lax`; `Path=/` |
| Lifetime | Idle 7 days, absolute 30 days; `last_seen_at` updated at most once per minute |
| Login | `POST /api/v1/auth/login {username, password}` → session, or `{ totpRequired: true, challenge }` when 2FA is enabled, completed by `POST /auth/login/totp {challenge, code}` (challenge valid 5 min, single use); argon2id verify even for unknown users (dummy hash) |
| Logout | Deletes the session row |
| Rotation | New session id on login and on password change (all other sessions revoked on password change) |
| Management (P0) | `GET /auth/sessions` lists own sessions (created, last seen, IP, user agent, current flag); `DELETE /auth/sessions/{id}` and `POST /auth/sessions/revoke-others` |
| Re-authentication | `POST /auth/password {current, new}` with a wrong `current` → **`403 auth.reauth_failed`** (not 401: the session is valid; the client must not log out). Same for TOTP disable and recovery-code regeneration |

## CSRF

- Cookie-authenticated **mutating** requests require header `X-MCM-CSRF: 1` **and** an `Origin` (or `Referer`) matching `public_url`'s origin (or, only during first-run on loopback, the `Host` origin — see above). Simple cross-site form posts cannot set custom headers, so this blocks CSRF without token storage.
- Bearer-token requests are exempt (no ambient credentials).
- WebSocket upgrade validates `Origin`.

## API tokens

- Format `mcm_<32 base62 chars>`; displayed **once** on creation; stored as `sha256` (high-entropy secret, so a fast hash is appropriate).
- `scopes`: list of `Permission` strings or `["*"]`; optional `serverIds` restriction; optional expiry.
- `"*"` = every **server** permission the owning user holds. Admin-only areas (users, settings, nodes, relays, storage targets, audit, Java runtimes, integrations) additionally require the **`admin`** scope (introduced in P8). **Upgrade semantics**: the P8 migration rewrites every existing `["*"]` token whose owner is `owner`/`admin` to `["*","admin"]`, so tokens created in P0–P7 keep working unchanged; tokens created after P8 get `admin` only when explicitly requested. Test: `p8_migration_star_tokens_keep_admin_access` (and `..._non_admin_owner_not_upgraded`).
- Sent as `Authorization: Bearer mcm_…`.

## Password policy

- argon2id, `m=19456 KiB, t=2, p=1` (OWASP minimum), parameters stored in PHC string so they can be raised later with rehash-on-login.
- Min length 10, max 256; checked against a bundled top-10k common-password list.
- See [Login throttling](#login-throttling).

### Login throttling

- Key 1: **(IP, username)** — after 5 failures, exponential delay (1 s, 2 s, 4 s … max 5 min) for that pair only; reset on success.
- Key 2: **per IP** — max 30 failed attempts / 10 min across all usernames → `429` for that IP.
- There is **no username-only lockout**, so an attacker cannot lock the owner out from other IPs.
- `X-Forwarded-For` is used only from `http.trusted_proxies`. In-memory, bounded LRU (100k keys).

## Roles and permissions

| Role | Meaning |
|---|---|
| `owner` | Exactly one or more; all permissions, manages admins, cannot be deleted if last owner |
| `admin` | All server permissions on all servers; manage users (not owners), system settings |
| `user` | Only what `server_permissions` grants per server (P8). Before P8, only owner/admin exist in practice. On native servers, `user`s cannot hold code-execution permissions ([security.md](security.md#native-runtime-is-single-trust)) |

### Permission catalog (per server)

| Permission | Allows |
|---|---|
| `server.view` | See server, status, metrics, players |
| `server.power` | start / stop / restart / kill |
| `server.settings` | Edit settings, properties, JVM, Java |
| `server.delete` | Delete server |
| `server.create` | (global) create/clone servers |
| `console.read` | Subscribe to console |
| `console.write` | Send commands |
| `files.read` | Browse/download |
| `files.write` | Upload/edit/delete/archive |
| `players.manage` | Whitelist/ops/bans |
| `content.manage` | Install mods/plugins/packs |
| `backups.read` / `backups.manage` | List+download / create, restore, delete |
| `schedules.manage` | CRUD schedules |
| `proxy.manage` | Routes for this server |

Global scopes (tokens only): `metrics.read` (Prometheus endpoint, P5), `admin` (admin-only areas, P8).

Global admin-only areas: users, nodes, relay connections, storage targets, notification channels, system settings, integrations (CurseForge key), Java runtimes, audit log (full).

### Enforcement

- Each handler declares its requirement via an extractor: `RequirePerm<ServerPower>` reads `{serverId}` from the path and calls `AuthService::authorize(&principal, perm, Some(server_id))`.
- `authorize` is the single decision function; unit-tested with a table of (role, grants, scopes, perm) → allow/deny.
- Unauthorized access to a server the principal cannot `server.view` returns **404** (no existence leak); otherwise **403**.
- List endpoints filter by `server.view`.

## Two-factor (P0)

TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step, reuse of the last accepted step rejected), secret encrypted at rest, 10 one-time recovery codes (argon2id-hashed). Enrollment requires confirming a code. P8 adds owner-enforced 2FA for admins.
