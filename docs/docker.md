# Docker server runtime

The backend can now create server records and control one Docker container per server: start, stop, restart, force kill, recent logs, and console commands. The frontend now exposes these operations; see [frontend usage](frontend.md). A Linux Docker engine is required; native and shim runtimes are not implemented yet.

Start the manager on the host normally. Its Docker client honors `DOCKER_HOST` and Docker TLS environment settings. Local socket/named-pipe connections use the platform default. Set `CHUNKYARD_DOCKER__ENABLED=false` to disable Docker operations; the rest of the manager still works. `GET /api/v1/system/isolation` reports Docker availability.

Create a server with `POST /api/v1/servers`:

```json
{
  "name": "Survival",
  "runtime": "docker",
  "port": 25565,
  "dockerImage": "eclipse-temurin:21-jre",
  "memoryMinMb": 512,
  "memoryMaxMb": 2048,
  "cpus": 2,
  "jar": "server.jar",
  "acceptEula": true
}
```

Set `acceptEula` to true only if you accept the Minecraft EULA. Creation returns 201 `{server}` with an ID, managed directory, configuration, and stopped status. For a manual server, copy your server JAR into the returned directory before starting. The REST API can also create and install a selected Vanilla or Paper release, as described below. The web creation form now offers Vanilla/Paper version selection and runs the install automatically; no JAR needs to be supplied for these managed types. File uploads are not available yet. The service writes initial `eula.txt` and `server.properties` files.

| Method | Endpoint | Response |
|---|---|---|
| POST | `/api/v1/servers` | 201 `{server}` and Location header |
| GET | `/api/v1/servers` | `{items: ServerView[]}`; up to 100 server records |
| GET | `/api/v1/servers/{id}` | `ServerView` including current container status |
| POST | `/api/v1/servers/{id}/eula` | 200 `{server}`; body `{accepted: true}`; stopped servers only |
| POST | `/api/v1/servers/{id}/start` | 202 `{job}` |
| POST | `/api/v1/servers/{id}/stop` | 202 `{job}` |
| POST | `/api/v1/servers/{id}/restart` | 202 `{job}` |
| POST | `/api/v1/servers/{id}/kill` | 202 `{job}` |
| GET | `/api/v1/servers/{id}/console?tail=200` | `{items: [{stream, text}]}` |
| POST | `/api/v1/servers/{id}/console/commands` | 204; body `{line: "say Hello"}` |
| GET | `/api/v1/system/isolation` | `{docker: {available, version, reason}}` |

These routes share the existing owner-session or explicitly disabled-auth mode. Mutations require the same origin and `X-MCM-CSRF: 1`. Poll `/api/v1/jobs/{id}` for actions; their `serverId` identifies the target and successful results contain `{server}`. Only one lifecycle operation per server may run at a time. Commands cannot contain CR, LF or NUL. Logs are a bounded snapshot, not a live WebSocket stream; tail is 1–1000 lines and output is capped at 4 MiB.

The default manual image supplies Java 21. Managed Vanilla installs use the Java major in Mojang metadata; Paper uses its published recommended Java table. Unless you explicitly pass `dockerImage`, installation chooses `eclipse-temurin:<major>-jre` and stores that choice with the server. An explicit image remains your compatibility responsibility. Docker uses the image JVM, not a host-managed JRE. Forge, Fabric and modpack installers are deferred.

### Managed Vanilla and Paper installation (REST API)

1. Read `GET /api/v1/software` and `/api/v1/software/vanilla/versions` or `/api/v1/software/paper/versions` for releases, newest first. Snapshots and prereleases are excluded. For Paper, read `/api/v1/software/paper/versions/{version}/builds` for stable builds, newest first.
2. Create the stopped server with `POST /api/v1/servers` and an additional `software` field:

   ```json
   {"name":"Survival","port":25565,"software":{"type":"paper","version":"1.21.4","build":"232"}}
   ```

   Vanilla uses `{"type":"vanilla","version":"1.21.4"}`. Omit Paper's `build` to resolve the latest stable build at install time. Omit `software` for the existing manual workflow. These example versions are fixed examples, not the latest release.
3. Submit `POST /api/v1/servers/{id}/install` without a body and poll the returned job. Success returns `result: {server}`. The actual version, Paper build, JVM major, checksum and relative JAR path are persisted in `server.launch`. `server.jar` points to that installed artifact. Subsequent starts use that exact artifact without checking for updates.
4. Accept the EULA explicitly if you agree to it, then start the server. Installation never accepts the EULA or starts Minecraft. `software != null && launch == null` means installation has not succeeded; Start fails with `server.not_installed`.

Installation uses official Mojang/Paper metadata and exact HTTPS host allowlists with public-IP DNS resolution, revalidates redirects, caps metadata at 4 MiB and each JAR at 512 MiB, and checks the published size and SHA-1 (Vanilla) or SHA-256 (Paper). The JAR is written into a private staging directory before its completed path is saved. Failed downloads remove partial files. Retry on the **same server ID**; do not create another server. The per-server operation lock prevents concurrent install/start/EULA/lifecycle mutations. Successful installs cannot be overwritten by calling install again. Software must be installed before any game container has been created, since an existing container retains its original image and command. Interrupted persistence can leave an unused `.chunkyard-software-*` directory; it is never selected for launch without a saved installation record.

The normal test suite uses provider/runtime fixtures. `cargo test -p mcm-install --test live -- --ignored` checks live catalog responses and downloads real Vanilla/Paper JARs into temporary storage without accepting the EULA or starting a game server. Availability of old releases, upstream download hosts and Temurin images can vary; errors are returned through the job instead of substituting another version. Game readiness and real multiplayer compatibility are separate checks.

