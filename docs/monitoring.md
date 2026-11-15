# Lightweight monitoring

`GET /api/v1/servers/{id}/metrics` provides an on-demand Docker snapshot under the normal authentication rules. `GET /api/v1/servers/{id}/metrics/stream?intervalMs=100` upgrades to a same-origin authenticated WebSocket. Sampling intervals range from 100 ms to 60 seconds. Each watched server has one shared Docker one-shot sampler, irrespective of viewer count. The fastest active viewer determines its cadence, and it slows when that viewer disconnects. Disconnected viewers release it; there is no collector running when nobody is watching and no time-series database or Grafana dependency.

Docker's native statistics stream usually updates about once a second. Chunkyard uses `stream=false&one-shot=true` to obtain fresh readings at the selected cadence, including genuine sub-second sampling. CPU usage is calculated from successive readings; the first reading has no CPU percentage. Requests are sequential and use the verified immutable container ID: slow responses reduce the actual rate instead of creating overlapping requests or catch-up bursts. Duplicate source timestamps are suppressed; values are never interpolated or relabeled as newer samples. The browser keeps bounded history while the view is open. Hidden pages and Off stop live subscriptions, and REST fallback must not poll faster than once per second. The browser default remains five seconds; use fast sampling when needed and measure its overhead on your host.

The saved interval is a preference, not a permanent request for fast collection. Sub-second detail-chart sampling also needs the **High frequency** switch, which starts off on each visit and server switch. Choosing a sub-second rate during the visit enables it; a previously saved rate does not. With the switch off, an attended chart is capped at one second. Leaving the chart, scrolling it off-screen, or unfocusing the window puts the shared chart/header sampler in five-second standby (slower preferences remain slower). Returning resumes the enabled rate for that visit. Hidden browser tabs release their transports entirely. Server cards collect at five seconds or slower only while on screen. Off always stays off. The UI displays the effective cadence separately from the selected interval; browsers without viewport detection keep the detail chart in standby.

Frames are `{type:"sample",sample:ServerMetrics}`, `{type:"error",code,detail}`, or `{type:"end"}`. Only the latest pending sample is retained for a slow viewer. The manager limits live metrics to 16 watched servers and 32 sockets; writes time out after five seconds, and credentials are rechecked every five seconds. Use matching Origin for WebSocket upgrades even when normal browser authentication is disabled.

The response includes `serverId`, `status`, `sampledAt`, `startedAt`, `uptimeSeconds`, `cpuPercent`, `memoryUsageBytes`, `memoryWorkingSetBytes`, `memoryLimitBytes`, `networkRxBytes`, `networkTxBytes`, `blockReadBytes`, `blockWriteBytes`, and `pids`.

- CPU is a percentage of one logical core; 200% means about two fully used cores. Missing or reset delta counters produce `null`.
- Memory usage and the hard container limit are bytes. Working-set memory subtracts inactive file cache when those counters are available; it is not the JVM heap.
- Network and block-I/O values are cumulative byte counters for the container, not rates or filesystem size. Unsupported counters are `null`.
- Uptime measures time since the container started, not time since Minecraft became ready.
- Stopped and paused containers return their actual status with resource measurements set to `null`. A missing Docker engine fails clearly instead of reporting zero usage.

Running-container REST sampling waits for Docker's CPU delta sample, usually about a second, with a five-second timeout. Up to four snapshots may run concurrently; excess requests return 429 `metrics.busy`. Both transports verify container ownership and address the immutable container ID. No Minecraft TPS, player counts, readiness checks or persistent historical metrics are included.

For endpoint schemas and authentication details, open **API reference** in the app or fetch `/api/v1/openapi.json`. The schema is served locally; the page needs no CDN or third-party scripts.

## Implementation references

CPU deltas and cgroup counters follow the [Docker Engine stats API](https://docs.docker.com/reference/api/engine/version/v1.44/#tag/Container/operation/ContainerStats). Snapshot tests cover counter resets, missing fields, cgroup v1/v2 cache accounting, and overflow. The opt-in live Docker suite checks real CPU/memory/PID samples and rejects foreign container ownership.
