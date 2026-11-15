# Phase 1 — API, WebSocket, migration, events

## REST endpoints

All under `/api/v1`. Auth = any principal with the listed permission (admin-only where noted). Create/update/delete follow [server-api.md](../../architecture/server-api.md) exactly.

| Method | Path | Perm | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/servers` | `server.view` (filter) | — | `200 {items: ServerDto[]}` | — |
| POST | `/servers` | `server.create` (+admin for url/import/custom) | `CreateServerRequest` | `202 {server: ServerDto, job: Job, warnings: Warning[]}` | `422 validation`, `422 import.disabled`, `422 import.outside_roots`, `403`, `409 server.port_taken`, `409 server.port_in_use`, `409 server.limit`, `409 name.taken` |
| GET | `/servers/{serverId}` | `server.view` | — | `200 ServerDto` | `404 server.not_found` |
| PATCH | `/servers/{serverId}` | `server.settings` | `UpdateServerRequest` | `200 {server: ServerDto, warnings: Warning[]}` | `422`, `409 name.taken` |
| DELETE | `/servers/{serverId}?force=false` (P6 adds `&deleteBackups=`) | `server.delete` | — | `202 {job}` | `409 server.running`, `409 server.busy` |
| POST | `/servers/{serverId}/start` | `server.power` | — | `202 {status: Status}` | `409 server.running`, `server.busy`, `server.launch_missing`, `server.java_missing`, `server.port_in_use`; `503 supervisor.unavailable` |
| POST | `/servers/{serverId}/stop` | `server.power` | — | `202 {status}` | `503` |
| POST | `/servers/{serverId}/restart` | `server.power` | — | `202 {status}` | as start |
| POST | `/servers/{serverId}/kill` | `server.power` | — | `202 {status}` | `503` |
| POST | `/servers/{serverId}/clone` | `server.view` + `server.create` | `{name: string}` | `202 {server: ServerDto, job, warnings}` | `409 server.running`, `409 server.busy`, `422` |
| POST | `/servers/{serverId}/eula` | `server.settings` | `{accept: true}` | `204` | `422` |
| POST | `/servers/{serverId}/command` | `console.write` | `{line: string}` | `204` | `409 server.not_running`, `422 console.invalid_command`, `429` |
| GET | `/servers/{serverId}/console?epoch=&sinceSeq=&limit=1000` | `console.read` | — | `200 {epoch: string, lines: ConsoleLine[], reset: boolean, lastSeq: number}` | — |
| GET | `/servers/{serverId}/console/log` | `console.read` | — | `200 text/plain` (`Content-Disposition: attachment; filename="<slug>-console.log"`) | `404 console.no_log` |
| GET | `/servers/{serverId}/crashes` | `console.read` | — | `200 {items: CrashLog[]}` | — |
| GET | `/servers/{serverId}/crashes/{name}` | `console.read` | — | `200 text/plain` | `404`, `422` |
| GET | `/java/detected` | `server.create` | — | `200 {items: DetectedJava[]}` | — |

## Schemas

```ts
type ServerState = "stopped" | "installing" | "starting" | "running" | "stopping" | "crashed";
type ExitInfo = { code: number | null; signal: number | null;
                  reason: "requested" | "killed" | "crashed" | "eula_required" | "start_failed" | "crash_loop";
                  at: string };
type Status = { state: ServerState; pid: number | null; startedAt: string | null; readyAt: string | null;
                exit: ExitInfo | null; restartCount: number; nextRestartAt: string | null };
// Status and ExitInfo are additive: later phases add fields/enum values (restartRequired P2,
// lastInstallError P3, maintenance P6, state "unknown" and reason "oom_killed" P10). Clients must ignore unknowns.
type Warning = { code: string; field?: string; message: string };
type LogFamily = "vanilla" | "fabric" | "paper" | "forge" | "bungee";
type LaunchSpec = { kind: "jar"; path: string } | { kind: "argsFile"; path: string } | { kind: "custom"; args: string[] };

