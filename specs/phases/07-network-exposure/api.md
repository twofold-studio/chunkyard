# Phase 7 — API, WebSocket, migrations

Conventions: [api-conventions.md](../../architecture/api-conventions.md). Paths under `/api/v1`. Handlers in `mcm-api/src/routes/{routes,network}.rs`; DTOs in `mcm-api::dto::network`.

## DTOs

```ts
Route = { id, serverId, hostname, enabled, sendProxyProtocol, wakeOnJoin, exposure: "router_only"|"direct_and_router",
          backendConfig: "ok"|"pending"|"unsupported"|"mismatch"|"not_applicable", backendReachable: boolean|null,
          stats: { active, total, bytesIn, bytesOut, lastConnectionAt: string|null },
          warnings: Warning[] }               // e.g. real_ip_hidden, proxy.backend_unsupported; P9 adds relay fields
Warning = { code: string; field?: string; message: string }   // same shape as server-api.md
RouterStatus = { enabled, listen: string|null, listening: boolean, error: string|null, active, maxConnections,
                 rejected: { rate, limit, badHandshake, backendUnreachable } }
RouterSettings = { defaultServerId: string|null, unknownHostMotd, offlineMotd, acceptProxyProtocol }
PortmapStatus = { enabled, method: "upnp"|"natpmp"|"none", gateway: string|null, localIp: string|null,
                  externalIp: string|null, classification: "public"|"cgnat"|"double_nat"|"unknown"|"invalid",
                  lastDiscoveryAt: string|null }
PortMapping = { id, target: { kind: "router" } | { kind: "server", serverId }, externalPort, internalPort, protocol: "tcp",
                method, permanent, leaseExpiresAt: string|null, state: "active"|"failed"|"pending", lastError: string|null }
ExposureEntry = { kind: "lan"|"router"|"upnp" /* additive: "relay" in P9 */, address: string,
                  health: "ok"|"warning"|"error", reason: string|null, realIpVisible: boolean }
```

## Routes (per server)

| Method | Path | Request | Response | Perm | Audit |
|---|---|---|---|---|---|
| GET | `/servers/{id}/routes` | — | `{ items: Route[] }` | `server.view` | — |
| POST | `/servers/{id}/routes` | `{ hostname, enabled?, sendProxyProtocol?, wakeOnJoin?, exposure? }` | `201 { route: Route, warnings: Warning[] }` | `proxy.manage` | `proxy.route.create` |
| PATCH | `/routes/{routeId}` | partial of the POST body | `{ route, warnings }` | `proxy.manage` | `proxy.route.update` |
| DELETE | `/routes/{routeId}` | — | `204` | `proxy.manage` | `proxy.route.delete` |
| GET | `/servers/{id}/exposure` | — | `{ items: ExposureEntry[] }` | `server.view` | — |

Validation (P7-FR-03, P7-FR-18): hostname per `testdata/validation/hostname.json`; uniqueness case-insensitive; PROXY ⇒ all routes of the server `router_only`.

## Router (admin)

| Method | Path | Request | Response | Audit |
|---|---|---|---|---|
| GET | `/network/router` | — | `{ status: RouterStatus, settings: RouterSettings }` | — |
| PATCH | `/network/router/settings` | partial `RouterSettings` | `RouterSettings` | `proxy.settings.update` |

`[router]` config (listen, limits, trusted CIDRs) is static and shown read-only.

## Port mapping (admin)

| Method | Path | Request | Response | Audit |
|---|---|---|---|---|
| GET | `/network/portmap` | — | `{ status: PortmapStatus, mappings: PortMapping[] }` | — |
| POST | `/network/portmap/discover` | — | `PortmapStatus` (blocks ≤ 10 s) | — |
| POST | `/network/portmap/mappings` | `{ target, externalPort? (default = internal) }` | `201 PortMapping` | `portmap.create` |
| DELETE | `/network/portmap/mappings/{id}` | — | `204` | `portmap.delete` |

## WebSocket

