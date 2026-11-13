# Phase 10 — Runtimes, isolation and resource limits

## Goal

Lift the two big native-runtime limitations: servers stopping when mcm restarts, and the absence of any boundary between servers and the host. Phase 10 adds two runtimes — **shim** (a tiny per-server `mcm-shim` process that keeps the server's stdio alive across mcm restarts) and **Docker** (one hardened container per server) — plus **delegated cgroup v2 limits** and global/per-server resource guards. All runtimes implement the single `ProcessSpawner` trait defined in [process-model.md](../../architecture/process-model.md#spawner-trait-single-definition); this phase does not redefine it.

## Scope

| Area | In scope |
|---|---|
| Runtime selection | `runtime: native | shim | docker` per server, switchable while stopped; interacts with phase 8 grants ([P8-FR-14](../08-users-audit-notifications/requirements.md#per-server-permissions)) |
| Shim runtime | `mcm-shim` binary + client lib: owns java's stdio, unix socket `<data>/state/<id>/shim.sock`, bounded replay log, survives mcm restarts, re-adopted via `ProcessSpawner::adopt()` |
| Docker runtime | `DockerSpawner` (`mcm-process`, feature `docker`) via `bollard`; hardened container per server; attach console; re-adopt after mcm restart with log replay; stats |
| Native/shim limits | cgroup v2 **only via a delegated subtree** (`Delegate=yes`); memory/CPU/PIDs; OOM detection; otherwise no limits + UI warning |
| Global limits | `limits.max_total_memory_mb` (0 = unlimited) guard on start |
| Disk | Per-server soft quota with alerts and optional write blocking |
| mcm-in-Docker | Host path translation for bind mounts |

## Non-goals

- `systemd-run --user` scopes (dropped: unreliable delegation and OOM reporting; delegated cgroups only).
- Kubernetes; Podman-specific APIs (Podman's Docker socket untested).
- Windows containers; Docker Desktop on macOS as a supported target.
- Hard disk quotas, network bandwidth limits, GPU passthrough.
- User-built images (admins may set an image override).

## Runtime comparison

| | native (P1) | shim (P10) | docker (P10) |
|---|---|---|---|
| Survives mcm restart | no | **yes** | **yes** |
| Runs as | mcm OS user | mcm OS user | container (uid mapped) |
| Isolation boundary | none (single-trust) | none (single-trust) | yes |
| Limits | delegated cgroup | delegated cgroup | Docker |
| Grants to `user`s ([security.md](../../architecture/security.md#native-runtime-is-single-trust)) | safe perms only | safe perms only | all |

## Key decision: managed JRE mounted into a generic base image (Docker)

| Option | Pros | Cons |
|---|---|---|
| **A. mcm-managed JRE (phase 3) bind-mounted read-only at `/opt/java` into `ghcr.io/<org>/mcm-runtime:<mcm-version>`** (debian-slim + ca-certificates + fontconfig) — **chosen** | Same JRE in every runtime; one small image; offline after first pull; tests mount a FakeJre | mcm publishes the runtime image; glibc JREs only |
| B. `eclipse-temurin:<major>-jre` per major | Zero image work | Large pulls per major; JRE drift vs native; FakeJre impossible in CI |

Admin override per server: `dockerImage` (any image with `java` on PATH); the JRE mount is then skipped.

## User stories

| ID | Story |
|---|---|
| US-10.1 | As an admin, I run an untrusted modpack in Docker so a malicious mod cannot read the host. |
| US-10.2 | As an admin, I upgrade mcm without stopping shim- or Docker-based servers; consoles resume. |
| US-10.3 | As an admin, I cap a server at 6 GiB RAM and 2 CPUs so it can't starve the others. |
| US-10.4 | As an admin, I see when a server was OOM-killed and why. |
| US-10.5 | As an admin, I prevent starting more servers than the host can hold. |
| US-10.6 | As an admin, I get notified when a server exceeds its disk quota. |
| US-10.7 | As an operator running mcm itself in Docker, Docker servers work with the right host paths. |
| US-10.8 | As an admin, I give a friend full control of their own Docker-runtime server without giving them the host. |

## Dependencies

| Phase | Needed for |
|---|---|
| [01-lifecycle-console](../01-lifecycle-console/README.md) | Supervisor, `ProcessSpawner` (with `adopt()`), spawner thread, stop sequence, console epoch/seq |
| [02-settings-files](../02-settings-files/README.md) | `PATCH /servers/{id}`, memory endpoints |
| [03-java-installers](../03-java-installers/README.md) | Managed JREs to mount |
| [05-monitoring](../05-monitoring/README.md) | Metrics pipeline (stats source), disk usage sampling |
| [07-network-exposure](../07-network-exposure/README.md) | Router-only exposure → loopback publishing |
| [08-users-audit-notifications](../08-users-audit-notifications/README.md) | Grant conflict rule on runtime change; `disk.quota_exceeded`, `server.oom_killed`, `runtime.unavailable` notifications |

## Documents

[requirements](requirements.md) · [shim-protocol](shim-protocol.md) · [api](api.md) · [ui](ui.md) · [tests](tests.md)

## Exit checklist

- [ ] All `P10-FR-*` implemented and mapped to passing tests.
- [ ] Spawner conformance suite passes for `NativeSpawner`, `ShimSpawner`, `DockerSpawner`.
- [ ] Shim: server keeps running and console resumes (with replay, epoch reset) after mcm is killed with SIGKILL and restarted.
- [ ] Docker suite (`MCM_TEST_DOCKER=1`) green in the **`docker-integration` merge-queue job** ([ci.md](../../testing/ci.md#merge-queue)): lifecycle, console, re-adopt, OOM, limits, hardening via `docker inspect`.
- [ ] Delegated cgroup suite green on a runner with `Delegate=yes` (`MCM_TEST_CGROUPS=1`); `none` mode degradation tested everywhere.
- [ ] Switching native → shim → docker → native preserves files; switching to native/shim with conflicting user grants returns 409.
- [ ] mcm-in-Docker compose example (`docker/compose.yml`) documented and smoke-tested.
- [ ] Container config reviewed against [security.md](../../architecture/security.md#process-isolation-stance).
- [ ] Coverage gates met; `mcm-process::docker` and `mcm-shim` ≥ 85 %.
