# Phase 3 — Installer reference (`chunkyard-installers`)

Every upstream sits behind a trait (`MojangApi`, `PaperApi` (fill v3; also used for Velocity/Waterfall), `PurpurApi`, `FabricMetaApi`, `QuiltMetaApi`, `MavenApi`, `JenkinsApi`) whose impl is built on `chunkyard_download::SafeHttp` and takes a `base_url` (overridable only under the `test-hooks` feature; wiremock in tests). All requests send `User-Agent: mcm/<version> (+<integrations.user_agent_contact>)`. Metadata responses cached in `<data>/cache/meta/` (TTL: manifests 10 min, build lists 10 min, maven metadata 1 h; stale cache served with a warning if upstream fails).

## Core types

```rust
pub enum Flavor { Vanilla, Paper, Purpur, Fabric, Quilt, Forge, NeoForge, Velocity, BungeeCord, Waterfall, Custom }
pub struct InstallRequest { flavor: Flavor, mc_version: McVersion, loader_version: Option<String>, build: Option<String>, include_snapshots: bool }
pub struct InstallPlan {           // pure data, produced by plan(), shown to user before execute
    flavor, mc_version, loader_version, build,
    artifacts: Vec<Artifact>,      // { url, dest: RelPath, hash: Option<Hash>, size: Option<u64> }
    java: JavaRequirement,
    run_installer: Option<InstallerRun>, // { jar: RelPath, args: Vec<String> }
    launch: LaunchSpecTemplate,    // resolved after execute (e.g. glob for legacy Forge)
    owned_paths: Vec<RelPath>,     // paths this flavor owns (moved to <data>/state/<id>/previous on reinstall)
}
#[async_trait] pub trait Installer: Send + Sync {
    fn flavor(&self) -> Flavor;
    async fn versions(&self, include_snapshots: bool) -> Result<Vec<GameVersion>, InstallerError>;
    async fn builds(&self, mc: &McVersion) -> Result<Vec<LoaderBuild>, InstallerError>;  // loader versions or server builds
    async fn plan(&self, req: &InstallRequest) -> Result<InstallPlan, InstallerError>;
    async fn execute(&self, plan: &InstallPlan, ctx: &InstallCtx) -> Result<LaunchSpec, InstallerError>;
}
pub struct InstallCtx { staging: SandboxRoot, java: JavaRuntime, downloader: Arc<dyn Downloader> /* chunkyard-core trait, impl chunkyard-download */,
    runner: Arc<dyn CommandRunner> /* chunkyard-core trait, impl in chunkyard-process */, progress: ProgressSink, log: LogSink, cancel: CancellationToken }
```

`GameVersion { id, kind: Release|Snapshot|OldBeta|OldAlpha, release_time, server_available: bool }`. `LoaderBuild { id, stable: bool, recommended: bool, released_at: Option }`.

## Downloader (`chunkyard-download`, shared)

Implemented once in `chunkyard-download::HttpDownloader` (consumed by `chunkyard-installers`, `chunkyard-java`, later `chunkyard-modplatforms`); all traffic through `SafeHttp`.

- Cache dir `<data>/cache/downloads/<algo>-<hex>`; lookup by expected hash before network; unhashed downloads stored under their computed sha256 after download (dedupe only).
- Stream to `<data>/tmp/dl-<uuid>.part`, hashing incrementally; verify size + hash; rename into cache; then hard-link (fallback copy) into staging.
- Retries: 3, exponential 1 s/4 s/16 s on connect errors, 5xx, 429 (honour `Retry-After` ≤ 60 s); resume with `Range` when server returned `Accept-Ranges: bytes`.
- Host allow-list per installer (redirects re-checked): `piston-meta.mojang.com`, `piston-data.mojang.com`, `launcher.mojang.com`, `fill.papermc.io`, `fill-data.papermc.io` (to verify), `api.papermc.io`, `api.purpurmc.org`, `meta.fabricmc.net`, `maven.fabricmc.net`, `meta.quiltmc.org`, `maven.quiltmc.org`, `files.minecraftforge.net`, `maven.minecraftforge.net`, `maven.neoforged.net`, `ci.md-5.net` (BungeeCord, to verify).
- Max artefact size 1 GiB; per-download timeout: 30 s connect, 60 s idle.
- Cache LRU eviction to `cache.max_bytes` (default 10 GiB) by a daily sweeper; artefacts referenced by running jobs are pinned.

