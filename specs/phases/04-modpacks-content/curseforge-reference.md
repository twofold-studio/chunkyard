# CurseForge API reference (as used by mcm)

Base `https://api.curseforge.com` (configurable `integrations.curseforge_base_url`, test-only). Header `x-api-key: <key>`, `Accept: application/json`. Responses are wrapped: `{ "data": ..., "pagination"?: {...} }`. Client lives in `mcm-modplatforms::curseforge`.

## Constants

| Name | Value | Confidence |
|---|---|---|
| Minecraft `gameId` | 432 | high |
| classId modpacks | 4471 | high |
| classId mods | 6 | high |
| classId Bukkit plugins | 5 | medium — verify |
| classId data packs | 6945 | low — verify; otherwise datapacks via CF unsupported |
| `modLoaderType` | 0 Any, 1 Forge, 2 Cauldron, 3 LiteLoader, 4 Fabric, 5 Quilt, 6 NeoForge | high |
| `releaseType` | 1 release, 2 beta, 3 alpha | high |
| `hashes[].algo` | 1 sha1, 2 md5 | high |
| `relationType` | 1 EmbeddedLibrary, 2 OptionalDependency, 3 RequiredDependency, 4 Tool, 5 Incompatible, 6 Include | high |
| `sortField` (search) | 1 Featured, 2 Popularity, 3 LastUpdated, 4 Name, 5 Author, 6 TotalDownloads, … | medium — verify numbering |

## Endpoints

| Method + path | Purpose | Notes |
|---|---|---|
| `GET /v1/games/432` | Key test | 403 → invalid key |
| `GET /v1/mods/search` | Search | `gameId`, `classId`, `searchFilter`, `gameVersion`, `modLoaderType`, `sortField`, `sortOrder` (`asc`/`desc`), `index`, `pageSize` (≤ 50). `index + pageSize ≤ 10000` — cursor encodes `index`; beyond → empty page with `nextCursor=null` |
| `GET /v1/mods/{modId}` | Project | `allowModDistribution` (nullable bool), `links.websiteUrl`, `logo`, `authors`, `latestFilesIndexes` |
| `GET /v1/mods/{modId}/description` | HTML description | sanitized client-side |
| `GET /v1/mods/{modId}/files` | Files | filters `gameVersion`, `modLoaderType`, `index`, `pageSize` |
| `GET /v1/mods/{modId}/files/{fileId}` | One file | see fields below |
| `GET /v1/mods/{modId}/files/{fileId}/download-url` | Download URL | `{data: "<url>"}`; behaviour when distribution disabled — **verify** (expected 403 or `data: null`); treat both as manual |
| `POST /v1/mods` | Batch projects | body `{ "modIds": [..] }` (chunks of 500 — verify limit) |
| `POST /v1/mods/files` | Batch files | body `{ "fileIds": [..] }` (chunks of 500) |
| `POST /v1/fingerprints/432` | Match by fingerprint | body `{ "fingerprints": [u32,..] }` → `exactMatches[].file`, `unmatchedFingerprints` |

## File fields used

| Field | Use |
|---|---|
| `id`, `modId`, `displayName`, `fileName`, `fileDate`, `fileLength`, `releaseType` | Display, target file name |
| `downloadUrl` | `null` ⇒ manual download |
| `hashes[]` | sha1 for verification and manual matching |
| `fileFingerprint` | murmur2 match for manual uploads |
| `gameVersions[]` | Mixed strings: MC versions (`"1.20.1"`), loaders (`"Forge"`, `"NeoForge"`, `"Fabric"`, `"Quilt"`), environment (`"Client"`, `"Server"`) — env tags not always present |
| `isServerPack`, `serverPackFileId`, `parentProjectFileId` | Server-pack flow |
| `dependencies[] {modId, relationType}` | Dependency closure (relationType 3) and incompatibilities (5) |

## Fingerprint (murmur2)

```
bytes' = file bytes with every 0x09, 0x0A, 0x0D, 0x20 removed
fingerprint = MurmurHash2_32(bytes', seed = 1)   // u32
```

Implemented in `curseforge/fingerprint.rs`; tested with known vectors (record from real files via `xtask record-fixtures`; include one tiny synthetic vector computed by an independent implementation).

## manifest.json (client pack)

```json
{
  "minecraft": { "version": "1.20.1", "modLoaders": [ { "id": "forge-47.2.0", "primary": true } ] },
  "manifestType": "minecraftModpack", "manifestVersion": 1,
  "name": "Pack", "version": "1.4.0", "author": "x",
  "files": [ { "projectID": 238222, "fileID": 4712345, "required": true } ],
  "overrides": "overrides"
}
```

Validation: `manifestType == "minecraftModpack"`, `manifestVersion == 1`, exactly one primary loader (if several and none primary → first), ≤ 5000 files, ids positive.

## Website URL for manual download

`<mod.links.websiteUrl>/files/<fileId>` (e.g. `https://www.curseforge.com/minecraft/mc-mods/<slug>/files/<id>`). Shown to the user; never fetched by mcm.

## Open questions / to verify

- `download-url` endpoint response when `allowModDistribution=false`.
- Batch limits for `POST /v1/mods` and `/v1/mods/files`.
- Data pack classId and whether CF datapacks are worth supporting.
- Reliability of `"Client"`/`"Server"` tags in `gameVersions` (only present when authors set them).
- Whether `sortField` numbering above is current.
