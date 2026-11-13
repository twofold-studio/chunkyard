# Phase 9 — Tunnel wire protocol (`mcm-tunnel-proto`)

Leaf crate (no `mcm-*` dependencies): types + codec + pairing-string parser, used by `mcm-relay` and `mcm-tunnel`. Its `ProtocolError` is not `Classify`-ed; `mcm-tunnel` maps it into `TunnelError`. Protocol version **1**.

## Layers

```
TCP ─ TLS 1.3 (rustls, ALPN "mcm-tunnel/1") ─ yamux
   ├── stream opened by agent first  = CONTROL stream (exactly one)
   └── streams opened by relay       = DATA streams (one per player connection)
```

The agent never opens data streams; the relay never opens the control stream. A relay-opened stream is always a data stream.

## Framing

`Frame = len: u32 big-endian | payload: [u8; len]`, `1 ≤ len ≤ 65 536`. `payload` = **postcard** (serde, v1 wire format) encoding of the message enum for that stream type.

Why postcard: compact varint encoding, serde-derived (no hand-written codec to get wrong), stable documented wire format, `no_std`-friendly. Compatibility rules: enum variants and struct fields are **append-only**; never reorder or remove; new optional data goes into new variants guarded by the negotiated version. Decoders reject trailing bytes and unknown variants (→ `ProtocolError`, connection closed with `GoAway{code:"protocol"}` when possible).

## Control messages

```rust
#[derive(Serialize, Deserialize)]
pub enum Control {
    // agent → relay
    Hello { proto_min: u16, proto_max: u16, agent_version: String, token: String /* mcr_… */ },
    Announce { seq: u32, routes: Vec<RouteAnnounce> },
    Ping { nonce: u64 },
    ProbeRequest { id: u32, port: u16 },
    // relay → agent
    HelloOk { proto: u16, relay_version: String, agent_name: String, assignment: Assignment,
              heartbeat_s: u16, public_addrs: Vec<String> /* e.g. "relay.example.com:25565" */ },
    HelloErr { code: String /* "auth" | "version" | "limit" */, message: String },
    AnnounceAck { seq: u32, accepted: Vec<u32 /* route_key */>, rejected: Vec<RouteReject> },
    Pong { nonce: u64 },
    ProbeResult { id: u32, ok: bool, latency_ms: Option<u32>, error: Option<String> },
    Stats { streams_active: u32, bytes_in: u64, bytes_out: u64 },     // every 30 s
    // both directions
    GoAway { code: String /* "replaced" | "revoked" | "shutdown" | "protocol" */, message: String },
}
pub struct Assignment { pub hostnames: Vec<String>, pub ports: Vec<u16>, pub max_streams: u32 }
pub struct RouteAnnounce { pub route_key: u32, pub target: RouteTarget }
pub enum RouteTarget { Hostname(String), Port(u16) }
pub struct RouteReject { pub route_key: u32, pub reason: String /* "not_assigned" | "duplicate" */ }
```

`route_key` is an agent-local u32 mapping to a `proxy_routes.id` (UUIDs are not sent to the relay).

### Sequence and timing

| Step | Rule |
|---|---|
| Hello | Must be the first frame within 10 s of TLS completion, else relay closes. Relay picks `proto = min(proto_max, relay_max)` if ≥ both mins, else `HelloErr{code:"version"}`. |
| Announce | Full replacement of the agent's route set each time (`seq` increases). Relay validates each target against `Assignment`; data streams are only opened for accepted routes. |
| Heartbeat | Agent sends `Ping` every `heartbeat_s` (default 15); relay answers `Pong`; either side closes after 3 × heartbeat without traffic on control. |
| Shutdown | `GoAway` then close the yamux session; agent does not reconnect after `revoked` until the user re-pairs; after `shutdown`/`replaced`, normal backoff. |

## Data streams

```rust
pub struct StreamOpen {
    pub route_key: u32,
    pub client_addr: SocketAddr,        // real player address as seen by the relay
    pub relay_addr: SocketAddr,         // listener address the player connected to (PROXY v2 dst)
    pub hostname: Option<String>,       // normalised handshake hostname (None on dedicated ports)
    pub prebuffered_len: u32,           // number of raw bytes following this frame that were already read by the relay (≤ 2048)
}
```

Layout: `Frame(StreamOpen)` then exactly `prebuffered_len` raw bytes (the handshake and anything after it the relay read), then raw spliced bytes until either side closes. The agent replies nothing on the stream before payload; if it cannot serve the route it writes a Minecraft disconnect/status itself (it has the handshake bytes) and closes.

Stream close: FIN on yamux stream = half-close (mirrors TCP); RST = abort.

## Limits

| Item | Limit |
|---|---|
| Control frame | ≤ 65 536 bytes |
| Hello `token` | ≤ 64 bytes |
| Announce routes | ≤ 256 |
| `prebuffered_len` | ≤ 2 048 |
| Hostname | ≤ 255 bytes, normalised lowercase |

## Test vectors

`crates/mcm-tunnel-proto/tests/vectors/*.bin` with JSON descriptions: one per message variant, plus invalid cases (len 0, len > 65 536, trailing bytes, unknown variant, truncated). Snapshot-tested with `insta` (hex dump) so any accidental wire change fails CI.
