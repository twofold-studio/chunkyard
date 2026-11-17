# Phase 9 — Requirements

Details: [relay.md](relay.md), [tunnel-protocol.md](tunnel-protocol.md). Audit names from [audit.md](../../architecture/audit.md). `chunkyard-tunnel` depends on `chunkyard-core`, `chunkyard-tunnel-proto`, `chunkyard-router` only; persistence via the `RelayConnectionRepo` core trait (impl `chunkyard-db`). The relay binary has its own DB and depends only on `chunkyard-protocol` and `chunkyard-tunnel-proto`.

## Relay binary (`chunkyard-relay`)

| ID | Requirement | Crates | Perm | Audit / Event |
|---|---|---|---|---|
| P9-FR-01 | `chunkyard-relay init` creates `relay.toml`, `relay.db`, self-signed cert (ECDSA P-256, SAN = public host), admin token; refuses if already initialised (unless `--force`). | relay | (CLI) | — |
| P9-FR-02 | Agent management CLI (`add`, `list`, `revoke`, `rotate-token`, `set`); `add`/`rotate-token` print a pairing string once; tokens stored as sha256; changes applied live via the admin socket. | relay, tunnel-proto | (CLI) | relay log |
| P9-FR-03 | Tunnel listener: TLS 1.3 only, ALPN `tunnel/1`, yamux; `Hello` within 10 s; auth per [relay.md § Agent authentication](relay.md#agent-authentication); single session per agent (new session replaces old with `GoAway{replaced}`). | relay, tunnel-proto | — | — |
| P9-FR-04 | Control protocol exactly per [tunnel-protocol.md](tunnel-protocol.md): version negotiation, `Announce` validated against `Assignment`, heartbeat, `GoAway`. | tunnel-proto, relay, tunnel | — | — |
| P9-FR-05 | Public listeners: shared hostname-routed (`public_listen`, handshake parsed with `mcm_protocol::handshake::normalize_host`) and dedicated ports (listening only while the assigned agent announces them); offline status/disconnect when no agent/route. | relay, protocol | — | — |
| P9-FR-06 | Data streams: `StreamOpen` + prebuffered bytes + splice; relay limits per IP, per-agent `max_streams`, optional bandwidth token bucket; idle timeout 120 s. | relay, tunnel-proto | — | — |
| P9-FR-07 | Revocation / rotation: affected agent receives `GoAway{revoked}` and is disconnected within 10 s; its listeners and player streams closed. | relay | (CLI) | — |
| P9-FR-08 | Hardening: handshake timeout, per-IP connection and rate limits, auth-failure IP block (5/min → 10 min), never dials outbound except the probe (P9-FR-14); logs never contain tokens. | relay | — | — |
| P9-FR-09 | Status: `chunkyard-relay status` (admin socket) and optional `admin_http` `GET /status` (JSON: agents, connected, streams, bytes) and `GET /metrics` (Prometheus text), bearer admin token. | relay | (admin token) | — |

## Agent side (mcm)

| ID | Requirement | Crates | Perm | Audit / Event |
|---|---|---|---|---|
| P9-FR-10 | Relay connections CRUD: add by pairing string (parsed by `mcm_tunnel_proto::pairing`, validated, token encrypted with AAD `relay_connections.token_enc:<id>`), enable/disable, re-pair, delete (routes bound to it get `relay_id = NULL`); status (connected, last error, assignment, public addrs). | tunnel, api, db | admin (`admin` scope for tokens) | `relay.connection.create` / `.update` / `.delete`; `RelayStatusChanged` |
| P9-FR-11 | `TunnelClient` actor per enabled connection: pinned-fingerprint verifier (still verifying TLS signatures), reconnect backoff 1 → 60 s with jitter (reset after 60 s connected), `Announce` from routes with `relayId`, re-announce on change, heartbeat. Fingerprint mismatch / auth failure stop retrying and set status `error`. | tunnel | — | — / `RelayStatusChanged` |
| P9-FR-12 | Each incoming data stream → `IncomingConn { peer: client_addr, local: relay_addr, prebuffered, hostname_hint }` → `mcm_router::ConnectionHandler` (wake-on-join, PROXY v2 to backend with the real client address if the route has `sendProxyProtocol`, synthetic responses); works with the local router listener disabled. | tunnel, router | — | — |
| P9-FR-13 | Route ↔ relay binding: P7 routes gain `relayId` and `relayTarget` (`hostname` or `port` from the assignment); announces `Hostname(hostname)` / `Port(port)`; rejected announcements shown on the route (`relayState = rejected`, reason). A `router_only` route is valid without a local router listener when it has a relay binding (relaxes P7 `proxy.router_disabled`). P7-FR-18 (PROXY ⇒ router-only) applies unchanged. | router, tunnel, api | `proxy.manage` (+ admin to pick a relay) | `proxy.route.update` |
| P9-FR-14 | Reachability probe for a P7 port mapping: `ProbeRequest{port}` → relay performs an SLP status request to **the agent's own tunnel source IP** on that port (never another address) and returns `ProbeResult`; 1 probe per agent per 30 s. | tunnel, relay, tunnel-proto, api | admin | `portmap.probe` |
| P9-FR-15 | Exposure and real-IP: exposure summary gains `relay` entries (`hostname` or `relay-host:port`, health from relay status + route state); relay routes without PROXY carry the P7 `real_ip_hidden` warning and drive the same banner on the Network tab and players page. | router, tunnel, api | `server.view` | — |
| P9-FR-16 | Alternatives guidance: the "Behind CGNAT" docs page documents frp, playit.gg, WireGuard + VPS, Tailscale Funnel caveats with the comparison from [relay.md](relay.md#alternatives-to-chunkyard-relay); the Relays empty state and the P7 CGNAT alert link to it. | web, docs | — | — |

## Edge cases and failure modes

| Case | Behaviour |
|---|---|
| Two agents announce the same hostname | Relay rejects the second (`duplicate`); first announcer wins; UI shows reason. |
| Hostname outside assignment | `RouteReject{not_assigned}`; route `relayState = rejected`. |
| Relay restarts | Agents reconnect with backoff; players see disconnect; no state loss. |
| Agent token leaked | `rotate-token` invalidates it; live session gets `GoAway{revoked}`. |
| Pairing string pasted with wrong fingerprint (MITM or re-init) | Status `error` / `relay.fingerprint_mismatch`; no retry until re-paired. |
| Relay connection deleted while players are connected | Tunnel closed; players disconnected; routes unbound. |
| Backend PROXY enabled, player via relay | Agent sends PROXY v2 with `StreamOpen.client_addr`; mcm's own probes still use `LOCAL` (P7-FR-17). |
| Probe requested without connected relay | `409 relay.not_connected`. |
| Agent behind a proxy that blocks ALPN | TLS fails → status `error` with reason; documented. |

## Security considerations

- The relay is internet-facing; all decoders (handshake, tunnel frames) are bounded and fuzzed (`handshake_parse`, `tunnel_frame_decode`).
- Not an open proxy: forwards only into authenticated tunnels to hostnames/ports the relay admin assigned; probe limited to the agent's own source IP (security.md T9).
- Pinned certificate fingerprint defeats MITM without a CA; the verifier still checks handshake signatures.
- The pairing string contains the token: write-only in the API, masked in the UI after entry, never logged (`no_secrets_in_logs_relay_token`).
- Relay tokens hashed (sha256, high entropy) on the relay; encrypted at rest in mcm.
- Real client IP only reaches the backend via PROXY from the agent; without it the P7 real-IP warning applies.
