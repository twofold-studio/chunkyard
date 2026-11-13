# Phase 5 — UI

Feature directory `web/src/lib/features/metrics/` (+ `players/` components inside it). Conventions: [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions). Charts: LayerChart.

```
features/metrics/
├── components/ StatCard.svelte, CpuCard.svelte, MemoryCard.svelte, DiskCard.svelte, PlayersCard.svelte,
│               TpsGauge.svelte, UptimeCard.svelte, AvailabilityStrip.svelte, MetricChart.svelte,
│               RangeSelector.svelte, PlayersPanel.svelte, PlayerAvatar.svelte, SessionsTable.svelte,
│               HostWidget.svelte, RconStatusBadge.svelte
├── api.ts                 snapshot, history, availability, players, sessions, top, host
├── live.svelte.ts         LiveMetrics class: subscribes metrics:<id>, keeps last N samples (sparklines)
├── history.svelte.ts      HistoryState: range, resolution label, points, merges live samples at the tail
└── format.ts              bytes, %, duration, tps colour thresholds
```

## Server overview (`/servers/[id]`, extends phase 1)

Card row (responsive grid):

| Card | Content |
|---|---|
| CPU | Current %, "of N cores", sparkline last 10 min |
| Memory | RSS (GB) with `-Xmx` shown as "limit (heap)" reference; sparkline |
| Disk | Size of server dir, "measured 3 min ago", `≈` when approx |
| Players | `online / max`, avatars/initials of first 8, link to Players |
| TPS | `TpsGauge` (radial 0–20; green ≥ 19.5, amber ≥ 15, red below) + MSPT; "Not available for vanilla < 1.20.3" tooltip when unsupported |
| Uptime | Running duration, availability 30 d % |

`RconStatusBadge` shows a warning if RCON is `auth_failed`/`unavailable` with a fix hint (restart to re-apply managed properties). When `rconExposure = "public"` a persistent amber `Alert` reads "RCON is reachable on all interfaces" with firewall guidance and a **Disable RCON** button (PATCH `rconDisabled: true`, confirm dialog explaining TPS becomes unavailable; shows the `restart_required` warning). A small badge shows the players source (`management`/`rcon`/`slp`/`query`).

## Metrics page (`/servers/[id]/metrics`)

| Element | Behaviour |
|---|---|
| `RangeSelector` | 1h · 6h · 24h · 7d · 30d · custom (date range picker); stored in URL query (`?range=24h`) |
| Charts | `MetricChart` stacked vertically sharing x-axis & crosshair: CPU %, Memory (RSS + -Xmx line), Players, TPS (with 20 reference) + MSPT (secondary axis; 50 ms reference), Disk |
| Live tail | For ranges ≤ 24 h, live WS samples appended to the chart at matching resolution (10 s range only appends; coarser ranges refresh every minute) |
| Gaps | Null points break lines; stopped periods shaded grey from state history |
| Availability | `AvailabilityStrip`: 30 daily cells coloured by availability %, tooltip with crashes count |
| Resolution label | "10-second / 1-minute / 1-hour averages" |
| Empty | "No data yet — metrics are collected while the server is running" |

## Players (`/servers/[id]/metrics` › Players tab)

| Element | Behaviour |
|---|---|
| `PlayersPanel` | Online list: avatar, name, session duration (live ticking), source badge (`partial` when from SLP sample) |
| `SessionsTable` | Paged history: name, joined, left, duration; filter by name |
| Top players | Range-aware bar list by playtime |
| Actions | If user has `players.manage` (phase 2): kick/ban/op shortcuts via existing endpoints |

### Player avatars

- Setting `ui.player_avatars` (admin, runtime settings): `off` (default) | `mc-heads` | `crafatar`.
- `off` renders initials on a colour derived from the UUID/name hash.
- When enabled, the browser fetches `https://mc-heads.net/avatar/<uuid|name>/32` or `https://crafatar.com/avatars/<uuid>?size=32&overlay`; the settings UI states that this sends player names/UUIDs and viewer IP to a third party. CSP `img-src https:` already permits it.

## Dashboard (`/`)

- `HostWidget` at top: CPU %, memory %, disk % bars, load average; absolute values for admins.
- Server cards (phase 1) gain mini CPU/RAM/players line from `/servers/metrics/summary` then live via `servers` + `metrics:<id>` subscriptions for visible cards only (IntersectionObserver unsubscribes off-screen).

## States and performance

- Snapshots load with skeletons; WS disconnect shows "Live updates paused" chip.
- Charts render ≤ 2000 points; history fetch cancelled on range change (AbortController).
- Numbers use tabular figures; colours meet contrast; TPS gauge has a text value (not colour-only).
