# Phase 3 — Java runtime management (`mcm-java`)

## Model

```rust
pub struct JavaRuntime {
    id: JavaRuntimeId, vendor: String /* "temurin" | parsed from release IMPLEMENTOR | "unknown" */,
    major: u16, full_version: String /* "21.0.5+11" or "1.8.0_432" */,
    os: JavaOs /* Linux | AlpineLinux | Windows */, arch: Arch /* X64 | Aarch64 */,
    path: PathBuf /* .../bin/java */, managed: bool, sha256: Option<String>, installed_at: Timestamp,
}
pub trait JavaRuntimeService: Send + Sync {
    async fn list(&self) -> Result<Vec<JavaRuntime>, JavaError>;
    async fn discover(&self) -> Result<Vec<JavaRuntime>, JavaError>;            // rescans system, upserts managed=0 rows, removes vanished
    async fn install(&self, major: u16, ctx: JobCtx) -> Result<JavaRuntime, JavaError>;
    async fn remove(&self, id: JavaRuntimeId) -> Result<(), JavaError>;          // managed only, not in use
    async fn requirement(&self, mc: &McVersion, flavor: Flavor, loader: Option<&str>) -> Result<JavaRequirement, JavaError>;
    async fn ensure(&self, req: &JavaRequirement, ctx: JobCtx) -> Result<JavaRuntime, JavaError>; // pick or install
}
```

Repo trait `JavaRuntimeRepo` (in `mcm-core`, impl in `mcm-db`).

## Discovery (system JREs)

Enabled when `java.allow_system_java = true`.

| Order | Candidate |
|---|---|
| 1 | `$JAVA_HOME/bin/java` |
| 2 | Every `java` on `$PATH`, symlinks resolved (`/usr/bin/java` → `/usr/lib/jvm/java-21-openjdk/bin/java`) |
| 3 | `/usr/lib/jvm/*/bin/java`, `/usr/lib/jvm/*/jre/bin/java` |
| 4 | `/usr/java/*/bin/java`, `/opt/java/*/bin/java`, `/opt/jdk*/bin/java`, `/opt/*/jdk*/bin/java` |
| 5 | `~/.sdkman/candidates/java/*/bin/java` (of the mcm user) |

Identification per candidate (dedupe by canonical path):
1. If `<home>/release` exists: parse `JAVA_VERSION="…"`, `IMPLEMENTOR="…"`, `OS_ARCH="…"`.
2. Else run `<java> -version` with 10 s timeout, empty env except `PATH`; parse **stderr** first line with `version "([^"]+)"`: `1.8.0_432` → major 8 (leading `1.` scheme), `17.0.9` → 17, `21` → 21, `25-ea` → 25.
3. Arch from `release` `OS_ARCH` or ELF header of the binary (`e_machine`: 62 = x86_64, 183 = aarch64); mismatched arch → skipped.

Managed runtimes under `<data>/runtimes/java/` are never reported as system runtimes.

### Windows support

Discovery also checks `%JAVA_HOME%/bin/java.exe`, every `java.exe` on `%PATH%`, and Java/vendor directories under `%ProgramFiles%`, `%ProgramFiles(x86)%`, and `%LOCALAPPDATA%`. Managed downloads use Adoptium's `os=windows` assets and `.zip` packages. Linux uses `.tar.gz`. Runtime selection is per instance, so old and new Java majors coexist without changing the machine's default Java. “Any version” means a release available for the host OS/architecture from the provider; unsupported historical releases need an administrator-supplied runtime.

## Managed install (Adoptium)

Client trait `AdoptiumApi` (base URL `https://api.adoptium.net`; override only under the `test-hooks` feature), built on `mcm_download::SafeHttp`.

| Call | Use |
|---|---|
| `GET /v3/info/available_releases` | `{ available_lts_releases: [8,11,17,21,25], available_releases: [...], most_recent_feature_release, most_recent_lts }` → UI choices |
| `GET /v3/assets/latest/{feature}/hotspot?architecture={x64\|aarch64}&image_type=jre&os={linux\|alpine-linux}&vendor=eclipse` | Array of assets; take the first with `binary.image_type == "jre"` and `binary.package.name` ending `.tar.gz` |

Fields used: `binary.package.link` (URL), `binary.package.checksum` (sha256 hex), `binary.package.size`, `binary.package.name`, `version.semver`, `version.major`, `release_name`.

