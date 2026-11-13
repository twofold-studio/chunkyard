# Phase 3 — Java runtimes and server installers

## Goal

Create a working server of any mainstream flavor and version in a few clicks, with mcm downloading and selecting the right Java itself. After this phase no user needs Java installed on the host.

## Scope

| Area | Included |
|---|---|
| `mcm-java` | System JRE discovery, managed Temurin JRE downloads from Adoptium, `java_runtimes` table, MC-version → Java-major requirement resolution |
| `mcm-installers` | `Installer` trait; vanilla, Paper, Purpur, Fabric, Quilt, Forge, NeoForge, **Velocity, BungeeCord, Waterfall**; `run.sh` parser for Forge/NeoForge launch derivation; `LaunchSpec` output |
| `mcm-download` | Shared downloader with content-addressed cache and hash verification (over `SafeHttp`), used by java and installers |
| Jobs | `java.install`, `server.install` (create and reinstall/version switch) |
| Server create | Wizard with flavor → MC version → loader/build → Java (auto) → memory/port → EULA |
| Version switch | Reinstall/upgrade/downgrade an existing stopped server; previous launch artefacts kept in `<data>/state/<id>/previous/` |
| UI | Create wizard, server "Software" card, admin Java runtimes page |

## Non-goals

- Spigot/CraftBukkit (BuildTools compile) — possibly later.
- Proxy configuration UI (proxies are installed and run; configs are edited in the file editor) and proxy↔backend auto-wiring (forwarding secrets).
- Folia, Mohist/Arclight hybrids, SpongeVanilla/Forge — later, via the same trait.
- Bedrock Dedicated Server.
- Forge < 1.7.10 and Minecraft < 1.7.10 for modded; vanilla versions without a server download in the manifest are listed as unavailable.
- JDKs other than Eclipse Temurin for managed downloads (discovered system JDKs of any vendor are usable).
- Automatic migration of mods across loader/version changes (phase 4 handles content).

## User stories

| ID | Story |
|---|---|
| P3-US-01 | As an operator I create a Paper 1.21.1 server; mcm downloads Java 21 and the latest stable Paper build, and the server starts. |
| P3-US-02 | As an operator I create a Forge 1.20.1 server with the recommended Forge version; mcm runs the installer and launches via the args file. |
| P3-US-03 | As an operator I create a 1.12.2 Forge server and mcm picks Java 8. |
| P3-US-04 | As an operator I update my Paper server to the newest build of the same MC version in one click. |
| P3-US-05 | As an operator I upgrade a vanilla server from 1.20.4 to 1.21.1; mcm switches it to Java 21 automatically and keeps the old jar. |
| P3-US-06 | As an admin I see installed Java runtimes (managed and system), install Java 17, and delete unused ones. |
| P3-US-07 | As an operator I see live installer output while a Forge install runs and can cancel it. |
| P3-US-08 | As an operator I create a Velocity proxy in front of my servers and start/stop it like any server. |
| P3-US-09 | As an operator I create a Forge 1.21 server and mcm derives the launch command from the generated `run.sh` without running it. |

## Dependencies

- [Phase 0](../00-foundation/README.md): jobs, audit, settings.
- [Phase 1](../01-lifecycle-console/README.md): `servers` table, `LaunchSpec`, supervisor (incl. `Installing` state), console ring, EULA POST, `ProcessSpawner`.
- [Phase 2](../02-settings-files/README.md): `SandboxRoot`, archive extraction with limits, `.properties` writer (initial `server.properties` with managed keys).
- `mcm-download` (`SafeHttp`, created in P1) gains `HttpDownloader` + cache in this phase.
- Architecture: [process-model.md](../../architecture/process-model.md) (launch target, libc detection), [security.md](../../architecture/security.md) (T7, T8).

## Files in this phase

[requirements.md](requirements.md) · [java.md](java.md) · [installers-reference.md](installers-reference.md) · [api.md](api.md) · [ui.md](ui.md) · [tests.md](tests.md)

## Exit checklist

- [ ] All `P3-FR-*` implemented; each covered by tests in [tests.md](tests.md).
- [ ] Every installer passes wiremock tests incl. failure fixtures (404, 429, 5xx retry, hash mismatch, truncated body).
- [ ] Fake installer shims (Forge/NeoForge/Quilt) exercised end-to-end through the real spawn path in `mcm-api` tests.
- [ ] Nightly smoke suite green: `smoke_vanilla_latest`, `smoke_paper_latest`, `smoke_fabric_1_20_1`, `smoke_forge_1_20_1`, `smoke_forge_1_21`, `smoke_neoforge_latest`, `smoke_legacy_1_12_2_java8`, `smoke_velocity_latest` ([e2e.md](../../testing/e2e.md#real-server-smoke-suite-opt-in)).
- [ ] Download cache dedupes identical artefacts across servers (asserted by test).
- [ ] No vendor shell scripts executed (asserted: spawn log never contains `run.sh`); `run_script_parse` fuzz target passes the CI smoke.
- [ ] User-Agent `mcm/<version> (+<user_agent_contact>)` sent to all upstreams.
- [ ] OpenAPI/TS regenerated; migration tested from phase 2 DB snapshot.

## Open questions / to verify

| Topic | Question |
|---|---|
| Paper fill v3 | Exact build list shape, channel names (`STABLE`/`BETA`/`ALPHA`?), and whether `downloads["server:default"].url` is absolute. v2 sunset date. See [installers-reference.md](installers-reference.md#paper). |
| Purpur | Whether build JSON exposes anything stronger than md5. |
| Quilt | Installer CLI flags (`install server <mc> <loader> --download-server --install-dir=<dir>`) and output jar names. |
| Forge legacy | Which 1.7.10–1.12.2 installers still fail due to dead `s3.amazonaws.com` / http library URLs, and whether pre-placing `minecraft_server.<mc>.jar` suffices. |
| NeoForge → MC mapping | Version scheme for year-based MC releases (26.x) — does NeoForge continue `<major>.<minor>.<patch>` = MC `1.<major>.<minor>`? |
| Java for 26.x | `javaVersion.majorVersion` value for year-based releases (expected 25). We always prefer the Mojang JSON. |
| Forge 1.20.3+ launch | Exact `run.sh` contents and shim jar name for Forge 49+/1.21 — fixtures captured by `smoke_forge_1_21`. |
| Proxies | Velocity Java requirement per release line; whether fill v3 still serves Waterfall; BungeeCord Jenkins artefact path and absence of a hash. |
| Temurin 16 | Whether Adoptium serves JRE 16 images; spec uses 17 for 1.17.x regardless. |
| Maven checksums | Whether `maven.neoforged.net` and `maven.minecraftforge.net` serve `.sha256` sidecars (spec uses `.sha1`, which both are believed to provide). |
| Adoptium binaries host | `binary.package.link` currently points to `github.com/adoptium/...` release assets (redirect to `objects.githubusercontent.com`); allow-list must follow redirects to those hosts. |
