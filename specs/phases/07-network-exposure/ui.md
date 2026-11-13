# Phase 7 — UI

New features: `features/network` (routes, exposure, router settings) and `features/portmap`. Conventions per [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions).

## Routes

| Route | Composition |
|---|---|
| `/servers/[id]/network` | `RealIpBanner`, `ExposureCard`, `RouteTable`, `RouteDialog` |
| `/admin/network` | `RouterStatusCard`, `RouterSettingsForm`, `PortmapCard`, `PortMappingTable` |

## Server Network tab

| Component | Behaviour |
|---|---|
| `ExposureCard` | "How players connect": one row per `ExposureEntry` with copy button, kind icon (LAN / Router / UPnP; Relay added in P9), health dot and reason tooltip, "real IP visible" indicator. Empty state: "Not exposed outside this machine" with "Add hostname route". Live via `server:<id>` `exposure` messages. |
| `RouteTable` | Hostname, PROXY badge, wake-on-join badge, exposure mode, backend config badge (`pending` / `unsupported` / `mismatch` with explanation), warnings, active connections (live from `network`), total, traffic, last connection. Actions: Edit, Disable, Delete. |
| `RouteDialog` | Hostname input (shared vectors `testdata/validation/hostname.json`); toggles: **Send PROXY protocol** (Paper/Purpur: "mcm will set `proxies.proxy-protocol`, restart required"; Velocity/Bungee: setup instructions; others: blocking-style warning "cannot read PROXY headers without a mod"). Enabling PROXY forces Exposure to "Router only" and disables the "Router and direct" option with the explanation "direct connections would fail" (server error `proxy.proxy_protocol_requires_router_only` shown inline if bypassed). **Wake on join** (warning: anyone on the internet can start the server). **Exposure** radio (Router only — recommended; Router and direct). Shows the DNS record to create: `A survival.example.com → <public ip>` or wildcard hint. Response `warnings` rendered as alerts. |
| `RealIpBanner` | Shown when any enabled route lacks PROXY: "Players connecting through mcm appear as 127.0.0.1 — IP bans and IP-based plugins won't work. Enable PROXY protocol (Paper/Purpur/Velocity) to fix." Links to the route. Also rendered on the P5 players panel (`features/metrics/components/PlayersPanel`) via the shared component. |

## Admin › Network

| Component | Behaviour |
|---|---|
| `RouterStatusCard` | Listening address or "disabled (set `[router] listen`)", bind error, active connections, rejected counters (rate, limit, bad handshake, backend unreachable). |
| `RouterSettingsForm` | Fallback server select, unknown-host and offline MOTD inputs with `McText` preview, accept-PROXY toggle (trusted CIDRs shown read-only from config). |
| `PortmapCard` | Disabled state explains `[portmap] enabled`; otherwise method, gateway, local IP, external IP, classification badge; for `cgnat`/`double_nat` an `Alert` explaining port forwarding can't work and linking to the "Behind CGNAT" docs page (tunnelling options; P9 adds a link to `/admin/relays`). "Rediscover" button. |
| `PortMappingTable` | Target (Router / server name), external→internal port, method, lease countdown or "permanent", state, last error. Actions: Delete (P9 adds "Probe via relay"). "Add mapping" dialog with target select and external port; router-only servers disabled in the select with tooltip. |

## Shared

- `McText` renders `§` colour/format codes to styled spans (escaped text only). Reused from P5 MOTD display if present.
- Counters update from the `network` WS topic; pages subscribe on mount and unsubscribe on destroy.

## States

Every list has loading / empty / error states; mutation buttons show pending state; 422/409 problems render inline on the field named in `errors[]`.
