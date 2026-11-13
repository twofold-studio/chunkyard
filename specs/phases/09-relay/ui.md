# Phase 9 — UI

New feature `features/relays`; extends `features/network` and `features/portmap` from [P7](../07-network-exposure/ui.md). Conventions per [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions).

## Routes

| Route | Composition |
|---|---|
| `/admin/relays` | `RelayTable`, `AddRelayDialog`, `RelayDetailSheet`, `RelaysEmptyState` |
| `/servers/[id]/network` (extended) | `RouteDialog` gains relay binding; `ExposureCard` shows relay entries |
| `/admin/network` (extended) | `PortMappingTable` gains "Probe via relay"; `PortmapCard` CGNAT alert links to `/admin/relays` |

## Admin › Relays

| Component | Behaviour |
|---|---|
| `RelayTable` | Name, endpoint, status badge (connected / connecting / error with reason), agent name, assignment (hostnames, ports), streams, traffic. Live from `network` topic. Actions: Enable/disable, Re-pair, Delete (ConfirmDialog lists bound routes). |
| `AddRelayDialog` | Name + pairing string textarea (masked after paste, "show" toggle); parsed client-side (`features/relays/pairing.ts`) to preview endpoint and fingerprint (first 16 hex chars grouped) before submit; server `relay.pairing_invalid` details inline. Help panel: 4-step VPS guide (`mcm-relay init`, `agent add`, DNS wildcard record, firewall ports 7835/25565/dedicated range) with copy buttons. |
| `RelayDetailSheet` | Connection log (last 20 status changes from WS), public addresses, announced routes with accepted/rejected reason, counters. |
| `RelaysEmptyState` | "No relay configured" + short explanation of when a relay is needed, "Add relay" button, and a link to the **Behind CGNAT / alternatives** docs page (frp, playit.gg, WireGuard, Tailscale Funnel caveats). |

## Server Network tab additions

| Component | Behaviour |
|---|---|
| `RouteDialog` | "Serve via" checkboxes: Router (disabled with hint when `[router] listen` empty) and Relay (admin only; relay select + Hostname / Port radio, port options from the relay's assignment). Router-only exposure without a local router is allowed when Relay is checked. PROXY toggle behaviour unchanged from P7 (forces router-only). |
| `RouteTable` | "Via" column (Router / relay name / both) and relay state badge (`pending` / `accepted` / `rejected` + reason tooltip). |
| `ExposureCard` | Relay entries (`alice.play.example.com` or `relay.example.com:25570`) with health; real-IP indicator follows the route's PROXY setting (P7 `RealIpBanner` reused). |

## Admin › Network additions

| Component | Behaviour |
|---|---|
| `PortMappingTable` | "Probe via relay" action, enabled only when a relay is connected; result toast (ok + latency, or error). Rate-limit error shows remaining wait. |

## States

Loading / empty / error states for every list; relay status changes animate the badge only (no layout shift); mutation buttons show pending state.
