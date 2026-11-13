# Phase 10 — UI

Feature dir: `features/nodes` (new); `features/servers` extended. Conventions: [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions).

## Screens

| Route | Who | Content |
|---|---|---|
| `/admin/nodes` | admin | Table: name, status badge (online / offline / incompatible / unbound), version (+ "update needed" when proto = P-1), servers count, memory free/total bar, last seen. Row for implicit **Local** node. "Add node" button. |
| Add node dialog | admin | Step 1: instructions with copyable commands (`mcm agent init --advertise-host <host>` then `mcm agent`); Step 2: paste pairing string → client-side parse shows host and fingerprint (first 16 hex groups) for visual confirmation → name → "Connect". Errors mapped by code (unreachable, mismatch, skew, bound elsewhere). |
| `/admin/nodes/[id]` | admin | Facts (OS/arch/CPU/RAM/disk), capabilities (phase 9 cards reused), clock skew warning, fingerprint, last error; servers on node; **Orphans** list with Adopt / Delete; Re-pair, Rename, Remove (blocked when not empty unless force with typed confirmation). |
| `/servers/new` (extended) | `server.create` | Node select (default Local) showing free memory per node; offline nodes disabled |
| `/servers/[id]` (all pages) | view | Node chip in header (`on <node>`), offline banner "Node X is offline — showing last known state; actions unavailable" with all action buttons disabled |
| `/servers/[id]/settings/general` | admin | "Move to another node" → `MigrateDialog`: target select, keep source checkbox, start after checkbox, size estimate, warning about port change; progress via job toast with bytes transferred |
| Dashboard | view | Group-by-node toggle; node status dots |

## Components (new)

| Component | Notes |
|---|---|
| `NodeTable.svelte`, `NodeStatusBadge.svelte` | |
| `AddNodeDialog.svelte` | Uses `parsePairing()` from `features/nodes/pairing.ts` (pure, unit-tested) |
| `NodeFacts.svelte` | |
| `OrphanList.svelte` | |
| `NodeSelect.svelte` | Props `{nodes, value, requiredMemoryMb}` disables nodes lacking memory/offline |
| `MigrateDialog.svelte` | |
| `NodeOfflineBanner.svelte` | Driven by `ServerDto.node.status`, updated via `servers` WS topic |

## State

`features/nodes/nodes.svelte.ts` — `$state` list from `/nodes/summary`, updated by status events (`NodeOnline/Offline` republished on the `servers` topic as `{type:"node", node}`).