type ServerDto = {
  id: string; name: string; slug: string;
  flavor: "custom" | "vanilla" | "paper" | "purpur" | "fabric" | "quilt" | "forge" | "neoforge"
        | "velocity" | "bungeecord" | "waterfall";   // only "custom" is created in P1
  logFamily: LogFamily;                     // effective family (explicit or derived from flavor)
  mcVersion: string | null; loaderVersion: string | null;
  launch: LaunchSpec;
  java: { runtimeId: string | null; path: string | null };
  memoryMinMb: number; memoryMaxMb: number; jvmArgs: string[];
  port: number;                             // RCON/management fields are added additively in P5
  stopCommand: string; stopTimeoutS: number; startTimeoutS: number; readyPattern: string | null;
  autoStart: boolean; restartOnCrash: boolean; maxRestarts: number; restartWindowS: number;
  eulaAccepted: boolean;
  status: Status;
  myPermissions: string[];                  // effective permissions of the caller on this server (all, for owner/admin in P1)
  createdAt: string; updatedAt: string;
};

// Subset of server-api.md accepted in P1; later fields (java, acceptEula, runtime,
// source.kind "installer" | "pack") are unknown fields → 422 until their phase.
type CreateServerRequest = {
  name: string;
  source: { kind: "url"; url: string; sha256?: string; fileName?: string }
        | { kind: "import"; path: string; jarPath?: string; move?: boolean };
  javaPath: string;                         // P3 adds the additive alternative `java`
  memoryMinMb?: number; memoryMaxMb?: number; // defaults 1024/2048 only when unset
  jvmArgs?: string[];                       // admin free-form → warning jvm_args_admin_freeform
  port?: number;
  launch?: LaunchSpec;                      // default {kind:"jar", path: <resolved jar>}; custom admin-only
  autoStart?: boolean; restartOnCrash?: boolean;
};

type UpdateServerRequest = Partial<{        // P1 rows of the server-api.md validation table + logFamily
  name: string; autoStart: boolean; restartOnCrash: boolean; maxRestarts: number; restartWindowS: number;
  stopCommand: string; stopTimeoutS: number; startTimeoutS: number; readyPattern: string | null;
  logFamily: LogFamily | null;              // null = derive from flavor
}>;

