# Phase 2 — Settings and file manager

## Goal

Let users configure a server without SSH: a typed `server.properties` editor, general/JVM settings, EULA acceptance, player lists (whitelist, ops, bans), and a full web file manager with a code editor, resumable uploads, downloads and archives — all confined to the server directory.

## Scope

| Area | Included |
|---|---|
| `chunkyard-fs` | `SandboxRoot` (no-follow, openat-style), file ops, trash (in `<data>/state/<id>/trash/`), archive create/extract with limits + free-space precheck, streaming zip writer, `.properties` lossless parser/writer + secret redaction, managed-key registry, player-list JSON editors, chunked upload store |
| `chunkyard-download` | Mojang profile client (`MojangProfiles` impl over `SafeHttp`) |
| `chunkyard-core` | JVM-arg allow-list data + `JvmArgPolicy`, new service traits |
| Settings | P2 rows of the `PATCH /servers/{id}` contract ([server-api.md](../../architecture/server-api.md)): memory with host-RAM check, JVM args (allow-list for non-admins, free-form + warning for admins), env, port, launch |
| Properties | Schema-driven typed editor (incl. 1.21.9 `management-server-*` keys), unknown keys as raw strings, managed keys read-only (P2: `server-port` only), secret values redacted without `console.write`, "restart required" indicator |
| EULA | `GET`/`POST` EULA endpoints and UI (phase 1 has the minimal POST) |
| Players | Whitelist, ops, banned players, banned IPs; via console commands when running, JSON files when stopped; Mojang/offline UUID resolution; `ban-ip` guard for loopback/proxy addresses |
| Files | List, read/write text (ETag), mkdir, move/rename, copy (job), delete to trash + restore, download (Range), folder download as streamed zip, multipart upload ≤ 100 MiB, chunked resumable upload, zip/tar.zst create, extract (jobs), name search |
| UI | Settings tabs, properties form, players tab, file manager, CodeMirror 6 editor |

## Non-goals

- Pre-1.7.6 list files (`white-list.txt`, `ops.txt`, `banned-*.txt`): shown only in the raw file editor.
- Editing plugin/mod config through typed forms (raw editor only).
- File permissions/ownership editing (`chmod`/`chown`), symlink creation.
- Real-time collaborative editing; file watching / live reload of open files.
- SFTP access (later phase).
- Enabling RCON or the management protocol (P5); `server-ip` management (P7).
- World-level management (upload/reset world) — phase 6.
- Content search inside files (grep) — only name search.

## User stories

| ID | Story |
|---|---|
| P2-US-01 | As an operator I edit `motd`, `max-players`, `difficulty` in a form with validation and see that a restart is required. |
| P2-US-02 | As an operator I change max memory and JVM flags, and I'm warned if memory exceeds host RAM. |
| P2-US-03 | As an operator I accept the Minecraft EULA in the UI before first start. |
| P2-US-04 | As a moderator I add a player to the whitelist, op someone, and ban a griefer with a reason — whether the server is running or not. |
| P2-US-05 | As an operator I browse the server directory, open `config/paper-global.yml`, edit it with syntax highlighting and save without clobbering a concurrent edit. |
| P2-US-06 | As an operator I drag a 4 GiB world zip into the browser, the upload survives a network blip, and I extract it. |
| P2-US-07 | As an operator I download the `world/` folder as a zip and a single log file. |
| P2-US-08 | As an operator I delete a file by mistake and restore it from trash. |

## Dependencies

- [Phase 0](../00-foundation/README.md): auth, jobs, audit, problem+json, OpenAPI pipeline.
- [Phase 1](../01-lifecycle-console/README.md): `servers` table, `ServerHandle` (send command, status), console ring, minimal EULA POST, `chunkyard-download::SafeHttp`, `<data>/state/<id>/` state dir.
- Architecture: [security.md § SandboxRoot](../../architecture/security.md#sandboxroot-path-safety--chunkyard-fs), [patterns.md](../../architecture/patterns.md), [filesystem-layout.md](../../architecture/filesystem-layout.md).

## Files in this phase

[requirements.md](requirements.md) · [properties-schema.md](properties-schema.md) · [api.md](api.md) · [ui.md](ui.md) · [tests.md](tests.md)

## Exit checklist

- [ ] All `P2-FR-*` implemented; every FR has passing tests listed in [tests.md](tests.md).
- [ ] Fuzz targets `sandbox_resolve`, `zip_extract`, `tar_extract`, `properties_parse` exist and pass the 60 s CI smoke.
- [ ] Proptests: sandbox never escapes; properties round-trip is byte-identical for unmodified files.
- [ ] Coverage ≥ 95 % for `chunkyard-fs::sandbox`, `chunkyard-fs::archive`, `chunkyard-fs::properties`.
- [ ] Secret redaction verified on properties API, file read, download and zip download for a principal without `console.write`.
- [ ] JVM-arg allow-list vectors (`testdata/validation/jvm_args.json`) pass in Rust and Vitest.
- [ ] A 4 GiB upload interrupted mid-way resumes and completes in E2E (`p2-files.spec.ts`, using a sparse generated file).
- [ ] Every mutating endpoint writes an audit entry (asserted in tests).
- [ ] OpenAPI + TS client regenerated; no `{@html}` introduced.
- [ ] Release notes: trash location (`<data>/state/<id>/trash`, kept ≥ 24 h), upload limits, managed properties, JVM-arg allow-list.

## Open questions / to verify

| Topic | Question |
|---|---|
| Mojang profile API | `GET https://api.mojang.com/users/profiles/minecraft/<name>` returns `{ "id": "<32 hex>", "name": "…" }`; unknown names historically `204`, now `404` — handle both. Rate limit (~600 req / 10 min) unverified. Alternative endpoint `https://api.minecraftservices.com/minecraft/profile/lookup/name/<name>` to evaluate. |
| properties encoding | Which MC versions read `server.properties` as UTF-8 vs ISO-8859-1. Writer emits non-ASCII as `\uXXXX`, which is correct for both; verify reader in real-server smoke. |
| Key removals | Exact versions where `spawn-animals`, `spawn-npcs` were removed and `accepts-transfers`, `bug-report-link`, `region-file-compression` added (see properties-schema.md). |
| Management protocol keys | Defaults and the TLS-keystore-password env/JVM-arg precedence per [minecraft-protocols.md](../../architecture/minecraft-protocols.md#server-management-protocol-1219); confirm in 1.21.9+ smoke. |
| Ban timestamp format | `created`/`expires` format `yyyy-MM-dd HH:mm:ss Z` — confirm unchanged in 1.21.x. |
