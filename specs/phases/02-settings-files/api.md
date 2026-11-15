# Phase 2 — API, WebSocket, migrations

Conventions: [api-conventions.md](../../architecture/api-conventions.md). All paths below are relative to `/api/v1`. `{id}` = `serverId`. All file paths in query/body are sandbox-relative strings (`""` = server root).

## Settings

| Method | Path | Perm | Request | Response |
|---|---|---|---|---|
| PATCH | `/servers/{id}` | per [server-api.md validation table](../../architecture/server-api.md#validation-table) | `UpdateServerRequest` (all optional) | `200 { server: ServerDto, warnings: Warning[] }` |
| GET | `/system/memory` | authenticated | — | `{ totalMb, availableMb, allocatedMaxMb /* Σ memoryMaxMb of all servers */ }` |
| GET | `/meta/server-properties-schema` | authenticated | — | `{ items: PropertySpecDto[] }` |
| GET | `/servers/{id}/properties` | `server.settings` | — | `200 PropertiesDto` + `ETag` (secret values `********` unless caller has `console.write`) |
| PUT | `/servers/{id}/properties` | `server.settings` | `If-Match` + `{ set: Record<string,string>, remove: string[] }` (`********` for a secret = keep) | `200 PropertiesDto` + `ETag` |
| GET | `/servers/{id}/eula` | `server.view` | — | `{ accepted, acceptedAt?, acceptedBy? }` |
| POST | `/servers/{id}/eula` | `server.settings` | `{ accept: boolean }` | `200 { accepted }` |

```ts
// Fields added to UpdateServerRequest by P2 (P1 fields unchanged; full table in architecture/server-api.md):
type UpdateServerRequestP2 = {
  memoryMinMb?: number; memoryMaxMb?: number; jvmArgs?: string[];
  env?: Record<string, string>; port?: number; launch?: LaunchSpec; javaPath?: string | null;
};
// Warning shape is defined in server-api.md; codes emitted in P2:
type WarningCode = "restart_required" | "memory_exceeds_host_free" | "memory_overcommitted_autostart" | "jvm_args_admin_freeform";
type PropertySpecDto = { key: string; type: "bool"|"int"|"enum"|"string"|"seed"|"secret";
  default: string; min?: number; max?: number; values?: string[]; legacyValues?: string[];
  group: string; since?: string; until?: string; managedSincePhase?: number; secret: boolean; description: string };
type PropertiesDto = {
  exists: boolean; etag: string | null; restartRequired: boolean;
  entries: { key: string; value: string; present: boolean; known: boolean; managed: boolean;
             managedSincePhase?: number; secret: boolean; redacted: boolean;
             valid: boolean; problem?: string }[];
};
```

## Players

`{list}` ∈ `whitelist | ops | banned-players | banned-ips`.

| Method | Path | Perm | Request | Response |
|---|---|---|---|---|
| GET | `/servers/{id}/players/{list}` | `server.view` | — | `{ items: Entry[], whitelistEnabled?, enforceWhitelist?, source: "file" }` |
| POST | `/servers/{id}/players/{list}` | `players.manage` | see below | `200 { items }` or `202 { applied: "pending" }` |
| DELETE | `/servers/{id}/players/{list}/{key}` | `players.manage` | — | `200 { items }` or `202` |
| POST | `/servers/{id}/players/whitelist/toggle` | `players.manage` | `{ enabled: boolean, enforce?: boolean }` | `200 { whitelistEnabled, enforceWhitelist }` |
| GET | `/players/lookup?name=&serverId=` | authenticated | — | `{ name, uuid, source: "mojang" \| "offline" }` |

Add bodies: whitelist `{ name }`; ops `{ name, level?: 1-4, bypassesPlayerLimit?: boolean }`; banned-players `{ name, reason?, expires?: string /* RFC3339 */ }`; banned-ips `{ ip, reason?, expires? }`.

### Player list shapes

Files are vanilla JSON; DTOs camelCase mirror them.

```jsonc
// whitelist.json
[{ "uuid": "069a79f4-44e9-4726-a5be-fca90e38aaf5", "name": "Notch" }]
// ops.json
[{ "uuid": "…", "name": "Notch", "level": 4, "bypassesPlayerLimit": false }]
// banned-players.json
[{ "uuid": "…", "name": "Griefer", "created": "2026-11-11 10:00:00 +0000", "source": "mcm:alice", "expires": "forever", "reason": "Griefing" }]
// banned-ips.json
[{ "ip": "203.0.113.7", "created": "…", "source": "mcm:alice", "expires": "forever", "reason": "…" }]
```

`source` written by mcm on direct edits = `mcm:<username>`; via command the server writes `Server` (console).

`banned-ips` add/remove rejects loopback, unspecified and trusted-proxy/relay addresses with `422 players.ban_ip_forbidden`.

## Files

| Method | Path | Perm | Request | Response |
|---|---|---|---|---|
| GET | `/servers/{id}/files?path=` | `files.read` | — | `{ path, entries: FileEntry[], truncated }` |
| GET/HEAD | `/servers/{id}/files/content?path=` | `files.read` | — | `200 text/plain` + `ETag` (`server.properties` secrets redacted without `console.write`) |
| PUT | `/servers/{id}/files/content?path=` | `files.write` | raw body ≤ 5 MiB; `If-Match` or `If-None-Match: *` | `200 { etag, size }` (`201` when created) |
| POST | `/servers/{id}/files/mkdir` | `files.write` | `{ path, parents?: boolean }` | `201 FileEntry` |
| POST | `/servers/{id}/files/move` | `files.write` | `{ from, to, overwrite?: boolean }` | `200 FileEntry` |
| POST | `/servers/{id}/files/copy` | `files.write` | `{ from, to, overwrite?: boolean }` | `202 { job }` |
| POST | `/servers/{id}/files/delete` | `files.write` | `{ paths: string[], permanent?: boolean }` | `200 { trashed: TrashEntry[], deleted: string[] }` |
| GET | `/servers/{id}/files/trash` | `files.read` | — | `{ items: TrashEntry[], totalBytes }` |
| POST | `/servers/{id}/files/trash/{entryId}/restore` | `files.write` | `{ to?: string }` | `200 FileEntry` |
| DELETE | `/servers/{id}/files/trash/{entryId}` | `files.write` | — | `204` |
| GET/HEAD | `/servers/{id}/files/download?path=` | `files.read` | `Range?` | `200`/`206` stream |
| GET | `/servers/{id}/files/download-zip?path=…&path=…` | `files.read` | — | `200 application/zip` stream |
| POST | `/servers/{id}/files/upload?dir=&overwrite=` | `files.write` | `multipart/form-data` (`file` parts), ≤ 100 MiB | `201 { entries: FileEntry[] }` |
| POST | `/servers/{id}/files/archive` | `files.write` | `{ paths: string[], dest: string, format: "zip"\|"tar.zst" }` | `202 { job }` |
| POST | `/servers/{id}/files/extract` | `files.write` | `{ path, destDir, conflict?: "skip"\|"overwrite"\|"fail" }` | `202 { job }` |
| GET | `/servers/{id}/files/search?q=&path=&limit=` | `files.read` | — | `{ items: FileEntry & { path }[], partial }` |

```ts
type FileEntry = { name: string; path: string; type: "file"|"dir"|"symlink"|"other";
  size: number; mtime: string; mode: number; target?: string; };
type TrashEntry = { id: string; originalPath: string; deletedAt: string; deletedBy: string; size: number; type: "file"|"dir" };
```

### Chunked upload protocol

| Step | Method + path | Request | Response |
|---|---|---|---|
| 1 Create | `POST /servers/{id}/uploads` | `{ path, size, sha256?, overwrite?: boolean }` | `201 { uploadId, received: 0, chunkSize: 8388608, expiresAt }` |
| 2 Status | `GET /servers/{id}/uploads/{uploadId}` (also `HEAD` with `Upload-Offset` header) | — | `{ uploadId, path, size, received, expiresAt }` |
| 3 Chunk | `PUT /servers/{id}/uploads/{uploadId}` | `Content-Range: bytes <start>-<end>/<size>`, body ≤ 64 MiB | `200 { received }` |
| 4 Complete | `POST /servers/{id}/uploads/{uploadId}/complete` | `{ sha256?: string }` | `201 FileEntry` |
| Abort | `DELETE /servers/{id}/uploads/{uploadId}` | — | `204` |

Rules: `start` must equal `received` (else `409 upload.offset_mismatch` with `received` in body so the client resumes); `end - start + 1` must equal body length (`400 upload.range_invalid`); writing past `size` → `upload.range_invalid`. Target existence checked at create **and** complete (`fs.exists` unless `overwrite`). Sha256 computed incrementally (state persisted with the offset so resume continues hashing). Body limit for this route is raised to 64 MiB + 1 KiB; request timeout disabled (idle timeout 60 s).

Client algorithm (`features/files/upload.svelte.ts`): create → PUT chunks of `chunkSize` sequentially (offsets must be contiguous) with retry (exponential, 5 attempts) → on network error `GET` status then continue from `received` → complete. Uploads persisted in `sessionStorage` (uploadId, file name, size, lastModified) so a reload can resume when the user re-selects the same file.

## Jobs

| Kind | Params | Result |
|---|---|---|
| `files.copy` | `{ from, to, overwrite }` | `{ entry: FileEntry }` |
| `files.archive` | `{ paths, dest, format }` | `{ entry, bytes, skipped: string[] }` |
| `files.extract` | `{ path, destDir, conflict }` | `{ files: number, bytes, skipped: { name, reason }[] }` |

## WebSocket

No new topics. `server:<id>` status payload gains `restartRequired: boolean`. Job progress over `jobs` (phase 0).

## Events (`chunkyard_core::events::Event`)

`ServerSettingsChanged { server_id, fields: Vec<String> }`, `ServerPlayersListChanged { server_id, list }`, `FilesChanged { server_id, paths }` (used later for cache invalidation; not exposed on WS in this phase).

## Migration

**None.** Phase 2 adds no tables: upload sessions are files in `<data>/uploads/`, trash payloads and `trash.json` metadata live in `<data>/state/<id>/trash/` (outside the server dir), `restartRequired` is in-memory supervisor state, and settings columns already exist in `servers` (phase 1).

## Error codes (new)

| Code | Status | When |
|---|---|---|
| `fs.invalid_path` | 400 | NUL, too long, bad component, targets the server root |
| `fs.escape` | 403 | `..` above root |
| `fs.symlink` | 403 | Operation through a symlink |
| `fs.not_found` | 404 | Missing path or parent |
| `fs.exists` | 409 | Target exists and no overwrite |
| `fs.not_a_directory` / `fs.is_a_directory` | 409 | Type mismatch |
| `fs.invalid_move` | 409 | Move dir into itself |
| `fs.binary` | 415 | Editor read of binary file |
| `fs.too_large_for_editor` | 413 | > 5 MiB |
| `fs.no_space` | 507 | ENOSPC, or extraction free-space precheck failed |
| `etag.required` | 428 | Missing `If-Match`/`If-None-Match` |
| `etag.mismatch` | 412 | Stale ETag |
| `upload.too_large` | 413 | > `max_upload_bytes` or multipart > 100 MiB |
| `upload.offset_mismatch` | 409 | Non-contiguous chunk |
| `upload.range_invalid` | 400 | Bad `Content-Range` |
| `upload.hash_mismatch` | 422 | sha256 differs |
| `upload.insufficient_space` | 507 | Pre-check failed |
| `upload.not_found` | 404 | Unknown/expired/other principal's session |
| `archive.limit_exceeded` | 422 | Size/entries/ratio limit (job error) |
| `archive.unsupported` | 415 | Unknown extension/format |
| `archive.corrupt` | 422 | Parse error (job error) |
| `properties.malformed` | 422 | Unparseable file (line in detail) |
| `properties.invalid` | 422 | Typed validation (field errors) |
| `properties.managed_key` | 422 | Edit of managed key |
| `settings.jvm_arg_not_allowed` | 422 | Non-admin arg not on the allow-list (field error names the token) |
| `settings.memory_in_jvm_args` | 422 | `-Xmx/-Xms` in args |
| `players.exists` | 409 | Duplicate add |
| `players.not_found` | 404 | Remove missing entry |
| `players.unknown` | 404 | Lookup failed |
| `players.file_invalid` | 422 | Bad JSON in list file |
| `players.ban_ip_forbidden` | 422 | `ban-ip`/`pardon-ip` of loopback/unspecified/proxy address |
| `upstream.mojang` | 502 | Profile API failure |