## Vanilla

| Step | Request | Notes |
|---|---|---|
| Manifest | `GET https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` | `{ latest: {release, snapshot}, versions: [{ id, type, url, time, releaseTime, sha1, complianceLevel }] }` |
| Version | `GET <versions[i].url>` (verify body sha1 = `versions[i].sha1`) | `downloads.server { sha1, size, url }` — **absent** for some old versions → `server_available=false`; `javaVersion { component, majorVersion }` |
| Jar | `GET downloads.server.url` → `server.jar` | sha1 verified |

Launch: `Jar { path: "server.jar" }`. Snapshot types listed only with `include_snapshots`.

## Paper

**Primary — fill v3** (to verify exact shapes):

| Step | Request | Fields used |
|---|---|---|
| Versions | `GET https://fill.papermc.io/v3/projects/paper` | `versions: { "<family>": ["1.21.1", …] }` (grouped) |
| Builds | `GET https://fill.papermc.io/v3/projects/paper/versions/{v}/builds` | `[{ id: int, time, channel: "STABLE"\|"BETA"\|"ALPHA", downloads: { "server:default": { name, checksums: { sha256 }, size, url } } }]` |

Selection: default = highest `id` with `channel == STABLE`; if none, highest overall with `recommended=false` and a UI warning "experimental build". Paper requires a non-generic User-Agent (requests without one may be rejected).

**Fallback — v2** (used when v3 returns 404/5xx; deprecated):

| Step | Request |
|---|---|
| Versions | `GET https://api.papermc.io/v2/projects/paper` → `{ versions: [...] }` |
| Builds | `GET https://api.papermc.io/v2/projects/paper/versions/{v}/builds` → `{ builds: [{ build, channel: "default"\|"experimental", downloads: { application: { name, sha256 } } }] }` |
| Jar | `GET https://api.papermc.io/v2/projects/paper/versions/{v}/builds/{b}/downloads/{name}` |

Output `server.jar` (renamed from vendor name). Launch `Jar { "server.jar" }`. `servers.installed_build` = build id.

## Purpur

| Step | Request |
|---|---|
| Versions | `GET https://api.purpurmc.org/v2/purpur` → `{ versions: [...] }` |
| Builds | `GET https://api.purpurmc.org/v2/purpur/{v}` → `{ builds: { latest, all: [...] } }` |
| Build info | `GET https://api.purpurmc.org/v2/purpur/{v}/{build}` → `{ result: "SUCCESS", md5, … }` (only `SUCCESS` builds offered) |
| Jar | `GET https://api.purpurmc.org/v2/purpur/{v}/{build}/download` |

md5 is verified as integrity check only (to verify availability). Launch `Jar { "server.jar" }`.

## Fabric

| Step | Request |
|---|---|
| Games | `GET https://meta.fabricmc.net/v2/versions/game` → `[{ version, stable }]` |
| Loaders | `GET https://meta.fabricmc.net/v2/versions/loader/{game}` → `[{ loader: { version, stable }, intermediary, launcherMeta }]` |
| Installer versions | `GET https://meta.fabricmc.net/v2/versions/installer` → `[{ version, stable }]` (latest stable used) |
| Launcher jar | `GET https://meta.fabricmc.net/v2/versions/loader/{game}/{loader}/{installer}/server/jar` → `fabric-server-launch.jar` (no hash available) |

