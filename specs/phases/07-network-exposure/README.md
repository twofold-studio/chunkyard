# Phase 7 — Network exposure: hostname router and port mapping

## Goal

Let players reach servers from outside the host with minimal setup: many servers on one public port selected by hostname, automatic router port mapping where the NAT allows it, and the real client IP preserved for bans and logs. Tunnelling through a relay for CGNAT/no-router-access cases is [phase 9](../09-relay/README.md).

## Milestones (both independently shippable)

| Milestone | Delivers | Crates | Spec |
|---|---|---|---|
| **Router** | Minecraft-protocol hostname router on one port (e.g. `:25565`), per-server routes, fallback route, unknown-host MOTD/disconnect, wake-on-join, PROXY protocol v2 to backends (and `LOCAL` headers on mcm's own probes), inbound PROXY v2 from trusted sources, loopback-only exposure, limits, per-route counters, real-IP warnings | `mcm-router`, `mcm-protocol` (handshake, PROXY v2), `mcm-api` | [router.md](router.md) |
| **Port mapping** | UPnP IGD and NAT-PMP mappings for the router port or per-server ports, lease renewal, external IP display, CGNAT/double-NAT detection with tunnelling guidance | `mcm-portmap`, `mcm-api` | [upnp.md](upnp.md) |

## Non-goals

- **Relay / tunnelling** — phase 9 (`mcm-relay`, `mcm-tunnel`). P7 only leaves the seams: the router's connection handler accepts any `IncomingConn`, and `ExposureEntry.kind` is an additive enum.
- **Bedrock / UDP** (19132, RakNet), including Geyser's UDP listener. Only Java TCP is routed.
- Being a full Minecraft proxy (Velocity/BungeeCord): no login handling, server switching, encryption termination or forwarding secrets. The router reads the handshake, then splices bytes.
- Reverse-proxying the mcm web UI.
- Automatic DNS management — documented manual records only.
- Query (UDP) forwarding.
- PCP (RFC 6887) and IPv6 pinholes — open question.

## User stories

| ID | Story |
|---|---|
| P7-US-01 | As an operator with one public IP I expose `survival.example.com`, `creative.example.com`, `modded.example.com`, all on port 25565. |
| P7-US-02 | As an operator I want bans and logs on Paper to show the player's real IP even though connections come through mcm. |
| P7-US-03 | As an operator I want a stopped server to start automatically when someone tries to join. |
| P7-US-04 | As an operator on a home router I click "Open port" and mcm maps it via UPnP and shows the address to share. |
| P7-US-05 | As an operator behind CGNAT I'm told port forwarding cannot work and pointed to tunnelling options. |
| P7-US-06 | As an operator I see per server which addresses players can use, whether each path is healthy, and whether real player IPs are visible to the server. |

## Dependencies

| Phase | Needed |
|---|---|
| [0](../00-foundation/README.md) | Config, settings table, audit catalog, rate-limit infrastructure |
| [1](../01-lifecycle-console/README.md) | `servers.port`, `ServerService::start`/status (wake-on-join, health), ready SLP fallback (gains PROXY `LOCAL`) |
| [2](../02-settings-files/README.md) | `PropertiesEditor` (`server-ip` managed key), `ServerFileAccess` for `config/paper-global.yml`, `ban-ip` loopback block |
| [5](../05-monitoring/README.md) (optional) | SLP prober reused for route health and players page (gains PROXY `LOCAL`, real-IP warning) |
| Architecture | [minecraft-protocols.md](../../architecture/minecraft-protocols.md), [security.md](../../architecture/security.md) (T13 player IP integrity), [workspace-layout.md](../../architecture/workspace-layout.md) |

## Files

[requirements.md](requirements.md) · [router.md](router.md) · [upnp.md](upnp.md) · [api.md](api.md) · [ui.md](ui.md) · [tests.md](tests.md)

## Exit checklist

Router:
- [ ] Routes ≥ 3 fake-mc backends by hostname incl. Forge-marked handshakes; unknown host gets MOTD/disconnect; legacy ping answered.
- [ ] PROXY v2 encoder byte-exact against spec vectors; fake-mc echoes the real client address; mcm's own probes send `LOCAL` and succeed against PROXY-enabled backends.
- [ ] `sendProxyProtocol` + `direct_and_router` rejected with `proxy.proxy_protocol_requires_router_only`.
- [ ] Real-IP warning shown on Network tab and players page for routes without PROXY.
- [ ] Fuzz targets `handshake_parse`, `proxy_v2_roundtrip` in CI; coverage of `mcm-router` and `mcm-protocol::proxy_v2` ≥ 95 %.
- [ ] Load test: 1 000 concurrent spliced connections, router RSS < 100 MiB (nightly).

Port mapping:
- [ ] UPnP and NAT-PMP mapping tested against in-process fake gateways; renewal and removal on shutdown proven.
- [ ] CGNAT classification table tested.

All:
- [ ] Every mutating endpoint audited with catalog names; OpenAPI regenerated; E2E `p7-*.spec.ts` green.
- [ ] Docs: DNS records (A/AAAA, wildcard, optional SRV), Paper PROXY setup, port-forwarding guide, "behind CGNAT" options page (P9 extends it).

## Open questions / to verify

| Topic | Question |
|---|---|
| Paper PROXY setting | Key path believed to be `proxies.proxy-protocol` in `config/paper-global.yml` (Paper ≥ 1.19). Verify; older Paper used `settings.proxy-protocol` in `paper.yml`? |
| Fabric/Forge PROXY | No built-in support; community mods exist (names/compatibility to verify). UI warns rather than auto-configures. |
| Velocity/Bungee | Velocity `haproxy-protocol = true` in `velocity.toml`; BungeeCord/Waterfall `proxy_protocol: true` per listener in `config.yml` — verify current keys. |
| PROXY `LOCAL` acceptance | That Paper/Velocity accept a v2 `LOCAL` header (no addresses) and keep the socket address, so mcm's SLP probes work. Verify in smoke suite. |
| Handshake suffixes | Exact suffix formats used by TCPShield / BungeeCord IP forwarding / Forge FML3 beyond the first `\0`. |
| NAT-PMP / PCP crate | `natpmp` crate or own implementation (RFC 6886 is small). PCP deferred. |
| igd-next lease 0 | Which routers reject non-zero leases (`OnlyPermanentLeasesSupported`, 725) — handled by fallback. |
