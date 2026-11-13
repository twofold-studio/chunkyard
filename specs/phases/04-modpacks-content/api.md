# Phase 4 — API, WebSocket, migration

Conventions: [api-conventions.md](../../architecture/api-conventions.md). All paths under `/api/v1`. Handlers in `mcm-api/src/routes/{platforms,packs,content,integrations}.rs`.

## Shared DTOs

```ts
type Platform = "curseforge" | "modrinth" | "hangar";
type SearchKind = "modpack" | "mod" | "plugin" | "datapack";   // browse/search only
type ContentKind = "mod" | "plugin" | "datapack";              // installed content (packs live in pack_imports)
type Loader = "forge" | "neoforge" | "fabric" | "quilt" | "paper" | "purpur" | "datapack";

interface ProjectSummary { platform: Platform; id: string; slug: string; name: string; summary: string;
  iconUrl: string | null; authors: string[]; downloads: number; updatedAt: string;
  kinds: SearchKind[]; loaders: Loader[]; mcVersions: string[]; serverSide: "required"|"optional"|"unsupported"|"unknown" }
interface Project extends ProjectSummary { descriptionFormat: "markdown" | "html"; description: string;
  websiteUrl: string; sourceUrl: string | null; distributionAllowed: boolean | null }
interface ProjectVersion { id: string; name: string; versionNumber: string; releaseType: "release"|"beta"|"alpha";
  publishedAt: string; mcVersions: string[]; loaders: Loader[]; hasServerPack: boolean;
  serverPackVersionId: string | null; files: { fileName: string; size: number; primary: boolean }[];
  dependencies: { projectId: string; versionId: string | null; kind: "required"|"optional"|"incompatible"|"embedded" }[] }
interface ContentItem { id: string; kind: ContentKind; name: string; version: string | null; fileName: string;
  enabled: boolean; source: Platform | "manual"; side: "server"|"both"|"client_suspected"|null;
  sideReasons: string[]; projectId: string | null; versionId: string | null; installedAt: string }
interface PendingDownload { id: string; projectId: string; fileId: string; fileName: string; websiteUrl: string;
  sha1: string | null; targetPath: string; state: "pending" | "resolved" | "skipped" }
```

## Integrations (admin)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/admin/integrations` | — | `{ curseforge: { configured, source: "env"|"config"|"settings"|null, lastCheck: {at, ok, code?} | null }, modrinth: {reachable?}, hangar: {...} }` |
| PUT | `/admin/integrations/curseforge` | `{ apiKey: string }` (validated by test call first; `422 curseforge.api_key_invalid` if rejected) | `204` |
| DELETE | `/admin/integrations/curseforge` | — | `204`; `409 integrations.set_by_env` if source is env/config |
| POST | `/admin/integrations/curseforge/test` | — | `{ ok, code? }` |

