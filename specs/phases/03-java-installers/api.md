# Phase 3 — API, WebSocket, migrations

Relative to `/api/v1`. Conventions: [api-conventions.md](../../architecture/api-conventions.md).

## Java runtimes (admin)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/java/runtimes` | — | `{ items: JavaRuntimeDto[] }` |
| POST | `/java/runtimes/discover` | — | `{ items: JavaRuntimeDto[] }` |
| GET | `/java/available` | — | `{ lts: number[], all: number[], mostRecentLts: number }` |
| POST | `/java/runtimes/install` | `{ major: number }` | `202 { job }` |
| DELETE | `/java/runtimes/{runtimeId}` | — | `204` |
| GET | `/java/requirement?mcVersion=&flavor=&loaderVersion=` (any authenticated) | — | `JavaRequirementDto` |

```ts
type JavaRuntimeDto = { id: string; vendor: string; major: number; fullVersion: string; os: "linux"|"alpine-linux";
  arch: "x64"|"aarch64"; path: string /* admin only */; managed: boolean; usedBy: { id: string; name: string }[]; installedAt: string };
type JavaRequirementDto = { major: number; strict: boolean; source: "mojang"|"table"|"forge-rule"|"proxy-rule"|"override";
  note?: string; satisfiedBy?: string /* runtime id */; needsDownload: boolean };
```

## Installers

| Method | Path | Perm | Request | Response |
|---|---|---|---|---|
| GET | `/installers` | `server.create` | — | `{ items: FlavorDto[] }` |
| GET | `/installers/{flavor}/versions?snapshots=` | `server.create` | — | `{ items: GameVersionDto[], latest: { release, snapshot? } }` |
| GET | `/installers/{flavor}/versions/{mcVersion}/builds` | `server.create` | — | `{ items: LoaderBuildDto[], recommended?: string, latest?: string }` |
| POST | `/installers/plan` | `server.create` | `InstallRequest` | `InstallPlanDto` |

```ts
type Flavor = "vanilla"|"paper"|"purpur"|"fabric"|"quilt"|"forge"|"neoforge"|"velocity"|"bungeecord"|"waterfall";  // = server-api.md Flavor
type FlavorDto = { flavor: Flavor; displayName: string; category: "vanilla"|"plugins"|"mods"|"proxy"; supportsSnapshots: boolean; needsInstallerRun: boolean; eol: boolean };
type GameVersionDto = { id: string; kind: "release"|"snapshot"|"old_beta"|"old_alpha"; releaseTime: string|null; serverAvailable: boolean };
type LoaderBuildDto = { id: string; stable: boolean; recommended: boolean; releasedAt?: string };
type InstallRequest = { flavor: Flavor; mcVersion: string /* proxy version for proxy flavours */; loaderVersion?: string; build?: string };
type InstallPlanDto = InstallRequest & {
  resolved: { loaderVersion?: string; build?: string };
  artifacts: { name: string; size?: number; hashAlgo?: "sha1"|"sha256"|"md5"; cached: boolean }[];
  runsInstaller: boolean; java: JavaRequirementDto; launch: { kind: "jar"|"argsFile"; path: string };
  warnings: { code: string; message: string }[];   // e.g. "installer.experimental_build", "installer.no_hash", "installer.eol"
};
```

## Servers (extensions)