Steps (job `java.install`, params `{ major }`):
1. Resolve asset; `os` from libc detection ([process-model.md](../../architecture/process-model.md#java-runtimes-and-libc)); `arch` from `std::env::consts::ARCH`.
2. Download via `mcm-download::HttpDownloader` over `SafeHttp` (cache key `sha256:<checksum>`), verifying sha256 and size; allowed hosts: `api.adoptium.net`, `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com` (redirect targets; to verify).
3. Extract `.tar.gz` with `mcm-fs::archive` (sandboxed, symlink entries **allowed only if their target stays within the archive root** — JRE tarballs contain relative symlinks such as `legal/` links; `mcm-fs` exposes `ExtractOptions { allow_internal_symlinks: true }` used only here).
4. Strip the single top-level directory (`jdk-21.0.5+11-jre/`) into `<data>/runtimes/java/temurin-<major>-<semver>-<os>-<arch>.tmp/`, then rename to final dir (atomic).
5. `chmod +x bin/*`; verify by running `bin/java -version` → major matches.
6. Insert row (`managed=1`, `sha256`), emit `JavaRuntimeInstalled`.

Idempotency: if a managed runtime with the same `major` and `full_version` exists, the job succeeds immediately with that runtime.

Updates: `POST /java/runtimes/install {major}` when a newer patch exists installs side by side; servers pinned to a `java_runtime_id` keep using the old one; servers in auto mode switch to the newest matching major on next start (P3-FR-06). Old managed runtimes not referenced by any server can be removed.

## Java requirement resolution

`JavaRequirement { major: u16, strict: bool, source: Mojang | Table | ForgeRule | ProxyRule | Override, note: Option<String> }`.

| Priority | Rule |
|---|---|
| 0 | **Proxy rule:** Velocity 3.4.x → 21, Velocity 3.3.x → 17, BungeeCord → 17, Waterfall → 17 (all `strict = false`, to verify against upstream READMEs); proxies never consult Mojang metadata |
| 1 | **Forge rule:** flavor `forge` and MC ≤ 1.16.5 → `major = 8, strict = true` (many Forge builds for ≤ 1.16.5 fail on newer Java; Forge 1.16.5 ≥ 36.2.x tolerates 11–17 — `strict` relaxed to a warning there) |
| 2 | **Mojang:** `javaVersion.majorVersion` from the MC version JSON (piston-meta). Present in modern version JSONs, including retroactively for old versions (value 8). `strict = false` for ≥ 1.17 (newer Java generally works), `true` for ≤ 1.16.5 |
| 3 | **Fallback table** (when the version JSON is unreachable and not cached), ordered by manifest `releaseTime`, not string comparison |

| MC version range | Major |
|---|---|
| ≤ 1.16.5 | 8 |
| 1.17 – 1.17.1 | 17 (Mojang says 16; Temurin 16 JRE availability uncertain and 17 runs 1.17 fine) |
| 1.18 – 1.20.4 | 17 |
| 1.20.5 – 1.21.x | 21 |
| Year-based (26.x+) | No table entry → requires Mojang JSON; error `java.requirement_unknown` if unavailable (expected 25, to verify) |

Mojang JSON fetched via `mcm-installers::vanilla::MojangApi`. `mcm-installers` depends on `mcm-java`, so the requirement function takes a `&dyn VersionMetaSource` trait object defined in `mcm-java` and implemented in `mcm-installers`, injected by `mcm-server::wiring`. Both crates share downloads via `mcm-download`, so there is no java↔installers edge in the other direction.

### Selection (`ensure`)

1. Server has `java = {mode:"runtime"}` → use it; if its major ≠ requirement and `strict` → `java.incompatible` (422) unless `override: true` was saved, then start with warning event. `{mode:"path"}` (admin) is used as-is without checks.
2. Auto mode: prefer managed runtime with exact major (newest `full_version`), then system runtime with exact major, then (non-strict only) the lowest installed major > required.
3. None suitable → install managed Temurin of the required major as a sub-step of the calling job (create/install/start). Starting a server whose Java is missing triggers an install job and returns `409 java.installing` with the job, the UI then waits and retries start.

## Errors

| Code | Status | When |
|---|---|---|
| `java.not_found` | 404 | Unknown runtime id |
| `java.in_use` | 409 | Delete runtime referenced by servers |
| `java.not_managed` | 409 | Delete a system runtime |
| `java.unavailable` | 502/424 | Adoptium has no asset for major/os/arch |
| `java.verify_failed` | 500 (job) | `java -version` after extract did not match |
| `java.incompatible` | 422 | Strict requirement mismatch |
| `java.requirement_unknown` | 424 | No Mojang metadata and no table rule |
| `java.installing` | 409 | Start blocked while runtime install job runs |
