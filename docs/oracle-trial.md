# Oracle trial through Gitadel and Dokploy

The trial uses the existing Oracle ARM64 VM running Dokploy. Source and deployment remain linked through the private Gitadel repository `fractal-tess/chunkyard`; no direct SSH deployment is needed. The manager is intended for one owner, with normal email/password authentication enabled.

## Deployment configuration

Use the repository's root Dockerfile, context `/`, and container HTTP port 8420. Build natively on Oracle so the manager image and its bundled frontend match ARM64. Keep one manager replica and stop-first updates: two managers cannot own the same data directory.

Set the following runtime environment in Dokploy:

```dotenv
CHUNKYARD_HTTP__PUBLIC_URL=https://chunkyard.fractal-tess.xyz
CHUNKYARD_DOCKER__HOST_DATA_DIR=/var/lib/docker/volumes/chunkyard-data/_data
```

The image already binds `0.0.0.0:8420`, stores data at `/data`, and serves its bundled UI. Configure the following mounts before the first deployment:

| Type | Source | Container path |
|---|---|---|
| Named volume | `chunkyard-data` | `/data` |
| Bind | `/var/run/docker.sock` | `/var/run/docker.sock` |

The host-visible volume path above assumes the verified `/var/lib/docker` engine data root and local volume driver. Check the named volume's actual mountpoint before starting a server. This explicit path translation is required because server containers are siblings of the manager, not nested containers.

The first-install trial keeps the default game-port bind, `127.0.0.1`. To allow players on the mesh later, set `CHUNKYARD_DOCKER__PUBLISH_IP=100.91.0.4` in Dokploy and redeploy before creating game containers; permitted peers can then connect to `oracle.netbird.cloud:<game-port>`. Public internet game access is not configured. The web UI uses Dokploy's HTTPS proxy. Keep the Docker socket private; do not publish Docker TCP management or Minecraft RCON ports.

The first-install trial leaves optional CPU and memory tuning unset. If you later want a 1 GiB/one-CPU manager limit, configure it in Dokploy. The Dokploy API expects `memoryLimit: "1073741824"` (bytes) and `cpuLimit: "1000000000"` (nanocpus). Set `updateConfigSwarm.Order` to `stop-first`; Dokploy defaults to `start-first`, which would overlap two managers on the same data directory. These limits do not cover sibling Minecraft containers: each server has its own heap, memory overhead, CPU and PID limits.

## First run

Open `https://chunkyard.fractal-tess.xyz`. In the manager's Dokploy terminal, run `cat /data/setup-token`. Verify that token in step one, then create the owner email/password account in step two. The token is removed after successful setup. Do not put it in Git, the deployment environment, or public logs.

Start with one small server, then a second after checking memory and CPU headroom. A 2 GiB Java heap also needs at least 512 MiB of container overhead. Leave capacity for the OS, Dokploy and existing applications. An Oracle deployment is not a guarantee that every modpack fits its resources or supports ARM64.

Choose Vanilla or Paper and a Minecraft version in the creation form. Chunkyard downloads and verifies the server files and selects a matching Java image; you do not need to supply a JAR. Accept the Minecraft EULA yourself before starting. Custom JARs remain an optional advanced workflow. See [the installation workflow](docker.md#managed-vanilla-and-paper-installation-rest-api). Use the existing console and [resource monitoring](monitoring.md) to inspect the trial; container running is not a Minecraft readiness check.

## Check persistence and operation

1. Complete owner setup and verify sign-in over HTTPS.
2. Create a server and check its data appears in the named volume.
3. Wait for installation, accept the EULA, and start it. Read startup logs and check resources.
4. Connect from a NetBird peer to `oracle.netbird.cloud:<game-port>`.
5. Restart the manager through Dokploy. The game container should remain running and be recognized by the new manager through its persistent instance ID.
6. Stop the server through the UI and confirm Minecraft saves and exits.

The normal Rust suite uses local fixtures. The opt-in Docker suite additionally verifies real resource measurements and restart adoption, but its fixtures are not full Minecraft servers. Record full-game and modpack outcomes separately.