| Method | Path | Perm | Request | Response |
|---|---|---|---|---|
| POST | `/servers` | `server.create` | `CreateServerRequest` per [server-api.md](../../architecture/server-api.md#create--post-servers) with `source.kind = "installer"` | `202 { server, job, warnings }` |
| POST | `/servers/{id}/install` | `server.settings` | `InstallRequest & { confirmDowngrade?, confirmFlavorChange? }` | `202 { job }` |
| GET | `/servers/{id}/install/previous` | `server.settings` | — | `{ items: { id, createdAt, flavor, mcVersion, loaderVersion?, build?, sizeBytes }[] }` |
| POST | `/servers/{id}/install/rollback` | `server.settings` | `{ previousId }` | `202 { job }` |
| GET | `/servers/{id}/software` | `server.view` | — | `SoftwareDto` |
| PATCH | `/servers/{id}` | `server.settings` (`path` mode admin) | adds `java` ([server-api.md](../../architecture/server-api.md#validation-table)) | `200 { server, warnings }` |
| POST | `/servers/{id}/start` | `server.power` | — | may now return `409 java.installing` with `{ job }` in problem `extensions` |

```ts
// Additive over architecture/server-api.md (P1 source kinds "url"/"import" unchanged):
type InstallerSource = { kind: "installer"; flavor: Flavor; mcVersion: string; loaderVersion?: string; build?: string };
type JavaSelection = { mode: "auto" } | { mode: "runtime"; runtimeId: string; override?: boolean } | { mode: "path"; path: string };
// P3 also adds to CreateServerRequest: `startAfterInstall?: boolean` (default false). `acceptEula` ignored for proxy flavours.
// `java` and P1 `javaPath` are mutually exclusive (422 validation).
type SoftwareDto = { flavor: Flavor|"custom"; mcVersion?: string; loaderVersion?: string; build?: string;
  java: { selection: JavaSelection; runtime?: JavaRuntimeDto; requirement?: JavaRequirementDto };
  updates: { latestBuild?: string; latestLoader?: string; latestMcRelease?: string } | null };
```

`ServerDto` gains `flavor`, `mcVersion`, `loaderVersion`, `installedBuild`, `java: JavaSelection`. `Status` gains `lastInstallError?: { code, message, at }`.

## Jobs

| Kind | Params | Result | Progress |
|---|---|---|---|
| `java.install` | `{ major }` | `{ runtime: JavaRuntimeDto }` | bytes downloaded → extract → verify |
| `server.install` | `InstallRequest & { mode: "create"\|"reinstall" }` | `{ launch, java }` | weighted steps: java 0–20 %, download 20–70 %, installer run 70–95 % (indeterminate), finalize 95–100 % |
| `server.install.rollback` | `{ previousId }` | `{}` | — |

## WebSocket

- `jobs` topic carries progress/messages for the above (phase 0 envelope).
- `console:<id>` receives installer output as `stream: "system"` lines prefixed `[install] `.
- `server:<id>` status shows `state: "installing"` during `server.install`.

## Events

`JavaRuntimeInstalled`, `JavaRuntimeRemoved`, `ServerPortMismatch` (proxies), `JavaRuntimeMissing`, `ServerJavaSelected`, `ServerJavaMismatch`, `ServerInstallStarted`, `ServerInstallFinished`, `ServerInstallFailed`.

## Migration `crates/mcm-db/migrations/<NNNN>_p3_java_installers.sql`

(Phase 2 adds no migration.)

```sql
CREATE TABLE java_runtimes (
  id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  major INTEGER NOT NULL,
  full_version TEXT NOT NULL,
  arch TEXT NOT NULL CHECK (arch IN ('x64','aarch64')),
  os TEXT NOT NULL CHECK (os IN ('linux','alpine-linux')),
  path TEXT NOT NULL UNIQUE,
  managed INTEGER NOT NULL,
  sha256 TEXT,
  installed_at INTEGER NOT NULL
);
CREATE INDEX java_runtimes_major ON java_runtimes(major);

ALTER TABLE servers ADD COLUMN java_auto INTEGER NOT NULL DEFAULT 1;
ALTER TABLE servers ADD COLUMN java_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN installed_build TEXT;
```

`servers.java_runtime_id` (phase 1) gets no FK (SQLite can't add one via `ALTER`); `JavaRuntimeService::remove` enforces referential integrity via `java.in_use`.

## Error codes (new)

| Code | Status | When |
|---|---|---|
| `installer.unknown_flavor` | 404 | Bad `{flavor}` |
| `installer.version_unavailable` | 404 | MC version unknown or no server download |
| `installer.build_not_found` | 404 | Requested build/loader not found |
| `installer.process_failed` | job | Installer exit ≠ 0 / timeout |
| `installer.launch_not_found` | job | Could not determine launch target |
| `install.downgrade_requires_confirmation` | 422 | Downgrade without flag |
| `install.flavor_change_requires_confirmation` | 422 | Flavor change without flag |
| `install.no_previous` | 404 | Rollback id unknown |
| `install.flavor_change_unsupported` | 422 | Reinstall between a proxy and a game-server flavour |
| `download.hash_mismatch` | job / 502 | Hash verification failed |
| `download.host_not_allowed` | job / 502 | URL or redirect outside allow-list |
| `download.too_large` | job | > 1 GiB |
| `download.failed` | job / 502 | Network failure after retries |
| `upstream.jenkins` | 502 | BungeeCord CI metadata failure |
| `upstream.mojang`, `upstream.paper`, `upstream.purpur`, `upstream.fabric`, `upstream.quilt`, `upstream.forge`, `upstream.neoforge`, `upstream.adoptium` | 502 | Metadata fetch failures |
| Java codes | — | see [java.md § Errors](java.md#errors) |
