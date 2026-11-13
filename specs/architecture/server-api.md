# Server resource: create and update contract

Single source of truth for `POST /api/v1/servers` and `PATCH /api/v1/servers/{id}`. Phases extend these **additively**: new `source.kind` values, new optional fields; never renamed or repurposed fields.

## Create — `POST /servers`

```ts
type CreateServerRequest = {
  name: string;                                   // 1..64 chars
  source:
    | { kind: "url"; url: string; sha256?: string; fileName?: string }          // P1, admin-only
    | { kind: "import"; path: string; jarPath?: string; move?: boolean }        // P1, admin-only, under import_roots
    | { kind: "installer"; flavor: Flavor; mcVersion: string;                    // P3
        loaderVersion?: string; build?: string }
    | { kind: "pack"; platform: "curseforge" | "modrinth" | "upload";            // P4
        projectId?: string; fileId?: string; uploadId?: string };
  java?: { mode: "auto" } | { mode: "runtime"; runtimeId: string } | { mode: "path"; path: string }; // P3 (auto/runtime)
  javaPath?: string;                              // P1 form; equivalent to java = {mode:"path"}; both → 422
  memoryMinMb?: number; memoryMaxMb?: number;     // defaults applied only when unset (P1: 1024/2048; packs may suggest)
  jvmArgs?: string[];
  port?: number;
  launch?: LaunchSpec;                            // "custom" kind admin-only
  autoStart?: boolean; restartOnCrash?: boolean;
  acceptEula?: boolean;                           // P3: writes eula.txt when true
  runtime?: "native" | "docker";                  // P10
};
type Flavor = "vanilla" | "paper" | "purpur" | "fabric" | "quilt" | "forge" | "neoforge"
            | "velocity" | "bungeecord" | "waterfall";   // proxies added in P3
```

Response for **every** source kind (including P4 pack import via `POST /servers/import-pack` or `source.kind="pack"`): `202 { server: ServerDto, job: Job, warnings: Warning[] }`. The server row exists immediately in state `installing`.

## Update — `PATCH /servers/{id}`

Response from P1 onward: `200 { server: ServerDto, warnings: Warning[] }` where `Warning = { code: string; field?: string; message: string }` (e.g. `restart_required`, `memory_exceeds_host_free`, `jvm_args_admin_freeform`).

### Validation table

| Field | Type / range | Running server? | Permission | Phase |
|---|---|---|---|---|
| `name` | 1..64, trimmed, unique case-insensitive | yes | `server.settings` | 1 |
| `autoStart`, `restartOnCrash` | bool | yes | `server.settings` | 1 |
| `maxRestarts` | 0..20 | yes | `server.settings` | 1 |
| `restartWindowS` | 60..86400 | yes | `server.settings` | 1 |
| `stopCommand` | 1..64 printable, no control chars | yes | `server.settings` | 1 |
| `stopTimeoutS` | 5..600 | yes | `server.settings` | 1 |
| `startTimeoutS` | 30..3600 | yes | `server.settings` | 1 |
| `readyPattern` | valid regex ≤ 512 chars, compiled with size limit; `null` resets | yes (next start) | `server.settings` | 1 |
| `memoryMinMb` | 256..`memoryMaxMb` | warning `restart_required` | `server.settings` | 2 |
| `memoryMaxMb` | ≥ `memoryMinMb`, ≤ host total − 512; warn if > host free | warning `restart_required` | `server.settings` | 2 |
| `jvmArgs` | ≤ 64 items, each ≤ 512 chars; non-admin: **allow-list** ([security.md](security.md#jvm-arguments)); admin: free-form + warning `jvm_args_admin_freeform` | warning `restart_required` | `server.settings` (+ admin for free-form) | 2 |
| `env` | ≤ 32 keys `[A-Z_][A-Z0-9_]*`, not `PATH`/`HOME`/`LD_*`/`JAVA_TOOL_OPTIONS`/`_JAVA_OPTIONS`/`JDK_JAVA_OPTIONS` | warning `restart_required` | admin | 2 |
| `port` | in `process.port_range` or 1024..65535 for admin; not used by another server; bind probe | must be stopped (`409 server.running`) | `server.settings` | 2 |
| `launch` | `jar`/`argsFile` path via `RelPath`; `custom` admin-only | must be stopped | `server.settings` / admin | 2 |
| `java` | as in create | must be stopped | `server.settings` (`path` mode admin-only) | 3 |
| `runtime` | `native`/`docker` | must be stopped | admin | 10 |

Unknown fields → `422 validation`. Fields not yet supported by the running phase are unknown fields.

**Native single-trust note (D1):** on native-runtime servers `jvmArgs`, `launch`, and `env` are admin-equivalent capabilities; see [security.md](security.md#native-runtime-is-single-trust).

## Delete — `DELETE /servers/{id}`

`202 { job }` (async, see [api-conventions.md](api-conventions.md#rest)); query `force` (P1) and `deleteBackups` (P6). The delete job removes all other jobs for the server **except its own row**, which is retained as the record of the deletion.
