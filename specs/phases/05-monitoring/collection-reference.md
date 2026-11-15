# Phase 5 — Collection reference

## CPU and memory from `/proc` (`LinuxProcSampler`)

1. Enumerate `/proc/[0-9]*/stat`; select pids whose field 5 (`pgrp`) equals the server's pgid. (Cheaper alternative when available: track descendants from the known child pid via `/proc/<pid>/task/*/children`; the pgrp scan is the reference implementation.)
2. For each pid: `utime` (field 14) + `stime` (field 15) in clock ticks (`sysconf(_SC_CLK_TCK)`), `starttime` (field 22).
3. RSS: `/proc/<pid>/statm` field 2 (resident pages) × page size. (Not `VmRSS` parse — `statm` is cheaper; both acceptable.)
4. CPU % for interval Δt: `Σ Δticks / CLK_TCK / Δt × 100`, baseline keyed by `(pid, starttime)`.
5. Parsing note: `comm` (field 2) may contain spaces and `)`; parse from the **last** `)`.

The JVM's RSS includes heap actually touched, metaspace, code cache, direct buffers; it can exceed `-Xmx`. UI shows `-Xmx` as a reference line, not a limit.

## Host (`HostSampler`)

| Metric | Source |
|---|---|
| CPU % | `/proc/stat` aggregate `cpu` line deltas: `1 − Δidle+iowait / Δtotal` |
| Memory | `/proc/meminfo`: `MemTotal`, `MemAvailable` (used = total − available), `SwapTotal`, `SwapFree` |
| Load | `/proc/loadavg` |
| Disk | `statvfs(data_dir)`: `f_blocks`, `f_bavail`, `f_frsize` |
| Cores | `available_parallelism()` (respects cgroup CPU quota in containers) |

## Disk walk (`DiskUsageCache`)

- `walkdir`-style iterative traversal of `servers/<id>/` with `symlink_metadata` (never follows links), sums `st_blocks × 512` (allocated size, matches `du`). mcm state lives in `<data>/state/<id>/` and is not part of the walk.
- Runs in `spawn_blocking`, cancellable via token checked every 1000 entries.

## Players

| Source | Command / packet | Gives |
|---|---|---|
| Management protocol (1.21.9+) | `{"jsonrpc":"2.0","id":n,"method":"minecraft:players"}`; notifications `minecraft:notification/players/joined` / `…/left` | full names + UUIDs, live join/leave (preferred) |
| RCON | `list` → `There are 2 of a max of 20 players online: Alice, Bob` (1.13+); `There are 2/20 players online:` + names line (older) | online, max, full names |
| RCON (UUIDs, optional) | `list uuids` (1.13+? verify) → `Alice (uuid), Bob (uuid)` | names + UUIDs |
| SLP | Status JSON `players.online`, `players.max`, `players.sample` | counts, partial names |
| Query | Full stat | online, max, full names |

Console join/leave/UUID detection uses the **flavour-aware** `join`, `leave` and `uuid` matchers in [log-formats.md](../../architecture/log-formats.md): ANSI stripped, family prefix parsed, source checked (server thread / `User Authenticator #n` where the format has a thread), body anchored from its first character, chat markers rejected. A single generic prefix regex is **not** used, because Paper (`[HH:MM:SS INFO]:`), vanilla (`[HH:MM:SS] [Server thread/INFO]:`) and Forge (`… [minecraft/DedicatedServer]:`) differ and chat would otherwise spoof sessions.

Names: `[A-Za-z0-9_]{1,16}`. Floodgate/Geyser prefixes (`.Name`, `*Name`) — accept one leading `.` or `*` (verify Floodgate conventions); this does not weaken anchoring because the name must still be the first token of the body.

## TPS probes

| Flavor | Probe order | Parsed fields |
|---|---|---|
| paper, purpur | `spark tps` (if spark detected) → `tps` + `mspt` | tps1m (and 5m, 15m), mspt avg (5 s window) |
| vanilla ≥ 1.20.3 | `tick query` | mspt avg → tps = min(20, 1000/mspt) |
| vanilla < 1.20.3 | none (Unsupported) | — |
| forge | `forge tps` | Overall `Mean tick time` (mspt), `Mean TPS` |
| neoforge | `neoforge tps` | same shape (verify) |
| fabric, quilt | `spark tps` if installed; else Unsupported | — |
| custom | `tps` attempted once, then Unsupported | — |

Spark detection (RCON only; skipped when `rconDisabled`): once per server start, send `spark` and check the response is not `Unknown or incomplete command` (verify spark's RCON behaviour — spark may require permission from console sender, RCON sender has op level 4).

All parsers: pure functions in `chunkyard-protocol::text::{tps, list, join}` that strip `§x` codes first; tolerate `*20.0` (Paper caps at 20 and prefixes `*`).

## Rollup math

| From → To | Bucket | Trigger | Window processed |
|---|---|---|---|
| 10 s → 60 s | `ts − ts % 60000` | every minute | buckets fully in the past and ≥ 1 complete, last 10 min re-aggregated (idempotent) |
| 60 s → 3600 s | `ts − ts % 3600000` | hourly at :01 | last 3 h re-aggregated |

`NULL` values are excluded from averages; a bucket with no non-null value stores `NULL`.

## Storage estimate

Per server: 10 s rows for 48 h = 17 280; 60 s for 14 d = 20 160; 3600 s for 400 d = 9 600 → ≈ 47 k rows × ~60 B ≈ 3 MB per server (+ index overhead). 100 servers ≈ 0.5 GB worst case; acceptable.

## Prometheus exposition

```
# HELP mcm_server_cpu_percent CPU usage of the server process group (100 = one core)
# TYPE mcm_server_cpu_percent gauge
mcm_server_cpu_percent{server_id="…",server_name="survival",flavor="paper"} 37.5
mcm_server_memory_rss_bytes{…} 3.2e9
mcm_server_disk_bytes{…} 1.1e10
mcm_server_players_online{…} 4
mcm_server_players_max{…} 20
mcm_server_tps{…} 19.97
mcm_server_mspt{…} 12.3
mcm_server_up{…} 1
mcm_server_uptime_seconds{…} 86400
mcm_host_cpu_percent 22.1
mcm_host_memory_used_bytes 1.2e10
mcm_host_memory_total_bytes 3.2e10
mcm_host_disk_used_bytes 2.0e11
mcm_host_disk_total_bytes 1.0e12
mcm_host_load1 0.8
mcm_build_info{version="x.y.z"} 1
```

Label values escaped per the text format (`\\`, `\"`, `\n`). Content-Type `text/plain; version=0.0.4`.
