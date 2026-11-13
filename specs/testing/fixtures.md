# Recorded HTTP fixtures

## Approach

- External clients are tested against `wiremock::MockServer` instances started by `mcm_testkit::Upstreams`.
- Fixture bodies are **real responses recorded once** and trimmed (keep only needed versions/files to stay small), stored as JSON under `crates/<crate>/tests/fixtures/<vendor>/`.
- Binary downloads (jars, zips, JREs) are **synthesised** by test helpers (tiny zips, FakeJre tarballs), with hashes computed at test time and injected into templated fixtures (`{{sha1:server.jar}}`).
- Each fixture file has a sibling `.meta.toml`: source URL, recorded date, trimming notes.

## Recording

`cargo xtask record-fixtures <vendor>` (manual, network required) fetches the live endpoints listed in `xtask/fixtures.toml`, applies trimming rules (`jq` expressions), and writes files. A CurseForge key is read from `MCM_CURSEFORGE_API_KEY`; the key header is stripped from anything saved.

## Inventory (initial)

| Vendor | Fixture | Used by |
|---|---|---|
| Mojang | `version_manifest_v2.json` (trimmed to ~12 versions incl. 1.7.10, 1.12.2, 1.16.5, 1.17.1, 1.18.2, 1.20.4, 1.20.6, 1.21.1, latest, a snapshot), per-version JSON for each | mcm-installers, mcm-java |
| Paper | project, versions list, builds for 1.21.1 (both fill v3 and v2 shapes) | mcm-installers |
| Purpur | versions, build | mcm-installers |
| Fabric meta | `/v2/versions/game`, `/v2/versions/loader`, `/v2/versions/installer` | mcm-installers |
| Quilt meta | `/v3/versions/game`, `/v3/versions/loader`, installer maven metadata | mcm-installers |
| Forge | `promotions_slim.json`, `maven-metadata.xml` | mcm-installers |
| NeoForge | maven versions API JSON for `neoforge` and `forge` (1.20.1) | mcm-installers |
| Adoptium | `/v3/assets/latest/{8,17,21,25}/hotspot` for linux x64/aarch64 and alpine-linux; `/v3/info/available_releases` | mcm-java |
| CurseForge | search modpacks, get mod (pack with server pack; pack without; mod with `allowModDistribution=false`), files, file by id, `POST /v1/mods/files`, `POST /v1/fingerprints/432`, download-url (with and without `data`) | mcm-modplatforms |
| Modrinth | search, project, versions, version-file by hash, `.mrpack` index (synthesised zip) | mcm-modplatforms |
| Hangar | projects search, versions | mcm-modplatforms |
| Discord | webhook 204 / 429 with `retry_after` | mcm-notify |
| S3 | MinIO in Docker for integration (`testcontainers`), gated by `MCM_TEST_DOCKER=1`; default S3 tests use `object_store::memory` | mcm-backup |

## Failure fixtures

Every client has tests for: 404, 429 (+`Retry-After`), 500 with retry, malformed JSON, slow response (timeout), hash mismatch on download, truncated download (Content-Length mismatch). Named `<vendor>_<case>` e.g. `paper_builds_429_retries_then_succeeds`.

## Drift detection

Nightly `contract` job runs the same client tests against **live** endpoints in read-only mode (no downloads > 1 MiB) and diffs response schemas (field presence/types) against fixtures; failures open an issue rather than failing `main`.
