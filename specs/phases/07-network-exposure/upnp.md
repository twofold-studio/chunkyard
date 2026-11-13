# Phase 7 — Port mapping (`mcm-portmap`)

## Structure

```
crates/mcm-portmap/src/
├── mapper.rs            # PortMapper actor: owns mappings, renewal timers (Clock injected)
├── schedule.rs          # renewal/backoff schedule (pure)
├── gateway.rs           # trait Gateway { external_ip, add_mapping, remove_mapping }
├── upnp.rs              # IgdGateway via igd-next (aio/tokio), feature `upnp`
├── natpmp.rs            # NatPmpGateway (RFC 6886), UDP 5351 to default gateway
├── classify.rs          # external address classification (pure)
└── config.rs            # PortmapConfig ([portmap] section)
```

Depends only on `mcm-core` (persistence via the `PortMappingRepo` trait).

`Gateway` is a trait so tests run against in-process fakes (an SSDP+SOAP fake for IGD, a UDP fake for NAT-PMP).

## Discovery

1. Determine default gateway IPv4 and the local interface address used to reach it (read `/proc/net/route`; fallback: UDP "connect" to `1.1.1.1:53` without sending to learn the local address). Config `[portmap] local_ip` overrides.
2. Try **UPnP IGD**: `igd_next::aio::tokio::search_gateway` (SSDP multicast `239.255.255.250:1900`, timeout 3 s). Supports WANIPConnection v1/v2 and WANPPPConnection.
3. Else try **NAT-PMP**: send opcode 0 (external address request) to `<gateway>:5351`, retry schedule 250 ms doubling, 4 tries.
4. Else `method = none`.

PCP (RFC 6887) is deferred (open question).

## Mapping lifecycle

| Step | Behaviour |
|---|---|
| Add | `add_mapping(proto=TCP, external_port, internal=<local_ip>:<internal_port>, lease=3600, description="mcm:<name>")`. If the external port is taken (UPnP error 718 `ConflictInMappingEntry`) → `portmap.conflict`, no automatic port change (players need a stable address); user may choose another external port. |
| Lease 0 only | UPnP error 725 `OnlyPermanentLeasesSupported` → retry with lease 0; mapping marked `permanent` and removed on shutdown/disable. |
| Renew | Timer at half the granted lease (NAT-PMP returns the granted lifetime; UPnP uses requested). Failure → retry with backoff 30 s → 5 min; `last_error` set; event `PortMappingFailed`. |
| Gateway reboot | Detected by NAT-PMP epoch reset or renewal failure; full re-add of all mappings. |
| Remove | On disable, delete, and graceful shutdown (bounded 3 s total). Crash leaves leases to expire (≤ 1 h). |
| Persist | Rows in `port_mappings`; on startup, enabled mappings are re-added. |

Targets: the router port or a server's own `port` (direct exposure). Mapping a server port while that server has a `router_only` route is rejected (`portmap.router_only_server`).

## External address classification (`classify.rs`)

| External IP reported by gateway | Classification | UI guidance |
|---|---|---|
| Public unicast | `public` | Share `<ip>:<port>` or a DNS name; show "reachable if your ISP allows inbound" |
| `100.64.0.0/10` | `cgnat` | "Your ISP uses carrier-grade NAT; port forwarding cannot work. Use a tunnel (mcm relay from P9, or frp / playit.gg / WireGuard — see docs)." |
| RFC 1918 (`10/8`, `172.16/12`, `192.168/16`) | `double_nat` | "Your router is behind another router; map the port there too, or use a tunnel." |
| `0.0.0.0` / unavailable | `unknown` | — |
| Link-local, loopback | `invalid` | Treated as failure |

## Reachability self-test

Testing from inside the LAN is unreliable (hairpin NAT often unsupported), so P7 does **not** claim "reachable". The UI shows the external address and a manual check procedure. A relay-assisted probe is added in [P9](../09-relay/requirements.md) (`portmap.probe`).

## Config / settings

| `[portmap]` key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Master switch; mapping is never automatic without opt-in |
| `local_ip` | auto | Override local interface address |
| `lease_s` | 3600 | Requested lease |
