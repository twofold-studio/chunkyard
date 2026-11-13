# Modrinth and Hangar reference (as used by mcm)

## Modrinth

Base `https://api.modrinth.com/v2` (configurable for tests). No key needed for read access. **User-Agent required**: `mcm/<version> (+<user_agent_contact>)`. Rate limit 300 requests/min per IP; headers `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`.

| Method + path | Purpose | Notes |
|---|---|---|
| `GET /search` | Search | `query`, `facets` (JSON array of OR-groups ANDed: `[["project_type:mod"],["versions:1.21.1"],["categories:fabric"],["server_side:required","server_side:optional"]]`), `index` (`relevance`/`downloads`/`updated`/`newest`/`follows`), `offset`, `limit` (≤ 100) |
| `GET /project/{id|slug}` | Project | `client_side`, `server_side` (`required`/`optional`/`unsupported`/`unknown`), `project_type` (`mod`/`modpack`/`plugin`? — plugins are `mod` with loaders `paper`/`spigot`/`bukkit`/`purpur`; verify), `body` (Markdown) |
| `GET /project/{id}/version` | Versions | `loaders=["fabric"]`, `game_versions=["1.21.1"]` (JSON-encoded query params) |
| `GET /version/{id}` | Version | `files[] {hashes{sha1,sha512}, url, filename, primary, size}`, `dependencies[] {version_id?, project_id?, file_name?, dependency_type: required|optional|incompatible|embedded}`, `loaders`, `game_versions` |
| `POST /version_files` | Lookup by hashes | body `{ "hashes": [...], "algorithm": "sha1" }` → map hash → version |
| `POST /version_files/update` | Update check | body `{ "hashes", "algorithm", "loaders", "game_versions" }` → map hash → latest version |
| `GET /projects?ids=[..]` | Batch projects | for client/server side lookups |

Search facets for server content: `server_side != unsupported` is expressed as `["server_side:required","server_side:optional"]`. Datapacks: `project_type:datapack` (verify) with loader `datapack`.

### `.mrpack` format

Zip containing `modrinth.index.json`, `overrides/`, `server-overrides/`, `client-overrides/`.

```json
{
  "formatVersion": 1, "game": "minecraft", "versionId": "1.4.0", "name": "Pack", "summary": "…",
  "files": [ {
    "path": "mods/lithium.jar",
    "hashes": { "sha1": "…", "sha512": "…" },
    "env": { "client": "required", "server": "required" },
    "downloads": [ "https://cdn.modrinth.com/data/…/lithium.jar" ],
    "fileSize": 123456
  } ],
  "dependencies": { "minecraft": "1.21.1", "fabric-loader": "0.16.5" }
}
```

| Rule | Detail |
|---|---|
| Validation | `formatVersion == 1`, `game == "minecraft"`, `dependencies.minecraft` present, ≤ 1 loader key among `forge`, `neoforge`, `fabric-loader`, `quilt-loader` |
| `env` | Missing `env` = required on both. Skip `server: "unsupported"`; `optional` included by default |
| Paths | Through `RelPath`; must not start with `/`, contain `..`, or a drive prefix |
| Downloads | First URL whose host is allow-listed: `cdn.modrinth.com`, `github.com`, `raw.githubusercontent.com`, `gitlab.com` (spec allow-list). HTTPS only. Redirects followed only to the same allow-list plus `objects.githubusercontent.com` (GitHub release asset redirect — verify) |
| Verification | sha512 mandatory (sha1 also checked); `fileSize` mismatch fails |

## Hangar (Paper plugins)

Base `https://hangar.papermc.io/api/v1`. Read endpoints are public (an API key/JWT exists for higher limits — not used). Details **to verify** against the live OpenAPI at `https://hangar.papermc.io/api-docs`.

| Method + path | Purpose | Notes |
|---|---|---|
| `GET /projects` | Search | `q`, `platform=PAPER`, `version=<mc>`, `limit` (≤ 25?), `offset`, `sort` |
| `GET /projects/{slug}` (or `/projects/{author}/{slug}`) | Project | Path shape changed historically — verify |
| `GET /projects/{slug}/versions` | Versions | `platform=PAPER`, `platformVersion=<mc>`; version has `downloads.PAPER { fileInfo {name, sizeBytes, sha256Hash}, externalUrl?, downloadUrl? }`, `pluginDependencies.PAPER[] {name, required, namespace?, externalUrl?}` |

- Only `downloadUrl` (Hangar CDN) is fetched automatically, verified with sha256. Versions with only `externalUrl` become a manual link (no pending-row machinery; user uses the file manager).
- Hangar dependencies reference other Hangar projects by name; resolved best-effort, unresolvable ones are reported as warnings.

## Open questions / to verify

- Modrinth `POST /version_files` max hashes per request.
- Modrinth plugin and datapack `project_type`/loader conventions for search facets.
- GitHub release redirect hosts for `.mrpack` downloads.
- Hangar endpoint path shapes, pagination limits, and `downloadUrl` host.
