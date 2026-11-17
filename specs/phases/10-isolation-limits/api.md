# Phase 10 — API, events, migration, config

## REST

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/v1/system/isolation?refresh=` | admin | — | `200 IsolationCapabilities` | — |
| POST | `/api/v1/system/docker/pull` | admin | `{image?: string}` (default runtime image) | `202 {job}` | `424 docker.unavailable` |
| PATCH | `/api/v1/servers/{serverId}` ([server-api.md](../../architecture/server-api.md), extended) | admin for these fields | `{runtime?, dockerImage?, cpuLimit?, pidsLimit?, memoryOverheadMb?, diskQuotaMb?, enforceDiskQuota?}`; query `revokeConflictingGrants?` | `200 {server, warnings}` | `409 server.running`, `409 server.runtime_grants_conflict`, `424 docker.unavailable`, `424 shim.unavailable`, `422 validation`, `403` |
| GET | `/api/v1/system/memory` (phase 2, extended) | authenticated | — | adds `{maxTotalMb: number /* 0 = unlimited */, committedMb}` | — |

`ServerDto` gains `runtime: "native"|"shim"|"docker"`, `dockerImage`, `limits: {cpuLimit, pidsLimit, memoryLimitMb /*effective*/, diskQuotaMb, enforceDiskQuota}`, `limitsEnforced: boolean`. `Status` gains `adopted?: boolean`; `state` may be `"unknown"`; `exit.reason` may be `"oom_killed"` (additive, per [process-model.md](../../architecture/process-model.md#server-state-machine)).

```ts
type IsolationCapabilities = {
  docker: { available: boolean; reason?: string; version?: string; apiVersion?: string; rootless?: boolean;
            usernsRemap?: boolean; runtimeImage: { name: string; present: boolean; digest?: string };
            mcmInContainer: boolean; hostDataDir?: string; warnings: string[] };
  shim: { available: boolean; path: string; version?: string; reason?: string; killModeWarning?: boolean };
  cgroups: { mode: "delegated" | "none"; controllers: string[]; cgroupKill: boolean; reason?: string };
  host: { totalMemoryMb: number; cpus: number };
};
```

## WebSocket

No new topics. `server:<id>` status carries `state: "unknown"`, `adopted`, `exit.reason: "oom_killed"`. After adoption the `console:<id>` subscribers receive `reset` (new epoch) followed by the ring, which includes replayed output.

## Events

`ServerOomKilled { server_id, limit_mb }`, `DiskQuotaWarning { server_id, used_mb, quota_mb }`, `DiskQuotaExceeded { … }`, `RuntimeUnavailable { runtime, reason }`, `RuntimeRecovered { runtime }`. Notification catalog (phase 8) adds `server.oom_killed`, `disk.quota_exceeded`, `runtime.unavailable`.

## DB migration

File: `crates/db/migrations/<NNNN>_p10_isolation_limits.sql` (number assigned at merge).

```sql
ALTER TABLE servers ADD COLUMN runtime TEXT NOT NULL DEFAULT 'native'
  CHECK (runtime IN ('native','shim','docker'));
ALTER TABLE servers ADD COLUMN docker_image TEXT;
ALTER TABLE servers ADD COLUMN cpu_limit REAL;
ALTER TABLE servers ADD COLUMN pids_limit INTEGER NOT NULL DEFAULT 2048;
ALTER TABLE servers ADD COLUMN memory_overhead_mb INTEGER;
ALTER TABLE servers ADD COLUMN disk_quota_mb INTEGER;
ALTER TABLE servers ADD COLUMN enforce_disk_quota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN runtime_state TEXT;   -- JSON: {containerId?, lastOutputTs?, shimOffset?, cgroupPath?}
```

## Config additions (`mcm.toml`)

Each section is a sub-struct owned by its crate (`chunkyard-process`), composed by `chunkyard-config`.

```toml
[process]
default_runtime = "native"            # native | shim | docker

[shim]
path = ""                             # empty = sibling of the mcm executable
log_max_bytes = 8388608
exit_hold_s = 86400
leave_running_on_shutdown = true

[docker]
socket = ""                           # empty = DOCKER_HOST or /var/run/docker.sock
runtime_image = ""                    # empty = ghcr.io/<org>/chunkyard-runtime:<version>
network = "chunkyard-net"
publish_ip = "0.0.0.0"
host_data_dir = ""                    # when mcm runs in a container and auto-detect fails
leave_running_on_shutdown = true
allow_userns_remap = false
default_pids_limit = 2048

[cgroup]
enabled = true                        # use delegated cgroups when detected

[limits]
max_total_memory_mb = 0               # 0 = unlimited (single default, see config.md)
```

## CLI additions

`mcm doctor` — prints isolation capabilities (`/system/isolation` without the HTTP server), systemd `Delegate=`/`KillMode=` of the running unit, and data-dir permission checks.

## Packaging

`packaging/mcm.service` adds `Delegate=yes`; a drop-in `packaging/mcm.service.d/shim.conf` with `KillMode=process` is installed when the shim or Docker runtime is enabled.

## Error codes introduced

`docker.unavailable` (424), `docker.image_missing` (424), `docker.name_conflict` (409), `docker.uid_mismatch` (409), `shim.unavailable` (424), `upstream.docker_registry` (502), `limits.memory_exceeded` (409), `fs.quota_exceeded` (507, `ErrorKind::InsufficientStorage`). `server.runtime_grants_conflict` (409) is defined in phase 8.

## Runtime image (`docker/runtime.Dockerfile`)

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fontconfig libfreetype6 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /data
# no JRE: mounted at /opt/java by mcm
```

Published multi-arch with each release; digest recorded in `chunkyard-server` build metadata.
