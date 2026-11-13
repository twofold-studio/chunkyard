# Phase 4 — Requirements

Conventions: [patterns.md](../../architecture/patterns.md). Every FR lists crates, permission, audit action ([audit catalog](../../architecture/audit.md)) and events. Pipeline details: [import-pipeline.md](import-pipeline.md).

`mcm-modplatforms` depends on `mcm-core`, `mcm-fs`, `mcm-installers`, `mcm-download` only ([workspace-layout.md](../../architecture/workspace-layout.md)). Persistence goes through core repo traits (`PackImportRepo`, `ContentRepo`, `PendingDownloadRepo`, impls in `mcm-db`); all HTTP (API calls and file downloads) goes through `mcm_download::SafeHttp` / `Downloader` and its content-addressed cache.

## Crate structure (`mcm-modplatforms`)

```
crates/mcm-modplatforms/src/
├── lib.rs
├── platform.rs            # ModPlatform trait, Platform enum, ProjectKind, common models
├── error.rs               # ModPlatformError (thiserror) + Classify
├── curseforge/{client.rs, model.rs, fingerprint.rs, map.rs}
├── modrinth/{client.rs, model.rs, map.rs}
├── hangar/{client.rs, model.rs, map.rs}
├── pack.rs + pack/{plan.rs, cf_server_pack.rs, cf_client_pack.rs, mrpack.rs, detect_loader.rs, starter.rs, untrusted.rs}
├── content/{service.rs, scan.rs, deps.rs, updates.rs}
├── jarmeta.rs             # fabric.mod.json, quilt.mod.json, mods.toml, neoforge.mods.toml, plugin.yml, paper-plugin.yml
├── client_only.rs         # signal aggregation + bundled denylist
└── data/client_only_denylist.toml
```

```rust
#[async_trait]
pub trait ModPlatform: Send + Sync {
    fn id(&self) -> Platform;                                   // CurseForge | Modrinth | Hangar
    async fn search(&self, q: &SearchQuery) -> Result<Page<ProjectSummary>, ModPlatformError>;
    async fn project(&self, id: &ProjectRef) -> Result<Project, ModPlatformError>;
    async fn versions(&self, id: &ProjectRef, f: &VersionFilter) -> Result<Vec<ProjectVersion>, ModPlatformError>;
    async fn version(&self, id: &ProjectRef, v: &VersionRef) -> Result<ProjectVersion, ModPlatformError>;
    async fn download_info(&self, v: &ProjectVersion) -> Result<DownloadInfo, ModPlatformError>;
}
pub enum DownloadInfo {
    Direct { url: Url, file_name: String, size: Option<u64>, hashes: Hashes },
    ManualOnly { website_url: Url, file_name: String, hashes: Hashes, fingerprint: Option<u32> },
}
```

Platform-specific extras (fingerprints, `version_files`) are inherent methods on the concrete clients, used by the importers via narrow traits (`CfFingerprintLookup`, `ModrinthHashLookup`) so tests can fake them.

## Functional requirements