The launcher downloads vanilla `server.jar` on first run; mcm **pre-downloads** it (vanilla steps, sha1-verified) and writes `fabric-server-launcher.properties` with `serverJar=server.jar`. Launch `Jar { "fabric-server-launch.jar" }`. Libraries are fetched by the launcher on first start from `maven.fabricmc.net` (outside mcm's allow-list control; documented).

## Quilt (flags to verify)

| Step | Request |
|---|---|
| Games | `GET https://meta.quiltmc.org/v3/versions/game` |
| Loaders | `GET https://meta.quiltmc.org/v3/versions/loader/{game}` |
| Installer | `GET https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml` → latest; jar `…/quilt-installer/{v}/quilt-installer-{v}.jar` (+ `.sha1`) |
| Run | `java -jar quilt-installer.jar install server <mc> <loader> --download-server --install-dir=<staging>` |

Output expected: `quilt-server-launch.jar`, `server.jar`, `libraries/`. Launch `Jar { "quilt-server-launch.jar" }`.

## Forge

| Step | Request |
|---|---|
| Promotions | `GET https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json` → `{ promos: { "1.20.1-recommended": "47.2.0", "1.20.1-latest": "47.3.0", … } }` |
| All versions | `GET https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml` → `<version>1.20.1-47.3.0</version>`; legacy entries carry a suffix, e.g. `1.7.10-10.13.4.1614-1.7.10` |
| Installer | `GET https://maven.minecraftforge.net/net/minecraftforge/forge/{full}/forge-{full}-installer.jar` (+ `.sha1`), where `{full}` is the **exact maven version string** |
| Run | `java -jar forge-{full}-installer.jar --installServer <staging>` (cwd = staging), timeout 20 min |

Outputs and launch:

| MC range | Produced | LaunchSpec |
|---|---|---|
| ≥ 1.20.3 (Forge 49+) | `run.sh`, `run.bat`, `user_jvm_args.txt`, a launcher jar (believed `forge-{mc}-{forge}-shim.jar`, to verify), `libraries/` | **parsed from `run.sh`** → `Jar { <path after -jar> }` |
| 1.17 – 1.20.2 | `libraries/net/minecraftforge/forge/{mc}-{forge}/unix_args.txt`, `run.sh`, `run.bat`, `user_jvm_args.txt` | **parsed from `run.sh`** → `ArgsFile { "libraries/net/minecraftforge/forge/{mc}-{forge}/unix_args.txt" }` (this path is also the fallback when no script exists) |
| 1.13 – 1.16.5 | `forge-{mc}-{forge}.jar`, `minecraft_server.{mc}.jar`, `libraries/` | `Jar { "forge-{mc}-{forge}.jar" }` |
| 1.7.10 – 1.12.2 | `forge-{full}-universal.jar` (sometimes `forge-{full}.jar`), `minecraft_server.{mc}.jar`, `libraries/` | `Jar { <glob match> }` |

Legacy jar detection: glob `forge-*.jar` in staging root excluding `*-installer.jar`; prefer exact `forge-{full}-universal.jar`, then `forge-{full}.jar`, then `forge-{mc}-{forge}.jar`; zero or multiple remaining → `installer.launch_not_found`. For ≤ 1.12.2, mcm pre-places the sha1-verified vanilla `minecraft_server.{mc}.jar` so the installer skips its (possibly dead) download URL (to verify per version).

### Run-script parsing (≥ 1.17, Forge and NeoForge)

Never executed — parsed by `run_script::parse` (P3-FR-28). Typical inputs (fixtures `tests/fixtures/run_scripts/`):

| Fixture | Relevant line | Result |
|---|---|---|
| `forge-1.17.1.sh` | `java @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.17.1-37.1.1/unix_args.txt "$@"` | `ArgsFile` |
| `forge-1.20.1.sh` | `java @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.3.0/unix_args.txt "$@"` | `ArgsFile` |
| `forge-1.20.4.sh` | `java @user_jvm_args.txt -jar forge-1.20.4-49.1.0-shim.jar "$@"` (to verify) | `Jar` |
| `forge-1.21.x.sh` | as 1.20.4 with 1.21 versions (to verify) | `Jar` |
| `neoforge-21.1.sh` | `java @user_jvm_args.txt @libraries/net/neoforged/neoforge/21.1.77/unix_args.txt "$@"` | `ArgsFile` |
| `*.bat` variants | same with `%*` | used only when `run.sh` missing |

Fixture files are captured from real installers by the smoke suite (`smoke_forge_1_20_1`, `smoke_forge_1_21`, `smoke_neoforge_latest`) and committed after review.

Post-install cleanup: delete installer jar; copy `installer.log`, `run.sh`, `run.bat` into `<data>/state/<id>/install/` then delete them from the server dir. `user_jvm_args.txt` kept but ignored (process-model.md).

## NeoForge

| Step | Request |
|---|---|
| Versions | `GET https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge` → `{ isSnapshot, versions: ["20.2.86", "21.1.77", …] }` |
| 1.20.1 | `GET https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge` → `["1.20.1-47.1.106", …]` |
| Installer | `…/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar` (or `…/net/neoforged/forge/{v}/forge-{v}-installer.jar` for 1.20.1) + `.sha1` |
| Run | `java -jar <installer> --installServer <staging>` |

MC mapping: NeoForge `A.B.C` → MC `1.A.B`, with `B == 0` → `1.A` (e.g. `21.0.x` → 1.21, `21.1.x` → 1.21.1); versions with `-beta` suffix are `stable=false`. Launch parsed from `run.sh` (see above); fallback `ArgsFile { "libraries/net/neoforged/neoforge/{v}/unix_args.txt" }` (1.20.1: `libraries/net/neoforged/forge/1.20.1-{v}/unix_args.txt`). Cleanup identical to Forge.

## Proxies (Velocity, BungeeCord, Waterfall)

| Flavour | Versions | Build / jar | Hash | Notes |
|---|---|---|---|---|
| Velocity | `GET https://fill.papermc.io/v3/projects/velocity` (e.g. `3.4.0-SNAPSHOT`) | builds as Paper (`downloads["server:default"]`) | sha256 | Stop `shutdown`; ready `Done (Xs)!`; Java 17+ for 3.3.x, 21 for 3.4.x (to verify) |
| Waterfall | `GET https://fill.papermc.io/v3/projects/waterfall` (to verify still served) | as Paper | sha256 | **End-of-life** (PaperMC recommends Velocity): `eol: true`, plan warning `installer.eol`. Stop `end` |
| BungeeCord | single version `latest` | `GET https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/api/json` → `number`; jar `…/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar` (to verify path) | none published (`installer.no_hash` warning) | Stop `end`; log family `bungee` |

Output renamed to `proxy.jar`; launch `Jar { "proxy.jar" }`; owned paths `proxy.jar`. No EULA/`server.properties`. `installed_build` = build id / Jenkins number. Default port from `process.port_range` like game servers; mcm does not edit proxy configs (P3-FR-27 only checks).

## Installer subprocess rules

- Run via `CommandRunner` (implemented by `chunkyard-process`): own process group, env cleared except `PATH`, `HOME=<staging>`, `LANG=C.UTF-8`; selected Java; stdout+stderr lines → job `message` (last line), server console ring as `System` lines prefixed `[install] `, and `<data>/state/<id>/install.log`.
- Cancellation or 20 min timeout → `killpg` SIGTERM, 10 s, SIGKILL; staging deleted.
- Exit code ≠ 0 → `installer.process_failed` with the last 20 log lines in `error_detail`.
- The installer itself downloads libraries from `libraries.minecraft.net` / maven repos — outside mcm's allow-list (documented limitation; the Docker runtime in P10 can restrict egress).
