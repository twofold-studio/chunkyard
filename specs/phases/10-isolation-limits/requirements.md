# Phase 10 — Requirements

Conventions: [patterns.md](../../architecture/patterns.md). Lifecycle semantics from [process-model.md](../../architecture/process-model.md) hold for every runtime unless stated. Audit names from [audit.md](../../architecture/audit.md).

## Runtime abstraction

| ID | Requirement | Crates | Perm | Audit | Events |
|---|---|---|---|---|---|
| P10-FR-01 | Every runtime implements the **single** `ProcessSpawner`/`ChildProcess` definition in [process-model.md](../../architecture/process-model.md#spawner-trait-single-definition) (`spawn`, `adopt`, `capabilities`, `backlog`); this phase adds no trait methods. `ProcStats` is obtained through `mcm-core`'s `ServerStatsSource` trait implemented per runtime (cgroup files, Docker stats, or `/proc`). Supervisor code stays runtime-agnostic; a spawner conformance suite runs the phase 1 lifecycle scenarios against each spawner. | core, process | — | — | — |
| P10-FR-02 | `servers.runtime ∈ {native, shim, docker}`, default `process.default_runtime`. Changed via `PATCH /servers/{id} {runtime, dockerImage?}` ([server-api.md](../../architecture/server-api.md#validation-table)) only while Stopped (`409 server.running`); `docker` requires Docker available (`424 docker.unavailable`), `shim` requires the shim binary (`424 shim.unavailable`). Files are untouched. Changing to `native`/`shim` applies the phase 8 grant-conflict rule ([P8-FR-14](../08-users-audit-notifications/requirements.md#per-server-permissions)): `409 server.runtime_grants_conflict` unless `revokeConflictingGrants=true`. | process, api, auth, db | admin | `server.runtime.change` | `ServerUpdated` |
| P10-FR-03 | `GET /system/isolation` reports: Docker (reachable, version, API version, rootless, userns-remap, runtime image), shim (binary path, version), cgroups (mode `delegated|none`, controllers, `cgroup.kill`, reason), host totals. Probed at startup and on `?refresh=true`. | process, api | admin | — | — |

## Shim runtime (`mcm-shim`, `mcm-process::shim`)

Protocol and topology: [shim-protocol.md](shim-protocol.md).

| ID | Requirement | Crates | Events |
|---|---|---|---|
| P10-FR-04 | `mcm-shim` binary shipped next to `mcm` (config `shim.path`, default: sibling of the running executable; must be owned by root or the mcm user and not group/world-writable, else `shim.unavailable`). `ShimSpawner::spawn` launches it via the spawner thread with `setsid()` and **no** PDEATHSIG; the shim spawns java and owns its stdio. | process, shim | — |
| P10-FR-05 | Socket `<data>/state/<id>/shim.sock` (0600); every connection's `SO_PEERCRED` uid must equal the shim's uid. Frames per shim-protocol.md (`Hello`, `Stdin`, `Subscribe{since_offset}`, `Signal`, `Status`, `AckExit`). | shim | — |
| P10-FR-06 | Output log `<data>/state/<id>/shim.log` (+`.1`), rotated at 8 MiB; byte offsets monotonic; replay from `since_offset`; rotated-away ranges reported as `ReplayGap`. The shim never blocks java on a slow or absent client. | shim | — |
| P10-FR-07 | Stop/kill: stdin stop command → wait `stop_timeout_s` → `Signal{Term}` (killpg of java's group) → 15 s → `Signal{Kill}`. Exit delivered as `Exited` or, if mcm is absent, via `shim.exit.json` (held ≤ 24 h); shim exits after `AckExit`. | process, shim | `ServerStatusChanged` |
| P10-FR-08 | **Adoption** via `ShimSpawner::adopt()` per shim-protocol.md: verify `server_id` and java pid/start time, replay since the persisted offset (console clients get `reset` because the epoch changed), state `Running` without restart; exit file → recorded exit with normal crash policy. | process, shim, db | `ServerStatusChanged` (`adopted: true`) |
| P10-FR-09 | Manager shutdown: shim servers are left running unless `shim.leave_running_on_shutdown = false`. The packaged systemd unit sets `Delegate=yes` and `KillMode=process` when shim/docker runtimes are enabled (documented; `mcm doctor` warns if `KillMode` would kill shims). | process, server | — |

## Docker runtime (`mcm-process::docker`, feature `docker`)

| ID | Requirement | Crates | Events |
|---|---|---|---|
| P10-FR-10 | Connection: `bollard` honouring `DOCKER_HOST`; config `docker.socket`. Engine API ≥ 1.41 else capability `unavailable`. | process | — |
| P10-FR-11 | Image `docker.runtime_image` (default `ghcr.io/<org>/mcm-runtime:<mcm-version>`), pulled as a job with progress; digest pinned in release metadata and verified. | process | `JobUpdated` |
| P10-FR-12 | Container per start, name `mcm-<server-id>`: same argv as native (java `/opt/java/bin/java`), `WorkingDir=/data`, env as native, `User` per P10-FR-14, `OpenStdin=true, StdinOnce=false, Attach*=true, Tty=false`; labels `mcm.managed=true`, `mcm.server_id`, `mcm.instance_id` (random per data dir), `mcm.version`. | process | — |
| P10-FR-13 | HostConfig: `Binds = ["<host server dir>:/data:rw", "<host jre dir>:/opt/java:ro"]`; `ReadonlyRootfs=true`; `Tmpfs /tmp rw,nosuid,size=512m`; `CapDrop=["ALL"]`; `SecurityOpt=["no-new-privileges:true"]`; default seccomp/AppArmor; `Init=true`; `RestartPolicy=no`; `Memory = MemorySwap = limit`; `NanoCpus`; `PidsLimit` (default 2048); `LogConfig json-file max-size=10m max-file=3`. | process | — |
| P10-FR-14 | UID mapping: rootful → mcm's uid:gid; rootless → `0:0` inside and the daemon user must equal the mcm user (else warning `docker.uid_mismatch`); userns-remap → start refused unless `docker.allow_userns_remap=true`. | process | — |
| P10-FR-15 | Networking: bridge `mcm-net`; game port published on `127.0.0.1` when the server is router-only ([phase 7](../07-network-exposure/README.md)), else `docker.publish_ip`. RCON, query and management-protocol ports are **never** published; mcm reaches them by container IP on `mcm-net` (or published loopback when the bridge is not routable — decided by probe). | process, router | — |
| P10-FR-16 | Console: attach (stream, stdin/stdout/stderr) **before** `start_container`; demuxed frames feed the phase 1 line pipeline. Attach drop while running → re-attach with backoff (1 s → 10 s) and replay the gap from logs. | process | — |
| P10-FR-17 | Stop: stdin stop command → `wait_container` up to `stop_timeout_s` → `stop_container(t=15)` → kill. `State.OOMKilled` → `ExitInfo.reason = oom_killed`. Container removed after exit info is captured. | process | `ServerStatusChanged` |
| P10-FR-18 | **Adoption** via `DockerSpawner::adopt()`: list containers with `mcm.managed=true` and our `mcm.instance_id`; running container of an existing docker-runtime server → attach, replay `logs(since=lastOutputTs, timestamps=true)` into the ring (dedup by daemon timestamp), state `Running`; containers of deleted servers → stopped and removed (`warn`); exited → exit recorded, crash policy applies. Daemon unreachable → state `Unknown` (retry every 10 s). | process, db | `ServerStatusChanged` |
| P10-FR-19 | Shutdown: `docker.leave_running_on_shutdown` (default **true**) detaches without stopping; `lastOutputTs` persisted every 5 s and on shutdown. | process, server | — |
| P10-FR-20 | Stats via `stats(stream=false)`: CPU % = `(cpu_delta / system_delta) × online_cpus × 100`; memory = `usage − inactive_file`; exposed through `ServerStatsSource` to the phase 5 collector. | process, metrics | — |
| P10-FR-21 | mcm-in-Docker: detect own container, inspect self to find the host source of `data_dir` (override `docker.host_data_dir`); translate bind sources; validate with a probe file in a throwaway container (`path_translation_failed` otherwise); connect self to `mcm-net`. | process, server | — |

## cgroup v2 limits for native and shim (`mcm-process::platform::cgroup`)

| ID | Requirement | Crates |
|---|---|---|
| P10-FR-22 | Mode detection: **delegated** if mcm's own cgroup (`/proc/self/cgroup`, unified `0::/…`) is writable and `cgroup.controllers` includes `memory cpu pids` (packaged unit: `Delegate=yes`). mcm moves itself into leaf `<own>/mcm` and enables controllers in `<own>/cgroup.subtree_control`. Otherwise mode **none**: limits not enforced, persistent UI warning with setup docs. No `systemd-run --user` fallback. | process |
| P10-FR-23 | Delegated spawn: create `<own>/servers/<server-id>` per start; write `memory.max`, `memory.swap.max=0`, `cpu.max "<quota_us> 100000"`, `pids.max`; open its `cgroup.procs` before fork and write `0` in `pre_exec` (async-signal-safe `write(2)`, SAFETY-commented, `platform` only). For shim, the shim process is placed in the cgroup (java inherits). After exit read `memory.events` `oom_kill` delta → `oom_killed`; rmdir. | process |
| P10-FR-24 | Stop/kill fall back to `cgroup.kill` (kernel ≥ 5.14; older: iterate `cgroup.procs`), killing processes that escaped the process group via `setsid`. | process |
| P10-FR-25 | Stats from `cpu.stat usage_usec` and `memory.current` when delegated. | process, metrics |

## Limits and guards

| ID | Requirement | Crates | Perm | Audit |
|---|---|---|---|---|
| P10-FR-26 | Per-server limits via `PATCH /servers/{id}`: `cpuLimit` (0.1–host cores, null = none), `pidsLimit` (64–32768, default 2048), `memoryOverheadMb` (null = auto). Effective memory limit = `memoryMaxMb + max(25 % of memoryMaxMb, 512)` unless overridden. | process, api | admin | `server.update` |
| P10-FR-27 | Global memory guard `limits.max_total_memory_mb` (**default 0 = unlimited**, [config.md](../../architecture/config.md)). When > 0, start is refused with `409 limits.memory_exceeded` if Σ(effective limits of running/starting servers) + this server's > max. Checked inside the `ServerRegistry` actor (no races); auto-start skips such servers with a warning event. | process | `server.power` | `server.start` (failure) |
| P10-FR-28 | Per-server `diskQuotaMb` (soft): ≥ 90 % → `DiskQuotaWarning`, ≥ 100 % → `DiskQuotaExceeded` (notification `disk.quota_exceeded`). With `enforceDiskQuota`, write endpoints (upload, extract, install, copy, restore) fail `507 fs.quota_exceeded` while exceeded. | metrics, fs, api | admin | `server.update` |
| P10-FR-29 | OOM kill: `ExitInfo.reason = oom_killed` counts as a crash for restart policy and emits `ServerOomKilled`; UI suggests raising the limit or lowering Xmx. Runtime unreachable → state `Unknown`, `RuntimeUnavailable` event (notification `runtime.unavailable`). | process | — | — |

## Edge cases & failure modes

| Case | Behaviour |
|---|---|
| Docker daemon down at mcm start | Docker servers `Unknown`; retry every 10 s; others unaffected |
| Docker daemon restarts while servers run | Containers die (RestartPolicy=no) → crash policy |
| Container name exists but not ours | `409 docker.name_conflict`; never removed automatically |
| Image pull fails | Job fails `upstream.docker_registry`; start `424 docker.image_missing` |
| Shim killed with SIGKILL | java receives SIGTERM (PDEATHSIG) and exits; on next adopt the socket is dead and no exit file exists → state `Crashed` with reason `crashed`, crash policy applies |
| mcm killed with SIGKILL, shim server running | Next start adopts it (P10-FR-08) |
| Shim log rotated past persisted offset | `ReplayGap` → system line "output lost while mcm was offline" |
| Older shim after mcm upgrade | Lowest common protocol; incompatible → `Unknown`, "restart required" |
| `KillMode=control-group` under systemd | Shims die with mcm restarts; `mcm doctor` and the isolation page warn |
| cgroup mode `none` but limits configured | Start allowed; warning badge; `/system/isolation` explains |
| cpuLimit > host cores | `422 validation` |

## Security considerations

- Docker socket access is root-equivalent; required only when the Docker runtime is enabled; rootless Docker recommended.
- Containers never get the Docker socket, host network, `--privileged`, or extra capabilities; `dockerImage` cannot change HostConfig.
- Bind mounts limited to the server dir and JRE dir, both from mcm's DB, canonicalised and under `data_dir`.
- Shim: binary path from config only, ownership checked; socket 0600 + `SO_PEERCRED`; reads nothing from the user-writable server dir; state files live in `<data>/state/<id>/` ([security.md](../../architecture/security.md#untrusted-server-directory)).
- Native and shim are single-trust; only Docker unlocks code-execution grants for `user`s (phase 8).

## Open questions / to verify

- Podman compatibility via its Docker API socket.
- `KillMode=process` is flagged "not recommended" by systemd; alternative is spawning shims as transient system units over D-Bus (needs privileges).
- Docker log drivers other than `json-file`/`local` break replay — detect and warn.
- cgroup v1 hosts: capability warning only.