## Browse (any authenticated user)

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/platforms` | — | `{ items: [{ platform, available, kinds: SearchKind[], reason? }] }` |
| GET | `/platforms/{platform}/search` | `q, kind, mcVersion?, loader?, sort?, cursor?, limit?` | `{ items: ProjectSummary[], nextCursor, total: number | null }` |
| GET | `/platforms/{platform}/projects/{projectId}` | — | `Project` |
| GET | `/platforms/{platform}/projects/{projectId}/versions` | `mcVersion?, loader?, cursor?` | `{ items: ProjectVersion[], nextCursor }` |

## Pack import

| Method | Path | Perm | Request | Response |
|---|---|---|---|---|
| POST | `/servers/import-pack` | `server.create` | `{ name, source: { platform: "curseforge"|"modrinth", projectId, fileId } | { platform: "upload", uploadId }, preferServerPack?: true, includeOptional?: true, allowMissing?: false, loaderOverride?: {kind, version}, memoryMinMb?, memoryMaxMb?, port?, java?, acceptEula: boolean, keepOnFailure?: false }` (Modrinth `fileId` = version id) | `202 { server: ServerDto, job, warnings }` — identical to `POST /servers` with `source.kind="pack"` ([server-api.md](../../architecture/server-api.md)) |
| POST | `/servers/import-pack/preview` | `server.create` | same `source` (+ flags) | `200 ImportPlanDto` (sync, ≤ 30 s; downloads pack manifest only — for uploads reads index from the upload) |
| GET | `/servers/{id}/pack` | `server.view` | — | `{ platform, projectId, versionId, name, version, importedAt, state: "importing"|"needs_manual"|"finalizing"|"complete"|"failed", pendingCount, report, updateAvailable: {versionId, versionNumber} | null }` or `404 pack.none` |
| GET | `/servers/{id}/pending-downloads` | `server.view` | — | `{ items: PendingDownload[] }` |
| POST | `/servers/{id}/pending-downloads/resolve` | `content.manage` | `{ uploadIds: string[] }` | `200 { matched: [{pendingId, fileName}], unmatched: [{fileName, sha1, fingerprint}], remaining: number, finalizeJob: Job | null }` |
| POST | `/servers/{id}/pending-downloads/{pendingId}/skip` | `content.manage` | — | `200 { remaining, finalizeJob }` |
| POST | `/servers/{id}/start` (phase 1, extended) | `server.power` | `{ force?: boolean }` | `409 pack.pending_downloads` when blocked |

`ImportPlanDto` mirrors `ImportPlan` ([import-pipeline.md](import-pipeline.md#importplan)) in camelCase.

## Content

| Method | Path | Perm | Request | Response |
|---|---|---|---|---|
| GET | `/servers/{id}/content` | `server.view` | `?kind=` | `{ items: ContentItem[] }` (scan runs inline, ≤ 2 s budget; cached 10 s) |
| POST | `/servers/{id}/content/plan` | `content.manage` | `{ platform, projectId, versionId? }` | `{ install: [{platform, projectId, versionId, fileName, size, reason: "requested"|"dependency"}], conflicts: [{projectId, reason}], manual: PendingDownload[], restartRequired }` |
| POST | `/servers/{id}/content` | `content.manage` | `{ platform, projectId, versionId?, withDependencies?: true }` | `202 { job }` |
| PATCH | `/servers/{id}/content/{contentId}` | `content.manage` | `{ enabled: boolean }` | `200 { item: ContentItem, restartRequired }` |
| DELETE | `/servers/{id}/content/{contentId}` | `content.manage` | — | `200 { dependents: ContentItem[], restartRequired }` |
| POST | `/servers/{id}/content/check-updates` | `server.view` | — | `{ items: [{contentId, currentVersion, latest: {versionId, versionNumber, publishedAt}}], checkedAt }` |
| POST | `/servers/{id}/content/{contentId}/update` | `content.manage` | `{ versionId? }` | `202 { job }` |
| POST | `/servers/{id}/content/rescan` | `content.manage` | — | `{ items: ContentItem[] }` |

Manual CF dependencies in a single-mod install use the same pending-download rows and endpoints (`pack_import_id = NULL`).

## Jobs (kinds added)

`pack.import`, `pack.finalize`, `content.install`, `content.update`. `result` shapes:
- `pack.import`: `{ status: "complete" | "needs_manual_downloads", pending: number, flow: "cf_server"|"cf_client"|"mrpack", warnings: Warning[], report }`
- `content.install` / `content.update`: `{ installed: ContentItem[], pending: number }`

## WebSocket

No new topics. Additional `server:<id>` payloads:

| `data` | When |
|---|---|
| `{ type: "content", changed: true }` | Any content mutation / scan diff |
| `{ type: "pendingDownloads", remaining: number }` | Resolve/skip/import completion |
| `{ type: "restartRequired" }` | Content changed while running |

## Events (`mcm_core::events::Event`)

`ContentInstalled { server_id, items }`, `ContentChanged { server_id }`, `PackImportNeedsManual { server_id, pending }`, `PackImportCompleted { server_id }`, `ServerRestartRequired { server_id, reason }`.

## Migration `crates/mcm-db/migrations/<NNNN>_p4_content.sql`

Number assigned at merge time ([patterns.md §3](../../architecture/patterns.md#3-repository-pattern)). Supersedes the phase-4 sketch in [data-model.md](../../architecture/data-model.md) by adding `pack_imports` and linking pending rows to it. Repos: `PackImportRepo`, `ContentRepo`, `PendingDownloadRepo` traits in `mcm-core`, impls in `mcm-db`.

```sql
CREATE TABLE pack_imports (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('curseforge','modrinth','upload')),
  project_id TEXT, version_id TEXT, name TEXT NOT NULL, version TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('cf_server','cf_client','mrpack')),
  state TEXT NOT NULL CHECK (state IN ('importing','needs_manual','finalizing','complete','failed','cancelled')),
  plan TEXT, report TEXT,                      -- JSON
  import_job_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE installed_content (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mod','plugin','datapack','resourcepack')),   -- no 'modpack': packs are pack_imports rows
  platform TEXT NOT NULL CHECK (platform IN ('curseforge','modrinth','hangar','manual')),
  project_id TEXT, version_id TEXT, name TEXT NOT NULL, version TEXT,
  file_path TEXT NOT NULL,                     -- sandbox-relative, without ".disabled"
  sha1 TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  side TEXT CHECK (side IN ('server','both','client_suspected')),
  side_reasons TEXT NOT NULL DEFAULT '[]',
  installed_at INTEGER NOT NULL,
  UNIQUE (server_id, file_path)
);
CREATE INDEX installed_content_project ON installed_content(server_id, platform, project_id);

