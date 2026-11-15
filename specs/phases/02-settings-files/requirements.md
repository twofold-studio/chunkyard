# Phase 2 — Functional requirements

Conventions: [patterns.md](../../architecture/patterns.md). Each FR lists **Crates**, **Perm** (see [auth.md](../../architecture/auth.md#permission-catalog-per-server)), **Audit** action, **Events** (`chunkyard_core::events::Event`).

Service placement: trait declarations in `chunkyard-core::services` (`SettingsService`, `PropertiesService`, `PlayerListService`, `FileService`, `UploadService`, `MojangProfiles`, `DiskSpace`). Implementations live in `chunkyard-fs::service::*` and depend only on `chunkyard-core` traits (`ServerLookup`, `ServerRepo`, `ServerCommandSink`, `JobService`, `Clock`, `MojangProfiles`) so `chunkyard-fs` gains no `chunkyard-db`/`chunkyard-process`/`chunkyard-download` edge. `MojangProfiles` is implemented in `chunkyard-download` (over `SafeHttp`). `chunkyard-server::wiring` injects the concrete implementations. Server directory = `<data>/servers/<id>/` (untrusted, [security.md](../../architecture/security.md#untrusted-server-directory)); chunkyard-owned state (trash metadata, upload sessions) lives outside it.

## A. Sandbox and file primitives (`chunkyard-fs`)

**P2-FR-01 SandboxRoot.** Implement `SandboxRoot::resolve` exactly as in [security.md](../../architecture/security.md#sandboxroot-path-safety--chunkyard-fs). Implementation uses `cap-std` (`cap_std::fs::Dir`) which provides openat/`O_NOFOLLOW`-style confinement; every operation (read, write, rename, remove, metadata, list) is performed via a `Dir` handle, never a joined `PathBuf`. No name inside the server dir is reserved (mcm keeps no state there; a user-created `.mcm/` is an ordinary directory). Crates: chunkyard-fs. Perm: n/a (primitive).

**P2-FR-02 Symlinks.** Listings report `type: "symlink"` with `target` (from `readlinkat`, display only; target may be absolute). Read/write/download/rename-into/extract-through symlinks → `fs.symlink` (403). Deleting a symlink deletes the link itself (never the target). Crates: chunkyard-fs.

**P2-FR-03 Archive extraction.** `extract(src, dest_dir, limits, cancel, progress)` supports `.zip`, `.tar`, `.tar.gz`, `.tgz`, `.tar.zst`. Per-entry: name → `RelPath` (reject absolute, `..`, `\0`, Windows drive prefixes, backslash-separated traversal); skip and report (not fail) symlink, hardlink, device, FIFO entries; directories created 0750, files 0640, executable bit preserved only for `*.sh`. Limits from `[limits]`: total uncompressed ≤ `max_archive_uncompressed_bytes`, entries ≤ 200 000, per-entry ratio check per security.md. **Free-space precheck** before writing: free bytes on the data filesystem ≥ declared uncompressed total + max(10 %, 512 MiB), else `fs.no_space` (507); re-checked every 256 MiB written (actual sizes may exceed declared ones). Writes go to a staging dir `<data>/tmp/extract-<job>/` then entries are moved into place; conflict policy `skip | overwrite | fail` (default `fail` → `fs.exists` before any move). Crates: chunkyard-fs (`DiskSpace` trait from chunkyard-core for testability).

**P2-FR-04 Archive creation.** `create_archive(paths, format, dest)` for `zip` (deflate, level 6; `.jar`/`.png`/`.zip`/`.mca` stored uncompressed) and `tar.zst` (level from `backup.compression_level`, default 3). Symlinks are stored as nothing (skipped, reported). Output written to `<data>/tmp` then renamed into the sandbox. Crates: chunkyard-fs.

**P2-FR-05 Streaming zip.** `stream_zip(paths) -> impl Stream<Item=Bytes>` writes a zip with data descriptors (no seeking) via `async_zip`, bounded memory (≤ 1 MiB buffers), Zip64 when > 4 GiB or > 65 535 entries. Used by folder download. Crates: chunkyard-fs.

## B. `.properties` (`chunkyard-fs::properties`)

**P2-FR-06 Lossless parser.** Parse into `Vec<Line>` where `Line = Blank(raw) | Comment(raw) | Entry { raw: String /* may span continuation lines */, key, value }`. Semantics follow `java.util.Properties.load`: comment lines start (after leading whitespace) with `#` or `!`; key/value separator is the first unescaped `=`, `:` or whitespace (whitespace around separator skipped); escapes `\t \n \r \f \\ \uXXXX`, and `\<other>` → `<other>`; a line ending in an odd number of `\` continues, with the next line's leading whitespace removed; malformed `\u` → `properties.malformed` with line number. Input decoded as UTF-8, falling back to ISO-8859-1 if invalid UTF-8. Crates: chunkyard-fs.

**P2-FR-07 Minimal-diff writer.** `set(key, value)`/`remove(key)` mutate the model; serialisation emits untouched lines byte-for-byte; changed entries are re-emitted as `escape_key(key)=escape_value(value)` (escape `\`, `=`, `:`, `#`, `!`, leading space, control chars; non-ASCII → `\uXXXX` with surrogate pairs); new keys appended at the end; duplicate keys: the **last** occurrence is authoritative (Java semantics) and is the one edited. Atomic write via temp + rename, preserving file mode. Crates: chunkyard-fs.

## C. Settings (`chunkyard-fs::service::settings`, `chunkyard-api`)

**P2-FR-08 General settings.** `PATCH /servers/{id}` per the single contract in [server-api.md](../../architecture/server-api.md#update--patch-serversid) (fields, ranges, running-state rules, permissions, `200 { server, warnings }`). P2 enables the rows marked phase 2 there (`memoryMinMb`, `memoryMaxMb`, `jvmArgs`, `env`, `port`, `launch`) and adds this behaviour:

| Field | P2-specific behaviour |
|---|---|
| `memoryMaxMb` | Host RAM from `sysinfo`: `> total − 512` → 422; `> available` → warning `memory_exceeds_host_free`; Σ `memoryMaxMb` of `autoStart` servers > total → warning `memory_overcommitted_autostart` |
| `jvmArgs` | **Non-admins: allow-list** from [security.md § JVM arguments](../../architecture/security.md#jvm-arguments) (`crates/chunkyard-core/data/jvm_allowlist.toml`, each entry a full-token regex); any other token → `settings.jvm_arg_not_allowed` (field error names the token). `-Xms`/`-Xmx` → `settings.memory_in_jvm_args` for everyone. **Admins**: free-form (still ≤ 64 × 512 chars, no control chars) and the response carries warning `jvm_args_admin_freeform`. Shared vectors: `testdata/validation/jvm_args.json` (Rust + Vitest) |
| `env`, `launch` (custom), `javaPath` | admin only (`auth.forbidden`); `javaPath` absolute + executable (P1 form; P3 adds `java`) |
| `port` | uniqueness `server.port_in_use`; bind probe; must be stopped; also written to `server-port` via P2-FR-12 |
| any launch-affecting field while running | warning `restart_required` + P2-FR-09 |

On native-runtime servers `jvmArgs`, `env`, `launch` are code execution ([security.md § single-trust](../../architecture/security.md#native-runtime-is-single-trust)); P2 has only admin-trust users in practice, P8 enforces the grant rule. Crates: chunkyard-api (DTO, validation), chunkyard-core (allow-list data + `JvmArgPolicy`), chunkyard-fs (settings service). Perm: `server.settings`. Audit: `server.settings.update` (details: changed field names only). Events: `ServerSettingsChanged`.

**P2-FR-09 Restart required.** Supervisor `Status` gains `restartRequired: bool`, set when settings affecting launch (memory, jvm, java, port, env) or `server.properties`/EULA change while state ∈ {Starting, Running}; cleared on next start. Not persisted (native servers do not survive mcm restarts). Crates: chunkyard-process, chunkyard-core. Events: `ServerStatusChanged`.

**P2-FR-10 Properties read.** `GET …/properties` returns entries in file order merged with the schema ([properties-schema.md](properties-schema.md)): each entry `{key, value, known, managed, type?, valid}` plus schema-only keys absent from the file (`present: false`, with default). Missing file → empty entries + defaults (`exists: false`). Strong `ETag` = first 32 hex of sha256 of file bytes. Secret keys are redacted per P2-FR-32. Perm: `server.settings` (not `server.view`, since the file can contain other credentials such as resource-pack URLs with tokens). Crates: chunkyard-fs, chunkyard-api.

**P2-FR-11 Properties write.** `PUT …/properties` with `If-Match` (required; missing → 428 `etag.required`) and body `{ set: {key: string}, remove: [key] }`. Values validated per schema type for known keys (`properties.invalid` with per-key field errors); unknown keys accepted as raw strings (key must match `[A-Za-z0-9._-]{1,128}`). Keys currently managed for this server (P2-FR-12 registry) in `set`/`remove` → `properties.managed_key` (422). A secret key set to the placeholder `********` is treated as unchanged (P2-FR-32). After write, mcm re-applies managed values (P2-FR-12). Response: new entries + new ETag + `restartRequired`. Crates: chunkyard-fs, chunkyard-api. Perm: `server.settings`. Audit: `server.properties.update` (details: changed keys; values for non-secret keys only). Events: `ServerSettingsChanged`.

**P2-FR-12 Managed-key registry and sync.** `chunkyard-fs::properties::managed` holds a forward-compatible registry `Vec<ManagedKey { key, since_phase, applies: fn(&ServerCtx) -> bool, value: fn(&ServerCtx) -> Option<String> }>`; later phases append entries, never edit P2's. P2 registers **only `server-port`** (= `servers.port`). Reserved for later phases (listed so the UI can explain them): `enable-rcon`, `rcon.port`, `rcon.password`, `management-server-*` (P5), `server-ip` (P7 router-only exposure). P2 never touches RCON keys — RCON is not enabled before P5. `PropertiesService::apply_managed(server)` runs before every start (P1 start path) and after P2-FR-08/11/20 writes, via the minimal-diff writer. Crates: chunkyard-fs.

## D. EULA

**P2-FR-13 EULA status/accept.** `GET …/eula` → `{accepted: bool, acceptedAt?: string, acceptedBy?: string}` by parsing `eula.txt` (`eula=true`, case-insensitive) plus the last `server.eula.accept` audit entry. `POST …/eula {accept: true}` writes `eula.txt` with the Mojang-style header comment `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).` and `eula=true`. `{accept:false}` writes `eula=false`. Starting with `eula≠true` is still allowed (server prints its own EULA message and exits); UI warns first. Crates: chunkyard-fs, chunkyard-api. Perm: `server.settings`. Audit: `server.eula.accept`.

## E. Player lists

**P2-FR-14 List read.** `GET …/players/{list}` for `list ∈ whitelist | ops | banned-players | banned-ips` parses the vanilla JSON (shapes in [api.md](api.md#player-list-shapes)); missing file → `[]`; malformed → `players.file_invalid` (422) with the parse error line. Also returns `whitelistEnabled` (`white-list`) and `enforceWhitelist` for `whitelist`. Crates: chunkyard-fs, chunkyard-api. Perm: `server.view`.

**P2-FR-15 List mutate.** `POST …/players/{list}` (add) and `DELETE …/players/{list}/{key}` (remove; key = name or uuid for players, IP for `banned-ips`). Behaviour by state:

| State | Mechanism |
|---|---|
| Running (and `Status.ready`) | Send console command via `ServerCommandSink`: `whitelist add <name>` / `whitelist remove <name>`, `op <name>` / `deop <name>`, `ban <name> [reason]` / `pardon <name>`, `ban-ip <ip> [reason]` / `pardon-ip <ip>`. Then poll the JSON file (100 ms, up to 5 s) for the change → `200`; on timeout → `202 {applied:"pending"}`. Op `level` ≠ default and `bypassesPlayerLimit`, ban `expires` cannot be set by command → write file then send `<list> reload` where supported (`whitelist reload`; for ops/bans: `409 server.running` with hint to stop) |
| Starting/Stopping | `409 server.busy` |
| Stopped/Crashed | Direct JSON edit via `chunkyard-fs::players` (atomic write, 2-space pretty JSON like vanilla) |

From P5, servers on MC ≥ 1.21.9 with the management protocol enabled use it as the preferred live path for the whitelist/allowlist ([minecraft-protocols.md](../../architecture/minecraft-protocols.md#server-management-protocol-1219)); P2 always uses console commands when running.

Names validated `^[A-Za-z0-9_]{1,16}$`; IPs parsed as `IpAddr`; reasons ≤ 256 chars, no control chars. **`ban-ip`/`pardon-ip` reject** loopback (`127.0.0.0/8`, `::1`), unspecified (`0.0.0.0`, `::`), and addresses in `router.trusted_proxy_cidrs`/configured relay addresses (empty before P7/P9) → `players.ban_ip_forbidden` (422): behind the router/relay all players share those addresses ([security.md § player IP integrity](../../architecture/security.md#player-ip-integrity)). Duplicate add → `players.exists` (409). Crates: chunkyard-fs, chunkyard-api. Perm: `players.manage`. Audit: `players.whitelist.update` / `players.ops.update` / `players.bans.update` (details: `op` add|remove, `name` or `ip`). Events: `ServerPlayersListChanged`.

**P2-FR-16 Whitelist toggle.** `POST …/players/whitelist/toggle {enabled, enforce?}`: running → `whitelist on|off` command + properties write for `enforce-whitelist`; stopped → properties write of `white-list`/`enforce-whitelist`. Crates: chunkyard-fs, chunkyard-api. Perm: `players.manage`. Audit: `players.whitelist.update` (details: `enabled`, `enforce`).

**P2-FR-17 UUID resolution.** `GET /api/v1/players/lookup?name=&serverId=`: if the server's `online-mode=false` → offline UUID = `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)` (MD5, version 3 bits, IETF variant; **not** `uuid::Uuid::new_v3`, which prepends a namespace); otherwise the Mojang profile client in `chunkyard-download` (implements `chunkyard_core::services::MojangProfiles`, built on `SafeHttp`; base URL override only under the `test-hooks` feature), cached 24 h in memory (LRU 1 000), negative cache 10 min. Unknown → `players.unknown` (404). Upstream failure → `upstream.mojang` (502); UI then offers "add by name only" when stopped (vanilla resolves on next start). Used by P2-FR-15 direct edits to fill `uuid`. Crates: chunkyard-fs (`players::offline_uuid` pure fn, cache), chunkyard-download (`mojang::ProfileClient`). Perm: any authenticated principal.

## F. File manager (`chunkyard-fs::service::files`)

**P2-FR-18 List.** `GET …/files?path=` → entries `{name, type: file|dir|symlink|other, size, mtime, mode, target?}` sorted dirs-first then name (case-insensitive); max 10 000 entries (`truncated: true` beyond). Crates: chunkyard-fs, chunkyard-api. Perm: `files.read`.

**P2-FR-19 Read text.** `GET …/files/content?path=` → `text/plain; charset=utf-8` body + `ETag`. File > 5 MiB → `fs.too_large_for_editor` (413). Binary (NUL in first 8 KiB or invalid UTF-8) → `fs.binary` (415). `server.properties` content is redacted per P2-FR-32 (ETag is computed over the real bytes). Crates: chunkyard-fs, chunkyard-api. Perm: `files.read`.

**P2-FR-20 Write text.** `PUT …/files/content?path=` raw body ≤ 5 MiB; `If-Match: <etag>` for existing files, `If-None-Match: *` to create; neither → 428 `etag.required`; mismatch → 412 `etag.mismatch`. Atomic temp+rename preserving mode. Parent must exist (`fs.not_found`). Crates: chunkyard-fs, chunkyard-api. Perm: `files.write`. Audit: `files.write` (path, size). If path is `server.properties` → placeholder secrets restored (P2-FR-32), then P2-FR-12 + `restartRequired`.

**P2-FR-21 Mkdir / move / rename.** `POST …/files/mkdir {path}` (`parents: bool`), `POST …/files/move {from, to, overwrite}` (rename within the sandbox; `renameat`; moving a dir into itself → `fs.invalid_move`). Crates: chunkyard-fs, chunkyard-api. Perm: `files.write`. Audit: `files.mkdir`, `files.move`.

**P2-FR-22 Copy.** `POST …/files/copy {from, to, overwrite}` → job `files.copy` (always a job; progress by bytes). Crates: chunkyard-fs, chunkyard-core (jobs). Perm: `files.write`. Audit: `files.copy`.

**P2-FR-23 Delete to trash.** `POST …/files/delete {paths[], permanent: false}`. Non-permanent: `renameat` the item into `<data>/state/<id>/trash/<entryId>/payload` (same filesystem as `servers/`) with metadata in `<data>/state/<id>/trash/trash.json` (`{entryId, originalPath, deletedAt, deletedBy, size, type}`) — **outside** the user-writable server dir, so it can't be forged. Trash GC (hourly, per [security.md](../../architecture/security.md#sandboxroot-path-safety--chunkyard-fs)): entries younger than 24 h are never removed; older entries are removed oldest-first while free disk < max(10 %, 5 GiB); all entries older than 7 days are removed. `permanent: true` removes directly (UI double-confirms). Deleting the server root → `fs.invalid_path`. Crates: chunkyard-fs. Perm: `files.write`. Audit: `files.delete` (details: paths, `permanent`).

**P2-FR-24 Trash list/restore/purge.** `GET …/files/trash`, `POST …/files/trash/{entryId}/restore {to?}` (default original path, re-validated through `SandboxRoot`; conflict → `fs.exists`), `DELETE …/files/trash/{entryId}`. Crates: chunkyard-fs, chunkyard-api. Perm: `files.write` (list: `files.read`). Audit: restore → `files.move` (details `from: "trash:<entryId>"`, `to`); purge → `files.delete` (details `permanent: true`, `trashEntry`).

**P2-FR-25 Download.** `GET …/files/download?path=` streams with `Content-Length`, `Content-Disposition: attachment; filename*=UTF-8''…`, `Accept-Ranges: bytes`; single `Range` → 206; multi-range → full 200; unsatisfiable → 416. `HEAD` supported. `server.properties` is served redacted per P2-FR-32 (with the redacted length). Crates: chunkyard-fs, chunkyard-api. Perm: `files.read`. Audit: `files.download` (path only).

**P2-FR-26 Folder/multi download.** `GET …/files/download-zip?path=a&path=b` streams P2-FR-05 output; no `Content-Length`; filename `<slug>-<basename|files>-<ts>.zip`. A `server.properties` entry in the zip is redacted per P2-FR-32. Crates: chunkyard-fs, chunkyard-api. Perm: `files.read`. Audit: `files.download`.

**P2-FR-27 Simple upload.** `POST …/files/upload?dir=&overwrite=` multipart, ≤ 100 MiB total, files streamed to `<data>/tmp` then renamed. File names → single path component (reject `/`, `..`). Crates: chunkyard-fs, chunkyard-api. Perm: `files.write`. Audit: `files.upload`.

**P2-FR-28 Chunked resumable upload.** Session protocol in [api.md](api.md#chunked-upload-protocol): create → `PUT` chunks with `Content-Range` (any chunk size ≤ 64 MiB; must start at current `received` offset — out-of-order → `upload.offset_mismatch` 409 with current offset) → `complete` with optional sha256 verify → atomic move. Crates: chunkyard-fs, chunkyard-api. State persisted in `<data>/uploads/<id>/meta.json` + `data` (outside the server dir) (pre-check free disk ≥ size + 1 GiB, else `upload.insufficient_space` 507). Max size `limits.max_upload_bytes`. Sessions expire 24 h after last chunk (GC hourly). Only the creating principal may use the session. Perm: `files.write`. Audit: `files.upload` at completion.

**P2-FR-29 Archive / extract jobs.** `POST …/files/archive {paths[], dest, format: zip|tar.zst}` and `POST …/files/extract {path, destDir, conflict: skip|overwrite|fail}` → 202 + job (`files.archive`, `files.extract`), progress by bytes, cancellable (partial output removed). Allowed while the server runs; the UI warns when the destination is inside the active `level-name` directory. Extraction runs the P2-FR-03 free-space precheck. Crates: chunkyard-fs, chunkyard-core (jobs). Perm: `files.write`. Audit: `files.archive` / `files.extract`.

**P2-FR-30 Search by name.** `GET …/files/search?q=&path=&limit=100` case-insensitive substring/glob (`*`, `?`) over names, BFS, max depth 32, stops after 50 000 visited entries (`partial: true`), does not follow symlinks. Crates: chunkyard-fs, chunkyard-api. Perm: `files.read`.

**P2-FR-31 Per-server mutual exclusion.** File jobs (copy/archive/extract) count as mutating jobs for the "one job per server" rule except `files.archive` (read-only on sources). Crates: chunkyard-core jobs.

## G. Secrets in files

**P2-FR-32 Secret property redaction.** Keys typed `secret` in [properties-schema.md](properties-schema.md) (`rcon.password`, `management-server-secret`, `management-server-tls-keystore-password`) are replaced with the placeholder `********` for principals **without `console.write`** on the server, in: properties API (P2-FR-10), file read (P2-FR-19), single download (P2-FR-25), zip download (P2-FR-26). Principals with `console.write` see real values (they can already run any command). On write (P2-FR-11, P2-FR-20), a secret key whose new value is exactly `********` keeps the stored value; any other value replaces it. Redaction uses the lossless parser so only the value bytes change. Crates: chunkyard-fs (`properties::redact`, `properties::restore_placeholders`), chunkyard-api. Perm: n/a (applies to the above).

## Edge cases and failure modes

| Case | Behaviour |
|---|---|
| Path with `%2e%2e`, `..%2f`, Unicode lookalikes (`．．`) | Decoded once by axum `Query`; lookalikes are ordinary names (not `..`) → stay inside sandbox |
| Concurrent writes to same file | Second writer gets 412 via ETag |
| Server rewrites `server.properties` on start (vanilla re-saves with defaults) | Editor shows new ETag; user's pending edit gets 412 and a diff-reload prompt |
| Disk full mid-write/upload | Temp file removed; `fs.no_space` (507); original untouched |
| Archive declares small sizes but inflates larger | Re-check every 256 MiB written aborts with `fs.no_space`; staging removed |
| User creates `servers/<id>/.mcm/pid` or fake trash metadata | Ignored: mcm reads state only from `<data>/state/<id>/` |
| Placeholder `********` written for a secret that was never set | Treated as unchanged → key stays absent/empty |
| Upload completes but sha256 mismatch | `upload.hash_mismatch` (422); session kept so client can retry the last chunk or abort |
| Extract of zip with single top-level dir | No auto-strip in file manager (explicit; packs do their own stripping in phase 4) |
| Zip entry names in CP437 | Decoded per zip flag (UTF-8 bit) else CP437 |
| File replaced by symlink between resolve and open | Prevented: operations happen relative to opened dir handles with no-follow |
| Very long directory (100k files) | List truncated at 10 000; search partial |
| Player list file edited by the server while we write (stopped state race at start) | Start is blocked while a player-list write holds the per-server lock (`tokio::sync::Mutex` in the service, ≤ 1 s) |
| Mojang API down | Running server path unaffected (server resolves); stopped path offers name-only add |

## Security considerations

- **Native single-trust**: on native-runtime servers `files.write` (upload a plugin/mod, edit configs that load code) and `server.settings` (JVM args, env, launch) are arbitrary code execution as the mcm OS user, i.e. admin-equivalent ([security.md](../../architecture/security.md#native-runtime-is-single-trust)). P2 documents it in the UI permission hints; P8 enforces that only admin-trust users can hold them on native servers.
- All endpoints resolve paths only through `SandboxRoot`; handlers never see `PathBuf`. Nothing under `servers/<id>/` is read back as trusted state.
- Absolute host paths never appear in responses or problem details (only sandbox-relative paths).
- Secret properties redacted for principals without `console.write` (P2-FR-32); never logged; audit details for `server.properties.update` exclude secret values.
- Editor and listing render names as text; file content never interpreted as HTML.
- Download responses set `Content-Type: application/octet-stream` (except `.txt/.log` → `text/plain`) and `X-Content-Type-Options: nosniff`, so uploaded HTML can't execute in the panel origin.
- Upload sessions bound to principal; IDs are UUIDv7.
- JVM-arg **allow-list** for non-admins and admin-only `env`/`launch`/`javaPath` close T5; `ban-ip` guard closes T13.
- Mojang lookups go through `SafeHttp` (SSRF-safe, IP-pinned).
