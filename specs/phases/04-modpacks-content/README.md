# Phase 4 — Modpacks and content

## Goal

Create a working server from a CurseForge or Modrinth modpack in a few clicks, and browse/install/update/remove individual mods, plugins and datapacks from CurseForge, Modrinth and Hangar — without ever bypassing CurseForge's third-party distribution restrictions.

## Scope

| In | Detail |
|---|---|
| `chunkyard-modplatforms` crate | `ModPlatform` trait + `CurseForgeClient`, `ModrinthClient`, `HangarClient`; pack importers; jar metadata reader; client-only detection |
| CurseForge packs | Server-pack flow (`serverPackFileId`), client-pack conversion flow (`manifest.json`), manual-download flow for files with distribution disabled |
| Modrinth packs | `.mrpack` import from Modrinth API or upload |
| Uploaded packs | CurseForge zip or `.mrpack` uploaded via the phase 2 chunked upload |
| Content management | List (scan + DB), install with required dependencies, enable/disable, remove, update check, update one |
| Browse | Search per platform with MC version / loader auto-filled from the server |
| CurseForge key | Config/env or encrypted runtime setting; status and test endpoint |

## Non-goals (this phase)

- **Pack version updates** of an installed pack (e.g. pack 1.4 → 1.5). We show "update available" only. Rationale: correct pack upgrades need diffing user-modified configs and a pre-upgrade backup (phase 6). Revisit after phase 6.
- Importing a pack into an **existing** server (packs always create a new server). Reinstall-in-place follows with pack updates.
- Resource packs (server resource pack is a `server.properties` URL, handled in phase 2).
- Executing any script shipped in a pack (`startserver.sh`, `run.sh`, `*.bat`, ServerStarter) — never; starter-dependent server packs fall back to client-pack conversion (P4-FR-30).
- Auto-downloading CurseForge files whose distribution is disabled by constructing CDN URLs — never (policy, see [requirements.md](requirements.md#policy-curseforge-distribution)).
- Bedrock add-ons, FTB/ATLauncher/Technic pack formats.

## User stories

| ID | Story |
|---|---|
| US-1 | As an admin I paste my CurseForge API key once and can then browse CurseForge. |
| US-2 | As a user with `server.create`, I search "All the Mods", pick a version and get a running-ready server with the correct loader and Java. |
| US-3 | When a pack contains mods that CurseForge forbids third parties from downloading, I get a clear list with links, drag the files I downloaded into the browser, and the import finishes. |
| US-4 | I upload a `.mrpack` from my disk and get a server. |
| US-5 | On my Fabric server I search Modrinth for "Lithium", install it, and required dependencies (e.g. Fabric API) come along. |
| US-6 | On my Paper server I install a plugin from Hangar or Modrinth. |
| US-7 | I see every installed mod/plugin (including ones I dropped in via the file manager) with name, version, source, and can disable, remove or update it. |
| US-8 | Client-only mods from a client pack are detected and disabled automatically, and I can re-enable any of them. |
| US-9 | When a CurseForge server pack only contains a starter script (e.g. ServerStarter), mcm builds the server from the client pack instead and tells me why. |

## Dependencies

| Phase | Needed for |
|---|---|
| [0](../00-foundation/README.md) | Jobs, audit, settings table + secret encryption, auth |
| [1](../01-lifecycle-console/README.md) | Server entity, supervisor (start blocked while pending downloads) |
| [2](../02-settings-files/README.md) | `chunkyard-fs` `SandboxRoot`, archive extraction with limits, chunked uploads (`uploadId`), EULA handling |
| [3](../03-java-installers/README.md) | `Installer` trait for Forge/NeoForge/Fabric/Quilt/vanilla, `LaunchSpec` (incl. run-script parsing), Java auto-selection; `chunkyard-download` downloader + cache |

## Files

[requirements](requirements.md) · [api](api.md) · [ui](ui.md) · [tests](tests.md) · [import-pipeline](import-pipeline.md) · [curseforge-reference](curseforge-reference.md) · [modrinth-hangar-reference](modrinth-hangar-reference.md)

## Exit checklist

- [ ] All `P4-FR-*` implemented; every FR covered by tests listed in [tests.md](tests.md).
- [ ] Recorded fixtures for CurseForge, Modrinth, Hangar committed per [testing/fixtures.md](../../testing/fixtures.md) (API key stripped).
- [ ] Fuzz targets `cf_manifest_parse`, `mrpack_index_parse`, `jar_meta_parse` run clean for 60 s in CI.
- [ ] No code path constructs `edge.forgecdn.net`/`mediafilez.forgecdn.net` URLs (CI grep test `no_forgecdn_url_construction`).
- [ ] E2E: CF server-pack import, starter-pack fallback, CF manual-download flow, mrpack upload, mod install with dependency (all against mocked upstreams).
- [ ] Nightly smoke `smoke_curseforge_server_pack` and `smoke_mrpack_import` green at least once.
- [ ] OpenAPI + TS client regenerated; audit entries asserted for every mutating endpoint.
- [ ] User docs: "Importing modpacks", "Why do I need to download some mods manually?".

## Open questions / to verify

| Topic | Question | Detail |
|---|---|---|
| CurseForge | `download-url` behaviour for restricted files; batch limits; data pack classId; env-tag reliability | [curseforge-reference.md](curseforge-reference.md#open-questions--to-verify) |
| Modrinth | `version_files` batch limit; plugin/datapack facet conventions; GitHub redirect hosts | [modrinth-hangar-reference.md](modrinth-hangar-reference.md#open-questions--to-verify) |
| Hangar | Endpoint paths, pagination limits, CDN host | same |
| Denylist | Initial entries need evidence per mod (some "client" mods ship optional server parts) | [import-pipeline.md](import-pipeline.md#client-only-detection-algorithm) |