type ConsoleLine = { epoch: string; seq: number; ts: string; stream: "stdout" | "stderr" | "input" | "system"; text: string; user?: string };
type CrashLog = { name: string; at: string; size: number; exit: ExitInfo | null };
type DetectedJava = { path: string; version: string; major: number; vendor: string | null; source: "JAVA_HOME" | "PATH" | "jvm_dir" };
```

Job kinds: `server.create` (result `{launch}`), `server.clone` (result `{serverId}`), `server.delete` (its own row survives the deletion as the record).

`SystemInfo` (P0) gains additive field `epoch: string` (current mcm run id).

## WebSocket

| Topic | Server → client `data` | Perm |
|---|---|---|
| `servers` | `{type:"status", serverId, status}`, `{type:"created", server}`, `{type:"updated", server}`, `{type:"deleted", serverId}` | filtered by `server.view` |
| `server:<id>` | `{type:"status", status}` (sent immediately on subscribe, then on change) | `server.view` |
| `console:<id>` | `{type:"lines", lines: ConsoleLine[]}` · `{type:"lagged", skipped: number}` · `{type:"reset", epoch: string, lines: ConsoleLine[]}` (full ring snapshot) | `console.read` |

Client op added: `{op:"command", id, serverId, line}` → `ack` or `error` (same codes as REST).

Subscribe to `console:<id>` with `{epoch?, sinceSeq?}`; the `ack` carries `{epoch}` (current run id):
1. If `epoch` equals the current epoch and `sinceSeq` ≥ first ring seq − 1 → `lines` with all ring lines `seq > sinceSeq` (possibly empty), then live.
2. Else (epoch mismatch after an mcm restart, evicted `sinceSeq`, or absent) → `reset` with the current epoch and full ring, then live.
3. Live batches never overlap replayed lines (subscribe to broadcast **before** snapshotting; drop live lines with `seq ≤ last replayed`).

## Events

| Event | Payload | Consumers |
|---|---|---|
| `ServerCreated` | `Server` | WS `servers` |
| `ServerUpdated` | `Server` | WS |
| `ServerDeleted` | `server_id` | WS, registry |
| `ServerStatusChanged` | `server_id, status` | WS, (P5 metrics, P8 notify) |
| `ServerCrashed` | `server_id, exit, crash_log` | (P8 notify) |
| `ServerCrashLoop` | `server_id, restarts` | (P8 notify) |
| `ServerStartSlow` | `server_id, elapsed_s` | WS as `System` console line |
| `ConsoleCommandSent` | `server_id, user_id, line` | (P5 player tracking ignores) |

## Error codes introduced

`server.not_found`, `server.running`, `server.starting`, `server.not_running`, `server.busy`, `server.limit`, `server.port_taken`, `server.port_in_use`, `server.launch_missing`, `server.java_missing`, `supervisor.unavailable`, `name.taken`, `import.disabled`, `import.outside_roots`, `import.jar_ambiguous`, `download.hash_mismatch`, `download.too_large`, `download.blocked_target`, `download.failed`, `fs.no_space` (507), `console.invalid_command`, `console.no_log`, `java.invalid`.

## Config keys introduced

```toml
[process]
import_roots = []            # absolute dirs allowed for import; empty = import disabled
start_timeout_s = 600

[security]
allow_private_targets = false   # SafeHttp SSRF guard for every outbound fetch (URL sources now; installers, packs, webhooks later)
```

## DB migration

File: `crates/chunkyard-db/migrations/<NNNN>_p1_servers.sql`

```sql
CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  node_id TEXT,
  flavor TEXT NOT NULL,
  mc_version TEXT,
  loader_version TEXT,
  launch TEXT NOT NULL,
  java_runtime_id TEXT,
  java_path TEXT,
  memory_min_mb INTEGER NOT NULL,
  memory_max_mb INTEGER NOT NULL,
  jvm_args TEXT NOT NULL DEFAULT '[]',
  env TEXT NOT NULL DEFAULT '{}',
  port INTEGER NOT NULL,
  rcon_port INTEGER,                -- NULL until P5 enables RCON
  rcon_password_enc BLOB,           -- NULL until P5 (AAD servers.rcon_password_enc:<id>)
  log_family TEXT,                  -- NULL = derive from flavor
  stop_command TEXT NOT NULL DEFAULT 'stop',
  stop_timeout_s INTEGER NOT NULL DEFAULT 60,
  start_timeout_s INTEGER NOT NULL DEFAULT 600,
  ready_pattern TEXT,
  auto_start INTEGER NOT NULL DEFAULT 0,
  restart_on_crash INTEGER NOT NULL DEFAULT 1,
  max_restarts INTEGER NOT NULL DEFAULT 3,
  restart_window_s INTEGER NOT NULL DEFAULT 600,
  last_state TEXT NOT NULL DEFAULT 'stopped',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- node_id NULL = local (P11 seam only); IFNULL so NULLs participate in uniqueness
CREATE UNIQUE INDEX servers_port ON servers(IFNULL(node_id, ''), port);
CREATE UNIQUE INDEX servers_rcon_port ON servers(IFNULL(node_id, ''), rcon_port) WHERE rcon_port IS NOT NULL;
CREATE INDEX servers_name ON servers(name);
```

Matches [data-model.md](../../architecture/data-model.md#phase-1--servers) plus `log_family` (see [log-formats.md](../../architecture/log-formats.md)). `rcon_*` columns exist but stay NULL until P5. The numeric prefix is assigned at merge time.