Containers mount only their own managed server directory at `/data`, use an argv array with a `java` entrypoint, and publish container port 25565/TCP to the server's chosen host port. `CHUNKYARD_DOCKER__PUBLISH_IP` defaults to `127.0.0.1`; choose a reachable host interface when players should connect directly. RCON and Docker management ports are not published. Memory min/max control the Java heap. The container's hard memory/swap limit is max heap plus the larger of 256 MiB or 25% overhead; CPUs and process count are also limited. The root filesystem is read-only, capabilities are dropped, no-new-privileges is enabled, `/tmp` is a bounded tmpfs, and logs rotate at 10 MiB × 3 files.

Public images are pulled when absent. Private registry credentials are not wired into pulls yet; pull private images with Docker beforehand. A new container uses the resolved local image ID; later starts reuse it. Use a digest reference when you need reproducibility across new servers. Automatic image updates are not implemented.

By default, rootful Docker uses the manager's UID:GID, while rootless Docker uses container UID 0 mapped to the daemon user. Override with `CHUNKYARD_DOCKER__USER=UID:GID` when needed. Userns-remap requires an explicit mapping. Rootless engines must be operated by the same host user as the manager; remapped ownership requires operator setup.

Stop sends the Minecraft `stop` command, waits up to `CHUNKYARD_DOCKER__STOP_TIMEOUT_S` (default 60), then asks Docker to terminate with a ten-second grace period. Kill forces termination. Containers and data remain after exit so status/logs are available and the same container can restart. A running container means the process is running; Minecraft protocol readiness is not yet checked.

Manager shutdown leaves Docker servers running. A stable `instance-id` file plus instance/server ownership labels lets a restarted manager inspect and control the same containers. Losing this file prevents automatic recognition of old containers. Foreign or mismatched containers are never controlled. A missing daemon yields unknown server status and runtime operations fail clearly. There is no automatic crash restart, autostart, resource editor, or orphan cleanup yet.

### Ports and stopped-instance deletion

Omit `port` (or use null) when creating an instance to allocate the first unassigned managed port from 25565. Allocation is serialized across concurrent create requests. You can explicitly configure the same port on multiple instances: only one may run at a time. Start and restart jobs return `server.port_in_use` if another instance sharing the port is running or paused. Starts on the same port are serialized through the Docker start call; other ports can start independently. Stop the running instance before switching to another. Automatic selection tracks manager assignments; an unrelated host service may still occupy a port, which Docker reports when starting. Existing records are preserved by the shared-port database migration.

`DELETE /api/v1/servers/{id}` queues a `server.delete` job for a stopped instance. It removes only an owned container, using its verified immutable Docker ID with force removal disabled, then the record. Running/paused instances and active install/lifecycle operations cannot be deleted. A disconnected Docker engine or mismatched container identity leaves the record and files intact. The port becomes available for automatic selection after the final record using it is deleted.

Files remain on the manager host by default. A successful job returns `result.deleted: {id, filesDeleted, retainedDirectory}`; the directory is null if no files remain. Add `?deleteFiles=true` only to explicitly remove that instance's world, configuration, logs and installed software. Root symlinks are rejected; recursive cleanup does not traverse links into other directories. Retained files are not automatically imported into a new instance. Docker and filesystem cleanup cannot be one SQLite transaction: an interrupted or failed deletion may already have removed the container or some requested files while retaining the record. Retry deletion on that same ID to finish cleanup. Deletion uses the same session, Host/origin and CSRF checks as other mutations.

# Run the manager in Docker

Build the image, which includes both the Rust service and the production UI:

```sh
docker build -t mcm-manager:local .
```

For a local Linux Docker engine, mount the manager data directory and socket, and tell the manager the corresponding **host** data path:

```sh
docker run --rm --name mcm-manager \
  -p 127.0.0.1:8420:8420 \
  -v /srv/mcm:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e CHUNKYARD_HTTP__PUBLIC_URL=http://127.0.0.1:8420 \
  -e CHUNKYARD_HTTP__ALLOW_INSECURE_HTTP=true \
  -e CHUNKYARD_DOCKER__HOST_DATA_DIR=/srv/mcm \
  mcm-manager:local
```

Open `http://127.0.0.1:8420` for the UI. Authentication remains enabled by default; the setup token is in `/srv/mcm/setup-token`. The bundled UI is served from `/opt/mcm/web`; `CHUNKYARD_HTTP__UI_DIR=` disables static hosting. Socket access grants control over the engine, so only the owner should reach this service. The image runs as root by default; custom UID/GID deployments need matching data ownership and socket permissions. Host path translation is explicit, not automatically detected or probed. A remote engine requires the host-visible data path and the same data available at both ends.

# Verification

```sh
bash scripts/smoke-docker.sh
bash scripts/smoke-docker.sh --java
```

The first builds a small console fixture and exercises real Docker lifecycle, stdin, logs, persistent files, and manager reconnection. The second builds a test JAR using a Temurin JDK and runs it under a real Temurin 21 JRE with the same hardening/limits. Both clean up their test server containers and retain built images for reuse. These fixtures are not Minecraft; real game/loader compatibility remains to be checked. The normal workspace suite uses a fake runtime and does not need Docker. The Dockerized manager was also checked as a non-root user against a sibling JVM container, including explicit bind-path translation and manager restart; repeat with `python3 scripts/smoke-manager-container.py` after building both images. The live fixture test also runs in a dedicated Linux CI job; Docker Desktop/Windows and rootless deployments have not been exercised locally.
