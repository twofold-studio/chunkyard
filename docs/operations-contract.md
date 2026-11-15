# Readiness, player controls and automation

These authenticated owner endpoints are implemented for the next release. Normal Host/Origin/CSRF and bearer-key rules apply. No new scopes, OAuth or multi-user roles are introduced. The exact DTOs are in `crates/mcm-core/src/operations.rs`; schemas are in `crates/mcm-api/src/openapi.json`.

## Readiness

`GET /api/v1/servers/{id}/status` returns `GameStatus`:

```json
{"state":"ready","observedAt":"2026-11-15T12:00:00Z","latencyMs":12,"onlinePlayers":0,"maxPlayers":20,"playerSample":[],"version":"1.21.1","connectAddress":"oracle.netbird.cloud:25565","detail":"Minecraft answered a Server List Ping."}
```

States are `starting`, `ready`, `unreachable`, `stopped`, `failed`, `archived`, `paused`, or `unknown`. Ready requires a valid Java Edition status reply. A nonzero exit/OOM is failed; a running container without a reply remains starting for five minutes, then unreachable. This does not kill/restart the game. Disabled status replies or networking can make an otherwise playable server unobservable. Player names are only the advertised sample, not a complete online roster. Counts, latency, version and suggested address can be null. Addresses are hints, not a test of external firewall/VPN reachability. `CHUNKYARD_DOCKER__CONNECT_HOST` optionally overrides the advertised host; it does not change bindings or exposure.

Use one five-second, visible/focused-page poll shared by header/Overview; cancel on navigation. Do not add a probe loop for every server card.

## Players

`GET /api/v1/servers/{id}/players` returns `{whitelist:[],operators:[],bans:[],knownPlayers:[],running,onlineMode,whitelistEnabled}`. List entries include `uuid`, `name` and native Minecraft fields such as operator `level` or ban `reason`, `created`, `expires`, `source`. Unknown fields are preserved. Known identities come from `usercache.json`. Online mode and whitelist-enabled flags describe **desired** properties; use the existing Properties UI to change them and show pending-restart semantics.

`POST /api/v1/servers/{id}/players` returns **202 `{job}`**. Body:

```json
{"list":"whitelist","action":"add","name":"ExamplePlayer","uuid":null,"level":null,"reason":null}
```

Lists: `whitelist`, `operators`, `bans`; actions: `add`, `remove`; names: 3–16 ASCII letters/digits/underscore. UUID is optional. While stopped, identity resolves from an explicit UUID, a known identity, an offline-mode UUID, or Mojang's online profile endpoint. While running, fixed Minecraft console commands are used and the job waits for observed JSON confirmation. Live op uses Minecraft's configured permission level: omit `level` while running. Stopped edits accept levels 1–4. Reasons are single-line, at most 256 UTF-8 bytes. Malformed files fail without rewriting; do not silently replace them. Archived instances cannot edit players. Removal requires a clear UI confirmation. No command is sent until the owner submits an action.

## Policies and runtime state

`GET /api/v1/servers/{id}/automation` returns:

```json
{"recovery":{"autoStart":false,"restartOnCrash":false,"maxAttempts":3,"retryDelaySeconds":30},"backup":{"enabled":false,"intervalMinutes":1440,"keepLast":null},"historyEnabled":true,"desiredRunning":false,"restartAttempts":0,"nextRetryAt":null,"stableSince":null,"nextBackupAt":null,"lastBackupAt":null,"lastBackupJob":null,"lastBackupExportId":null,"lastBackupResult":null,"lastBackupError":null,"lastHistoryAt":null}
```

All `*At` values here are nullable **Unix seconds**. Last history time is the last collection attempt, not proof a sample exists. Unknown future fields may be present.

`intentAt` is an internal nanosecond revision marker for manual lifecycle/policy intent, not a display timestamp. Automatic starts compare it atomically so a newer Stop or policy edit supersedes queued recovery.

- `PUT /servers/{id}/recovery` (under `/api/v1`) takes the full recovery object and returns the full automation state. Defaults are off. Limits: 1–10 attempts, 5–300 seconds between retries. Manual stop/kill suppresses recovery; clean game exits do not trigger it. Stable container uptime for five minutes resets the retry budget. Auto-start is a separate manager-startup option. Neither accepts the EULA, claims ports from other instances, nor starts an archived instance.
- `PUT /servers/{id}/backup-schedule` takes `{enabled,intervalMinutes,keepLast,confirmRetentionDeletion}` and returns the full automation state. Intervals: 1–10080 minutes. Needs configured S3 storage. Schedules are **stopped only**: running instances are skipped with a recorded explanation, never stopped automatically. Changing the schedule sets the next due time from now; missed time does not cause a catch-up storm. `keepLast:null` keeps all. Values 1–100 prune only scheduler-created archives after a fresh full S3 backup is verified. Manual exports and pinned restore points are protected. Setting/changing numeric retention requires `confirmRetentionDeletion:true`; provide a meaningful acknowledgement in the UI. Enabling a schedule is explicit; defaults are disabled.
- `PUT /servers/{id}/metrics/history-settings` takes `{enabled:bool}` and returns the full automation state. It affects background history only, independently of the existing live interval/attention controls.

Suggested placement: compact Recovery and History sections in Settings; Schedule section in Exports with Storage link when unconfigured. Show next due/last result, skipped-running explanation and last job link. Keep disabled policies off until saved by the owner. No automatic actions from opening a page.

New jobs: `server.players`, `server.auto_start`, `server.recover`, `server.backup_scheduled`. Scheduled backups report existing export work stages and result `{export,scheduled:true,retentionDeleted}`; recovery jobs return `{server,automatic:true}`. Integrate labels and active-job recovery: scheduled backup behaves as an export (blocks competing mutations), automatic starts behave as starts. Errors include `operations.invalid`, `operations.busy`, `operations.storage`, `players.identity`, `players.invalid_file`, `players.files`, and existing server/export errors. Bodies and error details must remain plain text.

## Persistent history

`GET /api/v1/servers/{id}/metrics/history?hours=24` accepts 1–168 hours and returns:

```json
{"enabled":true,"intervalSeconds":60,"retentionDays":7,"resolutionSeconds":120,"items":[{"sampledAt":1794744000,"cpuPercent":3.2,"memoryWorkingSetBytes":104857600,"memoryLimitBytes":536870912}]}
```

Point timestamps are **Unix seconds**, unlike live `ServerMetrics.sampledAt` strings. Values can be null. Background collection defaults on, about once per minute for running instances, even with no browser open. Concurrency is bounded; missing/busy samples are skipped. Storage retains seven days and at most 100,000 rows across the manager. Responses have at most 720 averaged buckets of observed snapshots, not continuous averages; `resolutionSeconds` describes the bucket. Do not fabricate missing samples or bridge long gaps.

Reuse chart components for 1h/24h/7d views with an empty/error/disabled state and clear snapshot/retention labels. Historical views must **not** leave the live High frequency chart observer active; the header should fall back to standby while history is selected. Fetch once on entry/range change and optionally at most once per minute while attended. Live charts and their High frequency opt-in remain unchanged.

Existing full backup/archive/restore APIs remain the source of truth. The release test will exercise an owned Vanilla world through RustFS and compare checksums before/after restore. No existing world, storage connection or credentials may be changed for a test.

References: [Paper data files](https://docs.papermc.io/paper/reference/vanilla-data-files/), [Paper properties](https://docs.papermc.io/paper/reference/server-properties/), [Minecraft protocol implementation](https://github.com/PrismarineJS/node-minecraft-protocol).