CREATE TABLE pending_manual_downloads (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  pack_import_id TEXT REFERENCES pack_imports(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,                        -- job that created the row
  project_id TEXT NOT NULL, file_id TEXT NOT NULL, file_name TEXT NOT NULL,
  website_url TEXT NOT NULL, sha1 TEXT, fingerprint INTEGER, target_path TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','resolved','skipped')),
  resolved_at INTEGER
);
CREATE INDEX pending_server ON pending_manual_downloads(server_id, state);
```

## Warning codes (in `warnings[]`, job `result.warnings`, import report)

| Code | When |
|---|---|
| `pack.server_pack_starter_fallback` | Server pack needed a starter; client-pack conversion used instead (P4-FR-30) |
| `pack.memory_below_suggestion` | Explicit memory below the pack's suggestion (P4-FR-19) |
| `content.native_code_execution` | Content mutation on a native-runtime server (informational, D1) |

## Error codes

| Code | Status | When |
|---|---|---|
| `curseforge.api_key_missing` | 424 | CF used without key |
| `curseforge.api_key_invalid` | 424 (422 on PUT) | CF returned 401/403 |
| `integrations.set_by_env` | 409 | Clearing a key set via env/config |
| `platform.unsupported_kind` | 422 | e.g. Hangar + `mod` |
| `upstream.curseforge` / `upstream.modrinth` / `upstream.hangar` | 502 | Upstream 5xx/malformed after retries |
| `upstream.rate_limited` | 503 | 429 beyond retry budget (`Retry-After` forwarded) |
| `pack.invalid_manifest` | 422 | Manifest/index invalid, path escape |
| `pack.unsupported_loader` | 422 | Unknown loader |
| `pack.server_pack_starter_unsupported` | 422 | Uploaded starter-dependent server pack without a client manifest (P4-FR-30) |
| `pack.too_large` | 413 | Size/file-count caps |
| `pack.missing_files` | 422 | Required file 404 and `allowMissing=false` |
| `pack.none` | 404 | Server not created from a pack |
| `pack.pending_downloads` | 409 | Start blocked |
| `pending.no_match` / `pending.ambiguous_match` | 422 | Manual upload matching |
| `content.not_found` | 404 | |
| `content.incompatible` | 409 | Kind/loader mismatch with server flavor |
| `content.no_compatible_version` | 422 | No version for mcVersion+loader |
| `content.conflict` | 409 | Incompatible relation with installed content (unless `force`) |
| `download.hash_mismatch` | 502 | After one retry |
| `download.host_not_allowed` | 422 | URL outside allow-list |
| `server.busy` | 409 | Another mutating job on the server |
