# Phase 7 — Requirements

Details live in [router.md](router.md) and [upnp.md](upnp.md); this file is the normative FR list. Audit actions come from [audit.md](../../architecture/audit.md). Cross-area behaviour goes through `chunkyard-core` traits ([workspace-layout.md](../../architecture/workspace-layout.md) rule 5): `chunkyard-router` uses `ServerService` (status, start), `ServerLookup` (port, flavour), `PropertiesEditor` (`server-ip`) and `ServerFileAccess` (`config/paper-global.yml`); `chunkyard-router` and `chunkyard-portmap` have no `chunkyard-db`/`chunkyard-process` edges (persistence via `RouteRepo`/`PortMappingRepo` traits in core).

## Router

| ID | Requirement | Crates | Perm | Audit / Event |
|---|---|---|---|---|
| P7-FR-01 | Router listener on `[router] listen` (static config; empty = disabled). Started/stopped with mcm; bind failure logged `error` and surfaced in router status (mcm keeps running). Router actor per [patterns §5](../../architecture/patterns.md#5-actor--handle-pattern-per-server-supervisor). | router, server | — | — / `RouterStatusChanged` |
| P7-FR-02 | Handshake read with `handshake_timeout_s` (5 s), ≤ 1100-byte frame, parse via `mcm_protocol::handshake`; normalisation (`normalize_host`, shared with the P9 relay): cut at first `\0`, strip trailing `.` and `:port`, lowercase. Malformed → close silently, count `bad_handshake`. | protocol, router | — | — |
| P7-FR-03 | Route CRUD per server: `hostname` (exact or `*.` single-label wildcard; RFC 1123 labels), `enabled`, `sendProxyProtocol`, `wakeOnJoin`, `exposure` (`router_only` \| `direct_and_router`). Hostnames globally unique (case-insensitive). Requests are validated together with P7-FR-18. | router, api | `proxy.manage` | `proxy.route.create` / `.update` / `.delete` |
| P7-FR-04 | Route lookup order exact → longest wildcard → fallback (setting `router.default_server_id`, admin) → unknown. Table swapped atomically on change; in-flight connections unaffected. | router | admin (fallback) | `proxy.settings.update` |
| P7-FR-05 | Splice: connect backend `127.0.0.1:<port>` (3 s), optional PROXY v2 header, replay original bytes verbatim, `copy_bidirectional` with 16 KiB buffers, idle timeout `idle_timeout_s` (120 s), proper half-close. | router | — | — |
| P7-FR-06 | Synthetic responses for unknown host / offline / starting / sleeping per [router.md](router.md#synthetic-responses); status echoes the client's protocol number; Ping answered with Pong; MOTD texts are admin settings. | router, protocol | admin (texts) | `proxy.settings.update` |
| P7-FR-07 | Legacy `0xFE` ping: splice to running fallback route, else legacy `0xFF` kick reply. | router, protocol | — | — |
| P7-FR-08 | Wake-on-join: login attempt (next state 2) to a stopped server with `wakeOnJoin` calls `ServerService::start` (limits: 1/server/60 s, 1/IP/5 min; never in crash-loop or maintenance) and disconnects with a "starting" message. | router | — | `server.start` (system actor, `trigger=wake_on_join`, client IP) |
| P7-FR-09 | PROXY v2 encoder/decoder in `mcm_protocol::proxy_v2` per [router.md](router.md#proxy-protocol-v2-encoding), incl. `LOCAL` command, IPv4-mapped normalisation and AUTHORITY TLV. | protocol | — | — |
| P7-FR-10 | Inbound PROXY v2 from `[router] trusted_proxy_cidrs` when setting `router.accept_proxy_protocol`; required from trusted peers, rejected from others; `LOCAL` keeps the socket peer. | router | admin | `proxy.settings.update` |
| P7-FR-11 | Backend config helper: enabling `sendProxyProtocol` on a paper/purpur server sets `proxies.proxy-protocol: true` in `config/paper-global.yml` via `ServerFileAccess` (deferred until the file exists); other flavours get warning `proxy.backend_unsupported` in the response `warnings`. Disabling the last PROXY route reverts the Paper setting. | router, api | `proxy.manage` | `proxy.route.update` (details `backend_config`) |
| P7-FR-12 | Loopback-only exposure: a server with any `router_only` route starts with `server-ip=127.0.0.1` (managed key via `PropertiesEditor`; P2 shows it read-only); previous value restored when no such route remains. | router | `proxy.manage` | — |
| P7-FR-13 | Limits: total, per-IP concurrent, per-IP rate (token bucket); excess closed without response; counters. | router | — | — |
| P7-FR-14 | Per-route metrics: active (gauge), total, bytes in/out, last connection at; router-level rejected counters. REST + WS topic `network` every 5 s. | router, api | `server.view` / admin | — |
| P7-FR-15 | Exposure summary per server: addresses players can use (`lan` `ip:port` unless router-only, `router` `hostname[:port]`, `upnp` `external_ip:port`; P9 adds `relay`) with health `ok`/`warning`/`error` + reason. | router, portmap, api | `server.view` | — |
| P7-FR-16 | Route health: SLP through the backend port every 30 s while Running (reuses the P5 prober if present) → `backendReachable`; sends PROXY `LOCAL` per P7-FR-17. | router, protocol | — | — / `RouteHealthChanged` |
| P7-FR-17 | **PROXY `LOCAL` on mcm's own connections.** Core trait `ServerNetworkInfo::backend_expects_proxy(server_id) -> bool` (impl in `chunkyard-router`: true when an enabled route has `sendProxyProtocol` and backend config is applied). Every chunkyard-originated connection to that backend — route health (P7-FR-16), the P1 ready-detection SLP fallback, the P5 SLP player/MOTD fallback — first writes the 16-byte v2 header `0D0A0D0A000D0A515549540A 20 00 0000` (ver/cmd `0x20` LOCAL, fam `0x00`, len 0). `mcm_protocol::slp::SlpOptions { proxy_v2_local: bool }`. RCON and the management protocol are separate ports and unaffected. | protocol, router, process, metrics | — | — |
| P7-FR-18 | **PROXY requires router-only.** Because the PROXY setting is backend-wide, if any enabled route of a server has `sendProxyProtocol=true`, every route of that server must have `exposure=router_only` (direct clients would send no header and fail). Violations (create/update of either field, or adding a `direct_and_router` route to such a server) → `422 proxy.proxy_protocol_requires_router_only`. UPnP direct mappings of such a server's port are already blocked (`portmap.router_only_server`). | router, api | `proxy.manage` | — (request rejected; failure audited under `proxy.route.*`) |
| P7-FR-19 | **Real-IP warning.** A route with `sendProxyProtocol=false` gets warning `real_ip_hidden` in `Route.warnings` and the exposure entry `health=warning` ("players appear as 127.0.0.1; IP bans and IP-based plugins won't work"). The P5 players page shows the same banner when any enabled route lacks PROXY. `ban-ip` of loopback addresses is blocked by P2 ([security.md](../../architecture/security.md#player-ip-integrity)). | router, api | `server.view` | — |

## Port mapping

| ID | Requirement | Crates | Perm | Audit / Event |
|---|---|---|---|---|
| P7-FR-20 | Gateway discovery: UPnP IGD (3 s SSDP) then NAT-PMP; result cached, re-run on demand and every 30 min if previously none. Only when `[portmap] enabled = true`. | portmap | admin | — |
| P7-FR-21 | Create/delete TCP mapping for the router port or a server port (`direct_and_router` / no-route servers only); description `mcm:<name>`; conflict → `portmap.conflict`. | portmap, api | admin | `portmap.create` / `portmap.delete`; `PortMappingChanged` |
| P7-FR-22 | Lease renewal at half lease; permanent-lease fallback (UPnP 725); re-add after gateway reboot; retry with backoff; `last_error`. | portmap | — | — / `PortMappingFailed` |
| P7-FR-23 | Remove mappings on disable/delete and graceful shutdown (≤ 3 s total); re-add enabled mappings on startup. | portmap, server | — | — |
| P7-FR-24 | External IP retrieval and classification (`public`/`cgnat`/`double_nat`/`unknown`/`invalid`) with UI guidance; CGNAT/double NAT recommends tunnelling (P9 relay or alternatives). | portmap | admin | — |

## Edge cases and failure modes

| Case | Behaviour |
|---|---|
| Hostname with uppercase / trailing dot / FML3 marker | Normalised; routes still match. |
| Handshake split across many TCP segments | Buffered until complete within the timeout. |
| Handshake + Login Start in one segment | Both replayed verbatim. |
| Backend not listening (just crashed) | Synthetic offline response; counter `backend_unreachable`. |
| Router listen port equals a server port on the same IP | Config validation error; P1 port allocation skips the router port. |
| Paper backend has PROXY enabled but route toggled off | Players fail; UI shows `backendConfig = mismatch` from reading `paper-global.yml`. |
| PROXY route exists but backend config still `pending` (never started) | `backend_expects_proxy = false` until applied; first start applies it, restart required. |
| Second route added to a PROXY server with `direct_and_router` | `422 proxy.proxy_protocol_requires_router_only`. |
| UPnP mapping succeeds but IP is CGNAT | Mapping kept, status `warning` with tunnelling recommendation. |
| `ban-ip 127.0.0.1` issued while routed without PROXY | Rejected by P2 (`players.ban_ip_forbidden`); console command path also blocked. |

## Security considerations

- Router is an internet-facing parser: handshake/PROXY decoders are pure, bounded, fuzzed (`handshake_parse`, `proxy_v2_roundtrip`) and never allocate from unchecked lengths.
- PROXY headers accepted only from trusted CIDRs (prevents IP spoofing that would bypass IP bans).
- Real-IP loss is surfaced (P7-FR-19) rather than silently degrading bans (security.md T13).
- Wake-on-join lets anonymous internet users start a server: opt-in per route, rate limited, audited with client IP.
- `router_only` keeps the game port, and with it RCON, on loopback.
- UPnP is opt-in (`[portmap] enabled = false` by default); mappings never created automatically.
