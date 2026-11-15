# Phase 9 — Relay (`chunkyard-relay`)

## Goal

Make servers reachable when the host cannot accept inbound connections (CGNAT, double NAT, no router access): a small self-hostable `chunkyard-relay` binary on a VPS accepts players and forwards them through an outbound TLS tunnel opened by mcm, preserving the real client IP. Builds on the [P7 router](../07-network-exposure/README.md), which handles every tunnelled connection exactly like a direct one.

## Scope

| Area | Delivers | Crates | Spec |
|---|---|---|---|
| Relay binary | `chunkyard-relay init/serve/agent/status`, own SQLite state, self-signed cert, shared hostname-routed and dedicated-port listeners, limits, admin status | `chunkyard-relay` | [relay.md](relay.md) |
| Wire protocol | Control + data stream frames over TLS 1.3 + yamux, pairing string | `chunkyard-tunnel-proto` (leaf) | [tunnel-protocol.md](tunnel-protocol.md) |
| Agent | Tunnel client actor in mcm, relay connections admin API/UI, route ↔ relay binding, relay-assisted reachability probe for P7 port mappings | `chunkyard-tunnel`, `chunkyard-router`, `chunkyard-api` | [requirements.md](requirements.md) |
| Docs | VPS guide, DNS (wildcard A/AAAA, SRV), firewall, **alternatives** (frp, playit.gg, WireGuard, Tailscale Funnel caveats) | — | [relay.md § Alternatives](relay.md#alternatives-to-chunkyard-relay) |

## Non-goals

- **Bedrock / UDP** (incl. Geyser's UDP listener). Future: QUIC transport with datagrams ([relay.md § Future work](relay.md#future-work)).
- ACME certificates for the tunnel endpoint (pinned self-signed by default; an operator-supplied CA cert is supported).
- Multiple relays per route / failover; relay web dashboard.
- Tunnelling the mcm web UI.
- Hosted relay service run by the project.

## User stories

| ID | Story |
|---|---|
| P9-US-01 | As an operator behind CGNAT I run `chunkyard-relay` on a €4 VPS, paste a pairing string into mcm, and my friends join `alice.play.example.com`. |
| P9-US-02 | As a relay operator I give each friend's mcm its own hostnames/ports and can revoke one without affecting others. |
| P9-US-03 | As an operator I see in mcm whether the relay is connected, which routes it accepted, and why one was rejected. |
| P9-US-04 | As an operator with a UPnP mapping I ask the relay to probe my public address to confirm the port is really reachable. |
| P9-US-05 | As an operator who already uses frp or playit.gg I find documentation showing how to point it at mcm instead. |

## Dependencies

| Phase | Needed |
|---|---|
| [7](../07-network-exposure/README.md) | `mcm_router::ConnectionHandler`, routes, PROXY v2 (`chunkyard-protocol`), exposure summary, port mappings (probe target), real-IP warning |
| [8](../08-users-audit-notifications/README.md) | Admin-only areas incl. relay connections; `admin` token scope; notifications on `RelayStatusChanged` (`relay.disconnected` event) |
| [0](../00-foundation/README.md) | Secret encryption (`token_enc`), audit catalog |
| Architecture | [security.md](../../architecture/security.md) T9, [workspace-layout.md](../../architecture/workspace-layout.md) (`chunkyard-tunnel`, `chunkyard-tunnel-proto`, `chunkyard-relay`) |

## Files

[requirements.md](requirements.md) · [relay.md](relay.md) · [tunnel-protocol.md](tunnel-protocol.md) · [api.md](api.md) · [ui.md](ui.md) · [tests.md](tests.md)

## Exit checklist

- [ ] `chunkyard-relay init` → `agent add` → pairing string → mcm connects; a player traverses relay → tunnel → router → fake-mc backend with the real IP preserved (PROXY v2).
- [ ] Revocation disconnects the agent within 10 s; wrong fingerprint refused without retry loop.
- [ ] Relay is not an open proxy: no outbound dials except the probe to the agent's own source IP (test).
- [ ] Fuzz `tunnel_frame_decode` in CI; `chunkyard-tunnel-proto` coverage ≥ 95 %; relay soak (500 concurrent players, 10 min) green nightly.
- [ ] Relay connections audited (`relay.connection.*`), probe audited (`portmap.probe`); OpenAPI regenerated; E2E `p9-relay.spec.ts` green.
- [ ] Docs: VPS setup guide, DNS records, firewall ports, alternatives comparison.
- [ ] Release artefacts: `chunkyard-relay` musl binaries (x86_64, aarch64) and a minimal OCI image.

## Open questions / to verify

| Topic | Question |
|---|---|
| yamux crate | `yamux` (rust-libp2p, poll-based, needs tokio-util compat) vs `tokio-yamux`; pick by maintenance and backpressure behaviour. |
| playit.gg | Current PROXY-protocol support and plan limits; Bedrock support details. |
| Tailscale Funnel | Whether raw TCP (non-TLS) Minecraft traffic can be funnelled at all; allowed ports (believed 443/8443/10000). |
| frp | `proxy_protocol_version` key name in current frp TOML config (`transport.proxyProtocolVersion`?). |
| Relay IPv6 | Dual-stack public listeners on common VPS providers; PROXY v2 mixed-family encoding covered by P7 tests. |