Topic `network` (registered in [api-conventions.md](../../architecture/api-conventions.md#topics-cumulative)):

| `data` | Who receives |
|---|---|
| `{ type: "router", status: RouterStatus }` | admin |
| `{ type: "routes", stats: { routeId, active, total, bytesIn, bytesOut }[] }` every 5 s | routes of servers the user can `server.view` |
| `{ type: "portmap", mapping: PortMapping }` | admin |

`server:<id>` additionally carries `{ type: "exposure", items: ExposureEntry[] }` on change (additive payload type).

## Events

`RouterStatusChanged`, `RouteHealthChanged { route_id, reachable }`, `PortMappingChanged`, `PortMappingFailed { code }` — available to P8 notifications.

## Core traits introduced

| Trait (`mcm-core`) | Impl | Used by |
|---|---|---|
| `ServerNetworkInfo { backend_expects_proxy(ServerId) -> bool; real_ip_visible(ServerId) -> bool }` | `mcm-router` | `mcm-process` (ready SLP fallback), `mcm-metrics` (SLP fallback, players banner), `mcm-api` |
| `RouteRepo`, `PortMappingRepo` | `mcm-db` | `mcm-router`, `mcm-portmap` |
| `ServerFileAccess` (sandboxed read/write of a server-relative file) | `mcm-fs` | `mcm-router` (`paper-global.yml`) |

## Config and settings

Static config `[router]`: `listen`, `max_connections`, `max_connections_per_ip`, `connection_rate_per_ip`, `handshake_timeout_s`, `idle_timeout_s`, `trusted_proxy_cidrs`.
Static config `[portmap]`: `enabled`, `local_ip`, `lease_s`.
Runtime settings (`settings` table, admin): `router.default_server_id`, `router.unknown_host_motd`, `router.offline_motd`, `router.accept_proxy_protocol`.

## Error codes

| Code | Status | When |
|---|---|---|
| `proxy.hostname_invalid` | 422 | Not a valid hostname / wildcard |
| `proxy.hostname_taken` | 409 | Hostname used by another route |
| `proxy.proxy_protocol_requires_router_only` | 422 | PROXY enabled on a server that has (or would get) a `direct_and_router` route |
| `proxy.router_disabled` | 409 | `router_only` route created while `[router] listen` is empty (P9 also accepts a relay binding instead) |
| `portmap.disabled` | 409 | `[portmap] enabled = false` |
| `portmap.no_gateway` | 424 | Discovery found nothing |
| `portmap.conflict` | 409 | External port already mapped |
| `portmap.router_only_server` | 409 | Direct mapping of a router-only server |
| `portmap.gateway_error` | 502 | Gateway SOAP/NAT-PMP error (sanitised) |

Warning codes (not errors): `real_ip_hidden`, `proxy.backend_unsupported`, `proxy.backend_pending`, `restart_required`.

## Migrations

Numbers assigned at merge ([patterns.md §3](../../architecture/patterns.md#3-repository-pattern)).

`crates/mcm-db/migrations/<NNNN>_p7_proxy_routes.sql`:

```sql
CREATE TABLE proxy_routes (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  enabled INTEGER NOT NULL DEFAULT 1,
  send_proxy_protocol INTEGER NOT NULL DEFAULT 0,
  wake_on_join INTEGER NOT NULL DEFAULT 0,
  exposure TEXT NOT NULL DEFAULT 'router_only' CHECK (exposure IN ('router_only','direct_and_router')),
  previous_server_ip TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX proxy_routes_server ON proxy_routes(server_id);
CREATE TABLE proxy_route_stats (
  route_id TEXT PRIMARY KEY REFERENCES proxy_routes(id) ON DELETE CASCADE,
  total INTEGER NOT NULL DEFAULT 0, bytes_in INTEGER NOT NULL DEFAULT 0, bytes_out INTEGER NOT NULL DEFAULT 0,
  last_connection_at INTEGER
);                                      -- flushed from memory every 60 s
```

`crates/mcm-db/migrations/<NNNN>_p7_port_mappings.sql`:

```sql
CREATE TABLE port_mappings (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('router','server')),
  server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
  external_port INTEGER NOT NULL, internal_port INTEGER NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'tcp' CHECK (protocol = 'tcp'),
  method TEXT, permanent INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
  lease_expires_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL,
  UNIQUE (external_port, protocol)
);
```

P9 adds `relay_connections` and `proxy_routes.relay_id` / `relay_target` ([09-relay/api.md](../09-relay/api.md#migration)).
