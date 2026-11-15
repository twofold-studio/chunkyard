# Phase 3 — Functional requirements

Conventions: [patterns.md](../../architecture/patterns.md). Each FR lists **Crates**, **Perm**, **Audit**, **Events**. Details for Java live in [java.md](java.md); upstream specifics in [installers-reference.md](installers-reference.md).

Service traits (`JavaRuntimeService`, `InstallService`, `Downloader`, `JavaRuntimeRepo`) are declared in `chunkyard-core`; `InstallService` impl lives in `chunkyard-installers::service` and depends on `chunkyard-core` traits (`ServerLookup`, `ServerRepo`, `CommandRunner`, `JobService`, `Downloader`) plus `chunkyard-java`, `chunkyard-fs`, `chunkyard-download`. Neither `chunkyard-java` nor `chunkyard-installers` depends on `chunkyard-db`; the shared downloader/cache lives in `chunkyard-download`, which breaks the former java↔installers cycle ([workspace-layout.md](../../architecture/workspace-layout.md)). Installer bookkeeping (install log, owned-path manifest, previous installs) lives in `<data>/state/<id>/`, never in the untrusted server dir.

## A. Java runtimes (`chunkyard-java`)

**P3-FR-01 Discovery.** On startup and on `POST /java/runtimes/discover`, scan candidates per [java.md § Discovery](java.md#discovery-system-jres), upsert `managed=0` rows, delete rows whose `path` vanished (servers referencing them fall back to auto mode with a `JavaRuntimeMissing` event). Disabled when `java.allow_system_java=false` (existing system rows hidden). Crates: chunkyard-java (repo via `JavaRuntimeRepo`, impl in chunkyard-db). Perm: admin. Audit: `java.discover`.

**P3-FR-02 Available releases.** `GET /java/available` proxies Adoptium `available_releases` (cached 1 h). Crates: chunkyard-java, chunkyard-download. Perm: admin.

**P3-FR-03 Install managed JRE.** Job `java.install` per [java.md § Managed install](java.md#managed-install-adoptium): resolve asset for detected os/arch, download with sha256, sandboxed extraction with `ExtractOptions { allow_internal_symlinks: true }` ([security.md](../../architecture/security.md#sandboxroot-path-safety--chunkyard-fs); JRE tarballs only), atomic move, verify `java -version`. Idempotent for an already-installed version. Crates: chunkyard-java, chunkyard-fs, chunkyard-download (`HttpDownloader`). Perm: admin. Audit: `java.install`. Events: `JavaRuntimeInstalled`.

**P3-FR-04 Remove.** `DELETE /java/runtimes/{id}`: managed and unreferenced → delete dir + row; referenced → `java.in_use` (409, lists server names); system runtime → `java.not_managed` (409). Crates: chunkyard-java. Perm: admin. Audit: `java.remove`.

**P3-FR-05 Requirement.** `GET /java/requirement?mcVersion=&flavor=&loaderVersion=` returns `JavaRequirement` using the priority rules (proxy rule → Forge rule → Mojang `javaVersion.majorVersion` → fallback table; [java.md](java.md#java-requirement-resolution)). Crates: chunkyard-java (+`VersionMetaSource` impl from chunkyard-installers). Perm: authenticated.

**P3-FR-06 Selection at start/install.** Servers have `java_auto` (default 1). Auto: `ensure()` picks per [java.md § Selection](java.md#selection-ensure); if nothing suitable, starting returns `409 java.installing` with an auto-created `java.install` job, and install jobs install Java inline as a sub-step. Manual: `javaRuntimeId` used as-is; strict mismatch → `java.incompatible` (422) unless `javaOverride=true`, in which case start proceeds and emits a `ServerJavaMismatch` warning event. `java = {mode:"path"}` / phase 1 `javaPath` (admin only) still wins over both when set. Crates: chunkyard-java, chunkyard-process (start path). Events: `ServerJavaSelected { server_id, runtime_id, major }`.

**P3-FR-07 Server Java settings.** `PATCH /servers/{id}` gains the `java` field from [server-api.md](../../architecture/server-api.md#validation-table): `{mode:"auto"} | {mode:"runtime", runtimeId, override?: boolean} | {mode:"path", path}` (`path` admin-only; server must be stopped per that table). `javaPath` (P1) remains accepted as the equivalent of `{mode:"path"}`; sending both → 422. Runtime must exist and match host arch. Response `200 {server, warnings}`. Crates: chunkyard-api, chunkyard-java. Perm: `server.settings`. Audit: `server.settings.update`.

## B. Installers (`chunkyard-installers`)

**P3-FR-08 Flavor catalog.** `GET /installers` lists flavors with `{ flavor, displayName, category: "vanilla"|"plugins"|"mods"|"proxy", supportsSnapshots, needsInstallerRun, eol: bool }`. Crates: chunkyard-installers, chunkyard-api. Perm: `server.create`.

**P3-FR-09 Versions.** `GET /installers/{flavor}/versions?snapshots=false` → MC versions supported by that flavor (ordered newest first by release time from the Mojang manifest; flavor-specific lists intersected with the manifest for release times; versions unknown to the manifest appended with `releaseTime=null`). Crates: chunkyard-installers. Perm: `server.create`.

**P3-FR-10 Builds.** `GET /installers/{flavor}/versions/{mc}/builds` → `LoaderBuild[]` (Paper/Purpur builds; Fabric/Quilt loader versions; Forge versions with `recommended`/`latest` from promotions; NeoForge versions). Vanilla → empty list. Crates: chunkyard-installers. Perm: `server.create`.

**P3-FR-11 Downloader.** `chunkyard-download::HttpDownloader` (implements `chunkyard_core::Downloader`, built on `SafeHttp`) with content-addressed cache, hash/size verification, per-installer host allow-list (redirects re-checked), retries with `Retry-After`, Range resume, 1 GiB cap, LRU cache eviction to `cache.max_bytes`. Errors: `download.hash_mismatch`, `download.host_not_allowed`, `download.too_large`, `download.failed`. Upstream base-URL overrides exist only under the `test-hooks` feature. Crates: chunkyard-download (used by chunkyard-installers, chunkyard-java).

**P3-FR-12 Vanilla installer.** Per reference: manifest → version JSON (sha1-verified) → `server.jar` (sha1). Versions without `downloads.server` → `installer.version_unavailable`. Launch `Jar`. Crates: chunkyard-installers.

**P3-FR-13 Paper installer.** fill v3 with fallback to v2 on 404/5xx/parse error (logged `warn` once per hour); default stable latest build; sha256 verified; `installed_build` recorded. Launch `Jar`. Crates: chunkyard-installers.

**P3-FR-14 Purpur installer.** Only `SUCCESS` builds; md5 verified when present. Launch `Jar`. Crates: chunkyard-installers.

**P3-FR-15 Fabric installer.** Launcher jar from meta (latest stable installer version unless specified), pre-download vanilla `server.jar`, write `fabric-server-launcher.properties`. Launch `Jar { fabric-server-launch.jar }`. Crates: chunkyard-installers.

**P3-FR-16 Quilt installer.** Download installer (+sha1), run `install server … --download-server --install-dir=<staging>` via `CommandRunner`, verify outputs exist. Launch `Jar { quilt-server-launch.jar }`. Crates: chunkyard-installers, chunkyard-process (`CommandRunner`).

**P3-FR-17 Forge installer.** Resolve `recommended`/`latest`/explicit version to the exact maven string; download installer (+sha1); for ≤ 1.12.2 pre-place vanilla `minecraft_server.{mc}.jar`; run `--installServer`; derive the launch: **≥ 1.17 by parsing the generated `run.sh`** (P3-FR-28; this covers the 1.20.3+ change to a `-jar` shim launch), ≤ 1.16.5 via the legacy glob rules; the era table is a fallback only when no run script exists; cleanup. Requires Java 8 for ≤ 1.16.5 (P3-FR-05). Errors: `installer.process_failed`, `installer.launch_not_found`. Crates: chunkyard-installers, chunkyard-process (`CommandRunner`).

**P3-FR-18 NeoForge installer.** Version listing from NeoForged maven API with MC mapping; 1.20.1 via `net/neoforged/forge`; installer `--installServer`; launch derived by parsing `run.sh` (P3-FR-28), with the ArgsFile path from [installers-reference.md](installers-reference.md#neoforge) as fallback; cleanup. Crates: chunkyard-installers, chunkyard-process.

**P3-FR-19 Installer process handling.** Installer subprocesses follow [installers-reference.md § subprocess rules](installers-reference.md#installer-subprocess-rules): process group, cleared env, 20 min timeout, cancellation kills the group, logs streamed to job + console ring (`[install]` prefix) + `<data>/state/<id>/install.log`. Crates: chunkyard-installers, chunkyard-process (`CommandRunner` impl).

## C. Server creation and reinstall

**P3-FR-20 Plan preview.** `POST /installers/plan` with `InstallRequest` → `InstallPlanDto` (resolved versions/build, artefact list with sizes, Java requirement and whether a runtime must be downloaded, warnings). No side effects. Crates: chunkyard-installers, chunkyard-java, chunkyard-api. Perm: `server.create`.

**P3-FR-21 Create from installer.** `POST /servers` accepts the additive `source: { kind: "installer", flavor, mcVersion, loaderVersion?, build? }` plus optional `java`, `acceptEula`, and P3's `startAfterInstall` ([server-api.md](../../architecture/server-api.md#create--post-servers); phase 1 `url`/`import` sources unchanged). Response **`202 { server, job, warnings }`** (same shape for every source kind). Creates the `servers` row (state `Installing`) and job `server.install`:
1. `ensure` Java (may install inline).
2. Plan + execute into `<data>/tmp/install-<job>/` (staging `SandboxRoot`).
3. Move staging contents into `<data>/servers/<id>/`.
4. Game servers only: write `server.properties` via the P2 writer (managed keys per the P2-FR-12 registry + `motd` = server name), and `eula.txt` if `acceptEula=true` (audit `server.eula.accept`). Proxy flavours (P3-FR-26) skip both.
5. Update row: `flavor, mc_version, loader_version, installed_build, launch, java_runtime_id, stop_command` (flavour default); state → `Stopped`; if `startAfterInstall` → start.
Failure → state `Stopped` with `Status.lastInstallError`; staging deleted; user can retry install or delete the server. Crates: chunkyard-installers, chunkyard-api, chunkyard-fs. Perm: `server.create`. Audit: `server.create`, `server.install`. Events: `ServerInstallStarted|Finished|Failed`.

**P3-FR-22 Reinstall / switch version / update build.** `POST /servers/{id}/install` with `InstallRequest` + `{ confirmDowngrade?, confirmFlavorChange? }`. Preconditions: state `Stopped`/`Crashed` (`server.running` 409 otherwise), no other mutating job (`server.busy`). Rules:

| Change | Requirement |
|---|---|
| Same flavor, newer build / MC version | none |
| Older MC version than current | `confirmDowngrade=true` else `install.downgrade_requires_confirmation` (422) |
| Different flavor | `confirmFlavorChange=true` else `install.flavor_change_requires_confirmation` (422); response warns that `mods/` / `plugins/` content may be incompatible (not deleted) |

Execution: plan + execute into staging; move the current flavor's `owned_paths` (from `<data>/state/<id>/install.json`, or flavor defaults) into `<data>/state/<id>/previous/<ts>/` with `manifest.json {flavor, mcVersion, loaderVersion, build, launch, javaRuntimeId}` (chunkyard-written, outside the server dir); move staging into place; update row. Keep the 3 newest `previous` entries. Worlds, configs, mods, plugins are never touched. Proxy ↔ game-server flavour changes are rejected (`install.flavor_change_unsupported`, 422). Crates: chunkyard-installers, chunkyard-api. Perm: `server.settings`. Audit: `server.install`. Note: phase 6 adds an automatic pre-install backup; until then UI recommends downloading the world first.

**P3-FR-23 Rollback.** `GET /servers/{id}/install/previous` lists `<data>/state/<id>/previous/` entries; `POST /servers/{id}/install/rollback {previousId}` (server stopped) swaps current owned paths with the selected entry (current becomes a new `previous` entry) and restores row fields from its manifest (paths re-validated via `RelPath`; a `custom` launch is never restored). Crates: chunkyard-installers. Perm: `server.settings`. Audit: `server.install.rollback`.

**P3-FR-24 Software info & update check.** `GET /servers/{id}/software` → `{ flavor, mcVersion, loaderVersion, build, java: { mode, runtime, requirement }, updates: { latestBuild?, latestLoader?, latestMcRelease? } }` (update lookups cached 1 h; failures → `updates: null`, never an error). Crates: chunkyard-installers, chunkyard-java, chunkyard-api. Perm: `server.view`.

**P3-FR-25 Owned-path manifests.** Each installer declares `owned_paths`: vanilla `server.jar`; paper/purpur `server.jar`, `cache/`, `versions/`, `libraries/`; fabric `fabric-server-launch.jar`, `fabric-server-launcher.properties`, `server.jar`, `.fabric/`, `libraries/`; quilt `quilt-server-launch.jar`, `server.jar`, `libraries/`, `.quilt/`; forge/neoforge `libraries/`, matched `forge-*.jar` / `*-shim.jar`, `minecraft_server.*.jar`, `user_jvm_args.txt`; velocity/bungeecord/waterfall the proxy jar only. Stored in `<data>/state/<id>/install.json` after each successful install. Crates: chunkyard-installers.

## D. Proxy flavours and run-script parsing

**P3-FR-26 Proxy installers.** Flavours `velocity`, `bungeecord`, `waterfall` (category `proxy`), details in [installers-reference.md § Proxies](installers-reference.md#proxies-velocity-bungeecord-waterfall). For proxies `mcVersion` carries the **proxy version** (e.g. `3.4.0-SNAPSHOT`; BungeeCord: `latest`), not a Minecraft version. Differences from game servers: no EULA, no `server.properties`, no world; stop command `shutdown` (Velocity) / `end` (BungeeCord, Waterfall); log family per [log-formats.md](../../architecture/log-formats.md) (`paper` for Velocity/Waterfall, `bungee` for BungeeCord); Java via the proxy rule in [java.md](java.md#java-requirement-resolution). Waterfall is end-of-life (`eol: true`): offered with warning `installer.eol` in the plan. Scope: install, start/stop/restart, console; proxy config (`velocity.toml`, `config.yml`) edited via the P2 file editor. Crates: chunkyard-installers, chunkyard-java.

**P3-FR-27 Proxy bind-port check.** After the first start (config generated by the proxy), mcm reads the bind port (`velocity.toml` `bind`, `config.yml` `listeners[0].host`) with tolerant parsers and, if it differs from `servers.port`, emits warning event `ServerPortMismatch` shown on the overview with a link to the file. mcm does not rewrite proxy configs. Crates: chunkyard-installers (`proxy_config` parsers), chunkyard-api.

**P3-FR-28 Run-script launch derivation.** `chunkyard-installers::run_script::parse(sh: &str, bat: Option<&str>) -> Result<LaunchSpec, RunScriptError>` derives the launch from Forge/NeoForge `run.sh` (fallback `run.bat`) **without executing anything**: find the last non-comment line invoking `java`; tokenize with POSIX-shell quoting rules (single/double quotes, backslash escapes; `"$@"`, `%*` and variable references dropped); ignore `@user_jvm_args.txt` (mcm owns JVM args); the first remaining `@<path>` token → `ArgsFile { path }`, else the token after `-jar` → `Jar { path }`; any other construct (pipes, `exec` of non-java, command substitution) → `installer.launch_not_found`. Paths validated as `RelPath` and must exist in staging. The scripts are copied to `<data>/state/<id>/install/` for diagnosis, then deleted from the server dir. Fuzz target `run_script_parse`. Crates: chunkyard-installers.

## Edge cases and failure modes

| Case | Behaviour |
|---|---|
| Upstream 429 storm | Retries with `Retry-After`; job message "Rate limited by <host>, retrying in Ns" |
| Mojang manifest unreachable, cache present | Serve stale cache + warning; requirement uses cached version JSON |
| Paper v3 shape changed | Parse failure → v2 fallback → if both fail `upstream.paper` (502) |
| Forge installer hangs on dead URL | 20 min timeout → `installer.process_failed` with last log lines |
| Forge installer produces both `forge-x.jar` and `forge-x-universal.jar` | Prefer universal per glob order |
| Forge ≥ 1.17 installer produces no `run.sh`/`run.bat` | Fall back to the era table path; if that file is missing → `installer.launch_not_found` |
| `run.sh` launches via an unexpected construct | `installer.launch_not_found` with the offending line in `error_detail`; nothing executed |
| Proxy config absent before first start | Port check skipped until the proxy has generated it |
| Disk full during staging | `fs.no_space`; staging removed; existing server untouched |
| mcm restarts mid-install | Job marked `failed: interrupted` (phase 0); stale `tmp/install-*` removed at startup; server state `Stopped` with `lastInstallError` |
| Java install fails during create | Whole create job fails; row stays with state `Stopped` and `lastInstallError` |
| Same JRE requested by two concurrent jobs | Per-major install lock in `JavaRuntimeService`; second waits and reuses |
| ARM host + version with no aarch64 JRE 8 on Adoptium | `java.unavailable` with hint to install a system JRE (Temurin 8 aarch64 exists; Alpine aarch64 8 may not — to verify) |
| MC version string unknown to manifest (e.g. Paper lists newer than cached manifest) | Refresh manifest once; still unknown → treat as newest, requirement from Mojang JSON fetch by id fails → `java.requirement_unknown` |

## Security considerations

- Only HTTPS URLs from allow-listed hosts; redirects re-validated; hashes verified wherever upstream provides them (Mojang sha1, Paper sha256, Adoptium sha256, maven `.sha1`). Fabric launcher jar has no published hash — documented risk.
- Installer jars (Forge/NeoForge/Quilt) execute vendor code with mcm's user privileges in a staging dir; this is equivalent trust to running the server itself (native single-trust, [security.md](../../architecture/security.md#native-runtime-is-single-trust)). The Docker runtime (P10) runs installers in the container.
- No vendor shell scripts executed: `run.sh`/`run.bat` are only parsed (P3-FR-28), then removed.
- All fetches go through `SafeHttp` (SSRF-safe, IP-pinned); per-installer host allow-lists on top.
- Previous-install manifests and owned-path lists are chunkyard-written in `<data>/state/<id>/`; nothing in the server dir is trusted.
- Archive extraction for JREs uses the phase 2 limits; internal-symlink allowance is opt-in for JRE extraction only and validated to stay inside the extraction root.
- Install logs may contain URLs but no secrets; they are viewable with `console.read`.