### Integration setup

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P4-FR-01 | CurseForge API key resolved from env `MCM_INTEGRATIONS__CURSEFORGE_API_KEY` > config > setting `integrations.curseforge_api_key` (encrypted). Admin can set/clear the setting and run a test call (`GET /v1/games/432`). Status reports `configured`, `source` (`env`/`config`/`settings`), `lastCheck`. Key never returned by any endpoint. | modplatforms, api, config | admin | `integrations.curseforge.update` (details `op: set|clear`) | — |
| P4-FR-02 | Any CF-backed endpoint without a key → `424 curseforge.api_key_missing`; CF `401/403` → `424 curseforge.api_key_invalid`. Modrinth/Hangar work without keys. | modplatforms, api | — | — | — |
| P4-FR-03 | All clients use `mcm_download::SafeHttp` (SSRF-safe, IP-pinned) and send `User-Agent: mcm/<version> (+<user_agent_contact>)`, timeout 20 s, retry idempotent GETs 3× on 5xx/timeouts (backoff 0.5/1/2 s), honour `429` `Retry-After` up to 30 s then fail `upstream.rate_limited`. Modrinth client tracks `X-Ratelimit-Remaining` and pre-emptively waits when < 5. | modplatforms, download | — | — | — |
| P4-FR-04 | Metadata responses cached in `cache/meta/` (via `mcm-download`'s cache, TTL per entry) keyed by URL+key-hash: search 5 min, project/versions 15 min, file/version by id 24 h. | modplatforms, download | — | — | — |

### Browse

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P4-FR-05 | Unified search across platforms: `q`, `kind` (`modpack`/`mod`/`plugin`/`datapack`), `mcVersion`, `loader`, `sort` (`relevance`/`downloads`/`updated`/`name`), cursor paging (limit ≤ 50). Unsupported filter for a platform/kind → `422 platform.unsupported_kind` (e.g. Hangar + `mod`). | modplatforms, api | any authenticated | — | — |
| P4-FR-06 | Project detail: name, summary, authors, icon, links, categories, downloads, description (Markdown/HTML from platform, sanitized client-side with DOMPurify), server-side support hint, `distributionAllowed` (CF). | modplatforms, api | authenticated | — | — |
| P4-FR-07 | Version list filtered by mcVersion/loader; each version shows release type, date, MC versions, loaders, `hasServerPack` (CF), file size. | modplatforms, api | authenticated | — | — |

### Pack import

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P4-FR-08 | `POST /servers/import-pack` and `POST /servers` with `source.kind = "pack"` ([server-api.md](../../architecture/server-api.md)) are equivalent: both create a server record (state `Installing`) and job `pack.import` from `{platform, projectId, fileId}` (Modrinth: `fileId` = version id) or `{uploadId}`, and both return the same `202 { server, job, warnings }`. | modplatforms, api, core | `server.create` | `pack.import` | `ServerCreated`, job events |
| P4-FR-09 | CurseForge: if the chosen file is itself `isServerPack`, or has `serverPackFileId`, use the **server-pack flow**; otherwise the **client-pack conversion flow**. User may force client-pack conversion (`preferServerPack=false`) because some server packs are stale/broken. | modplatforms | — | — | — |
| P4-FR-10 | Server-pack flow (unless P4-FR-30 triggers the fallback): download zip (hash-verified), extract via `mcm-fs` with archive limits, strip a single top-level directory, detect MC version + loader (detection order in [import-pipeline.md](import-pipeline.md#loader-detection)), install loader via phase-3 `Installer`, discard pack-bundled loader artifacts we replace, keep `mods/`, `config/`, `defaultconfigs/`, `kubejs/`, etc. Pack scripts are copied but never executed and are listed in the import report. | modplatforms, installers, fs, download | — | — | — |
| P4-FR-11 | Client-pack conversion: parse `manifest.json`, batch-resolve files (`POST /v1/mods/files`, `POST /v1/mods`), skip `required=false` files unless user opted in, download direct files, run client-only detection (P4-FR-14), copy `overrides/` (name from manifest). | modplatforms | — | — | — |
| P4-FR-12 | `.mrpack` import (API or upload): validate index, skip `env.server == "unsupported"`, include `optional` by default (user can deselect in plan preview), download from allow-listed hosts only, verify `sha512` (and `sha1`), apply `overrides/` then `server-overrides/` (later wins), install loader from `dependencies`. | modplatforms, fs, installers | — | — | — |
| P4-FR-13 | Before execution the job computes an **import plan** (files, sizes, loader, MC version, Java major, client-only suspects, manual downloads) stored in `pack_imports.plan` and visible via API while the job runs. | modplatforms | `server.view` | — | — |
| P4-FR-14 | Client-only detection combines signals (any strong signal ⇒ suspect): CF `gameVersions` contains `"Client"` but not `"Server"`; Modrinth `version_files` lookup by sha1 → project `server_side == "unsupported"`; jar metadata `fabric.mod.json` `"environment": "client"` / Quilt `minecraft.environment = "client"`; bundled denylist match on mod id or CF/Modrinth project id. Weak signal (logged only): Forge `mods.toml` `displayTest = "IGNORE_ALL_VERSION"`. Suspects are installed **disabled** (`.jar.disabled`) with `side = client_suspected` and a reason list. | modplatforms | — | — | — |
| P4-FR-15 | Manual downloads: any CF file with `downloadUrl == null` or project `allowModDistribution == false` becomes a `pending_manual_downloads` row (file name, website URL `<project websiteUrl>/files/<fileId>`, sha1, fingerprint, target path). See policy below. | modplatforms, core (`PendingDownloadRepo`) | — | — | `PackImportNeedsManual` |
| P4-FR-16 | If manual downloads exist, `pack.import` finishes everything else, then **succeeds** with `result.status = "needs_manual_downloads"`; the server stays `Stopped` with `pendingDownloads > 0` and `start` returns `409 pack.pending_downloads` unless `force=true`. Rationale in [import-pipeline.md](import-pipeline.md#job-model-for-manual-downloads). | modplatforms, core (`StartGuard` trait consulted by `ServerService::start`), api | — | — | — |
| P4-FR-17 | User uploads files (chunked upload `uploadId`, or several). Each file is matched by sha1, then CF fingerprint (murmur2), against unresolved rows of that server; matched files are moved to `target_path`; unmatched → `422 pending.no_match` with computed hashes. Uploading a zip of several jars is accepted (each entry matched). | modplatforms, fs, api | `content.manage` | `pack.manual.resolve` | `ContentInstalled` |
| P4-FR-18 | A pending row may be **skipped** (user accepts the mod missing). When no unresolved rows remain, `pack.finalize` job runs automatically (writes `installed_content`, re-runs client-only detection on the new jars, clears the start block). | modplatforms | `content.manage` | `pack.manual.skip`, `pack.finalize` | `PackImportCompleted` |
| P4-FR-19 | Import sets server defaults: flavor/loader/mc version from detection, Java via phase-3 auto-selection (`java: {mode:"auto"}` unless given), EULA per phase-2 flow (`acceptEula` in request). **Memory:** the pack suggestion (4096 MiB for > 50 mods, 6144 for > 150) applies **only when the request leaves `memoryMaxMb`/`memoryMinMb` unset**; an explicit value always wins, and if it is below the suggestion the response carries warning `pack.memory_below_suggestion`. | modplatforms, installers | — | — | — |
| P4-FR-20 | Cancelling `pack.import` deletes the partially-created server dir and record (unless `keepOnFailure=true`); failure keeps the server in `Stopped` with `install_failed` note and `<data>/state/<id>/install.log`. | modplatforms, core | — | `pack.import.cancel` | — |
| P4-FR-30 | **Starter-dependent server packs fall back to client-pack conversion.** A server pack is classified `starter` when any holds: ServerStarter `server-setup-config.yaml` at root; a top-level script (`startserver.sh`, `start.sh`, `ServerStart.sh`, `*.bat`) containing install/download markers (`curl`, `wget`, `Invoke-WebRequest`, `serverstarter`, `-jar .*installer.*\.jar`, `--installServer`) — Forge-generated `run.sh` (only `java @user_jvm_args.txt @libraries/…`) is **not** a marker; or `mods/` holds < 3 jars while the client manifest lists ≥ 10 required files. Then, if the client manifest is available (API-sourced import), the job switches to the client-pack conversion flow and records warning `pack.server_pack_starter_fallback` (plan, job result, import report). Uploaded server packs without a client manifest fail with `422 pack.server_pack_starter_unsupported` (hint: import via CurseForge browse). Rules in [import-pipeline.md](import-pipeline.md#starter-detection). | modplatforms | — | — | — |
| P4-FR-31 | **Pack metadata is untrusted input.** `manifest.json`, `modrinth.index.json`, `variables.txt`, pack `server.properties`, and any `mcm-backup.json`/launcher files inside packs are parsed with size caps (manifest/index ≤ 8 MiB, properties ≤ 1 MiB), paths only via `RelPath`, unknown fields ignored. The `LaunchSpec` is always derived by the phase-3 `Installer` (incl. its run-script parser) — never `Custom`, never taken from pack files; Java paths in packs are ignored (re-resolved by mcm). | modplatforms, fs, installers | — | — | — |

### Content management

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P4-FR-21 | `GET content` merges a directory scan (`mods/`, `plugins/`, `world/datapacks/`) with `installed_content` rows: each item has `id`, `kind`, `name`, `version`, `fileName`, `enabled`, `source` (`curseforge`/`modrinth`/`hangar`/`manual`), `side`, `projectId?`, `versionId?`. Unknown jars get a `manual` row on first scan, with metadata from `jarmeta`; rows whose file vanished are deleted. | modplatforms, fs | `server.view` | — | — |
| P4-FR-22 | Install from platform: resolve compatible version for the server's mcVersion + loader (or explicit `versionId`), compute dependency closure (required deps only; recursion depth ≤ 5, cycle-safe), report incompatibilities (`incompatible` relations, already-installed conflicting ids) in a sync **install plan**; executing creates `content.install` job. | modplatforms | `content.manage` | `content.install` | `ContentInstalled` |
| P4-FR-23 | Target directory by kind and flavor: mods → `mods/` (fabric/quilt/forge/neoforge only), plugins → `plugins/` (paper/purpur only), datapacks → `<level-name>/datapacks/`. Mismatch → `409 content.incompatible`. | modplatforms | — | — | — |
| P4-FR-24 | Enable/disable renames `x.jar` ↔ `x.jar.disabled` (datapacks: `x.zip` ↔ `x.zip.disabled`). | modplatforms, fs | `content.manage` | `content.enable` / `content.disable` | `ContentChanged` |
| P4-FR-25 | Remove deletes the file and row. Warns (response field `dependents[]`) if other installed content requires it; does not cascade. | modplatforms | `content.manage` | `content.remove` | `ContentChanged` |
| P4-FR-26 | Update check: Modrinth via `POST /v2/version_files/update` (batch by sha1 with loaders + game_versions); CF via files list per project filtered by `gameVersion` + `modLoaderType`; Hangar via versions list. Returns `{contentId, currentVersion, latestVersion, versionId}[]`. Manual items are identified via Modrinth hash lookup / CF fingerprint match first. | modplatforms | `server.view` | — | — |
| P4-FR-27 | Update one item = install new version, then remove old file, in a job; on failure old file is restored. | modplatforms | `content.manage` | `content.update` | `ContentChanged` |
| P4-FR-28 | Content mutations while the server is running are allowed; response includes `restartRequired: true` and the server topic emits `{type:"restartRequired"}`. | api, core | — | — | `ServerRestartRequired` |
| P4-FR-29 | Pack info: `GET /servers/{id}/pack` returns source pack, version, import date, pending downloads count, and `updateAvailable` (latest version id) — informational only (no upgrade action). | modplatforms | `server.view` | — | — |

## Policy: CurseForge distribution

CurseForge lets authors disable third-party distribution. mcm **must not** download such files automatically — no constructed `forgecdn` URLs, no scraping, no mirror lookups. The only automatic paths are `downloadUrl` from the API and `GET …/download-url`. A CI test greps the source for `forgecdn` and fails on any match outside this spec/fixture files.

## Edge cases and failure modes

| Case | Handling |
|---|---|
| Server pack zip has nested `ServerFiles-1.2/` dir | Strip single top-level dir if it's the only entry at root |
| Server pack contains a full Forge install (`libraries/`, `run.sh`) | Detect version from `libraries/net/minecraftforge/forge/<mc>-<ver>/`; re-run installer anyway (ensures integrity) unless args file + all libraries present and the user chose `reuseBundledLoader` |
| Server pack contains `server.properties`, `eula.txt` | `server.properties` merged: pack values kept except mcm-managed keys (`server-port`; RCON/management keys once P5 manages them; `server-ip` for router-only servers); `eula.txt` from pack ignored (EULA is the user's decision) |
| ServerStarter / script-installer server pack | P4-FR-30 fallback to client conversion; warning in report |
| Server pack missing mods present in client manifest | Not reconciled; server pack is authoritative |
| Manifest loader id formats | `forge-47.2.0`, `neoforge-21.1.77`, `fabric-0.15.11`, `quilt-0.26.0`; NeoForge 1.20.1 packs may say `neoforge-47.1.x` → maps to artifact `net.neoforged:forge` (phase-3 installer handles) |
| Unknown loader (`liteloader-*`, `rift`) | Fail `pack.unsupported_loader` |
| CF file deleted/archived (404 in batch) | Listed as `missing` in plan; required → import fails unless `allowMissing=true` |
| Hash mismatch | Retry download once; then fail file → job fails `download.hash_mismatch` |
| Modrinth download URL host not allow-listed | Skip file, error `download.host_not_allowed`; required file → job fails |
| `.mrpack` `path` escapes (`../`, absolute, `C:`) | `RelPath` rejects → `pack.invalid_manifest` |
| Overrides contain symlinks or > limits | Rejected by `mcm-fs` archive extractor (phase 2 limits) |
| Two files map to same path | Last wins, warning in report |
| Pack > 2 GiB or > 5000 files | `413 pack.too_large` |
| CF key revoked mid-import | Job fails `curseforge.api_key_invalid`; already-downloaded files stay in cache |
| User uploads correct file for a different server's pending row | Only rows of the URL's server are matched |
| Same jar under different name uploaded | Matched by hash; renamed to expected `file_name` |
| Fingerprint collision across pending rows | Prefer sha1; ambiguous → `pending.ambiguous_match` |
| Jar with unreadable metadata | Listed with file name, `version: null`; never fails scan |
| mcm restarts during import | Job marked `failed: interrupted` (phase 0 rule); server left `Stopped` with partial files; user may delete or retry (`POST /servers/{id}/reinstall-pack` is a non-goal; retry = delete + import) |

## Security considerations

- All archive entries and manifest paths through `RelPath`/`SandboxRoot`; overrides extraction uses the phase-2 extractor with zip-bomb limits.
- Download hosts: CF `downloadUrl` must be HTTPS and host in `{edge.forgecdn.net, mediafilez.forgecdn.net}` (as returned by API, not constructed); Modrinth allow-list per [modrinth-hangar-reference.md](modrinth-hangar-reference.md); Hangar download host `hangarcdn.papermc.io` (verify) or the project's `externalUrl` — external URLs are **not** followed automatically (shown as manual link).
- Markdown/HTML descriptions are untrusted: rendered only through DOMPurify with a strict allow-list (no `style`, no `iframe`, links `rel="noopener noreferrer nofollow"`); images allowed (CSP `img-src https:`).
- CF API key: `Secret<String>`; never logged; outbound only to `api.curseforge.com`; requests to other hosts never carry `x-api-key` (separate reqwest client for downloads).
- Pack-bundled scripts are inert files (parsed for starter markers only, never executed); README in UI warns that mods are arbitrary code.
- **Native single-trust (D1):** `content.manage` installs arbitrary jars, which on the native runtime equals code execution as the mcm OS user. On native servers it is admin-equivalent and grantable only to admin-trust users from P8 ([security.md](../../architecture/security.md#native-runtime-is-single-trust)); real isolation needs the Docker runtime (P10). The content page shows a notice on native servers.
- Pack metadata handling per P4-FR-31; pack contents are written only under `servers/<id>/`, never into `<data>/state/<id>/`.
- Uploaded manual-download files are hash-matched; unmatched uploads are deleted, never placed in `mods/`.
