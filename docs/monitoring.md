# Lightweight monitoring

The server detail page includes a **Resources** panel backed by `GET /api/v1/servers/{id}/metrics` returns an on-demand Docker snapshot under the normal owner-session or explicitly disabled-auth rules. There is no background collector, time-series database or Grafana dependency. Poll sequentially no faster than every five seconds, and stop when the view is hidden.

The response includes `serverId`, `status`, `sampledAt`, `startedAt`, `uptimeSeconds`, `cpuPercent`, `memoryUsageBytes`, `memoryWorkingSetBytes`, `memoryLimitBytes`, `networkRxBytes`, `networkTxBytes`, `blockReadBytes`, `blockWriteBytes`, and `pids`.

- CPU is a percentage of one logical core; 200% means about two fully used cores. Missing or reset delta counters produce `null`.
- Memory usage and the hard container limit are bytes. Working-set memory subtracts inactive file cache when those counters are available; it is not the JVM heap.
- Network and block-I/O values are cumulative byte counters for the container, not rates or filesystem size. Unsupported counters are `null`.
- Uptime measures time since the container started, not time since Minecraft became ready.
- Stopped and paused containers return their actual status with resource measurements set to `null`. A missing Docker engine fails clearly instead of reporting zero usage.

Running-container sampling waits for Docker's CPU delta sample, usually about a second, with a five-second stats timeout. Up to four samples may run concurrently; excess requests return 429 `metrics.busy`. Container identity is verified before sampling, and the stats request uses the verified immutable container ID. No host process metrics, Minecraft TPS, player counts, protocol readiness checks or historical charts are included yet.

For endpoint schemas and authentication details, open **API reference** in the app or fetch `/api/v1/openapi.json`. The schema is served locally; the page needs no CDN or third-party scripts.

## Implementation references

CPU deltas and cgroup counters follow the [Docker Engine stats API](https://docs.docker.com/reference/api/engine/version/v1.44/#tag/Container/operation/ContainerStats). Snapshot tests cover counter resets, missing fields, cgroup v1/v2 cache accounting, and overflow. The opt-in live Docker suite checks real CPU/memory/PID samples and rejects foreign container ownership.
