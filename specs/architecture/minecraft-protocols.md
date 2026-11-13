# Minecraft protocols reference

Owned by `mcm-protocol` (leaf crate: codecs + small async clients over `tokio::io`). Used by P1 (ready probe), 5 (players/TPS), 7 (router), and `fake-mc-server`.

## VarInt / VarLong

- LEB128-style, 7 data bits per byte, MSB = continuation, little-endian groups, two's-complement for negatives (so `-1` is 5 bytes `ff ff ff ff 0f`).
- VarInt max 5 bytes, VarLong max 10 bytes; more → `ProtocolError::VarIntTooLong`.
- Strings: VarInt byte length + UTF-8. Max lengths enforced by the reader (handshake address: 255 chars ⇒ ≤ 1020 bytes, we cap at 1024 bytes).

## Packet framing (uncompressed, pre-login)

`Length (VarInt) | PacketId (VarInt) | Data`. Length counts PacketId + Data. Compression/encryption only begin after login and are never handled by mcm (the router forwards bytes opaquely after the handshake).

Limits enforced by our reader: first packet length ≤ 2 MiB is the protocol max; **router uses ≤ 1100 bytes** for the handshake (anything larger is not a legitimate handshake) and a 5 s read timeout.

## Handshake (state Handshaking, id `0x00`)

| Field | Type | Notes |
|---|---|---|
| Protocol version | VarInt | e.g. 767 = 1.21; `-1` conventional for status probes |
| Server address | String(255) | Hostname the client typed. Forge appends `\0FML\0`, `\0FML2\0`, `\0FML3\0`; some proxies append `\0`-separated data (BungeeCord IP forwarding). TCPShield and others may append `///` suffixes. Router takes text before the first `\0`, strips a trailing `.`, lowercases |
| Server port | u16 BE | |
| Next state | VarInt | `1` status, `2` login, `3` transfer (1.20.5+) |

## Server List Ping (status)

1. C→S Handshake (next state 1).
2. C→S Status Request: id `0x00`, empty.
3. S→C Status Response: id `0x00`, String JSON:
   `{"version":{"name":"1.21.1","protocol":767},"players":{"max":20,"online":1,"sample":[{"name":"x","id":"uuid"}]},"description":<text component|string>,"favicon":"data:image/png;base64,...","enforcesSecureChat":false}`.
4. C→S Ping Request: id `0x01`, Long (i64). S→C Pong: id `0x01`, same Long. RTT = latency.

Parsing rules: `description` may be a string or a chat component (object with `text`, `extra[]`, colors) — normalise to plain text + keep raw. `players.sample` is optional, may be truncated (vanilla shows ≤ 12) or contain fake entries (plugins) — never treated as the authoritative list. Response string cap 256 KiB (favicons).

### Legacy ping

Pre-1.7 clients send `0xFE 0x01 …`. Router: respond with legacy kick `0xFF` + UTF-16BE `§1\0<proto>\0<ver>\0<motd>\0<online>\0<max>` for unknown routes, otherwise forward to backend. Status client never uses legacy.

## RCON (Source RCON over TCP)

Packet (all integers **little-endian** i32):

| Field | Size |
|---|---|
| Length | 4 (counts the rest: id + type + body + 2 nulls) |
| Request ID | 4 |
| Type | 4 |
| Body | ASCII/UTF-8, then `\0` |
| Pad | `\0` |

| Type value | Meaning |
|---|---|
| 3 | `SERVERDATA_AUTH` (C→S) |
| 2 | `SERVERDATA_AUTH_RESPONSE` (S→C) **and** `SERVERDATA_EXECCOMMAND` (C→S) |
| 0 | `SERVERDATA_RESPONSE_VALUE` (S→C) |

- Auth: send type 3 with password; response type 2 with the same request id on success, **request id `-1`** on failure.
- Vanilla limits: client→server body max ~1446 bytes (packet ≤ 1460); our client rejects commands > 1400 bytes.
- **Fragmentation**: responses with body > 4096 bytes are split into multiple type-0 packets with the same id and no terminator. Our client sends the command (id N) and, **after the first response fragment for N arrives**, a sentinel packet (id N+1, type `100` invalid) — sending it earlier risks the sentinel reply overtaking a slow command's output on some servers; vanilla replies to unknown types with body `Unknown request 64` (packet type of that reply to verify), so the client concatenates bodies with id N until a packet with id N+1 arrives. Fallback if sentinel is never answered: idle timeout 300 ms after last fragment.
- Single connection per server, commands serialised by an actor; reconnect with backoff; auth failure → stop retrying and raise `rcon.auth_failed` event.
- Bodies may contain `§` colour codes; stripped for parsers, kept for display.
- **RCON is not touched before P5.** From P5, mcm enables it (`enable-rcon=true`, `rcon.port=<allocated>`, `rcon.password=<random 32 chars>`, marked secret). Vanilla binds RCON to `server-ip` (all interfaces when empty); there is no separate RCON bind setting (to verify). RCON is therefore **loopback-bound by default only when `server-ip=127.0.0.1`** (router-only exposure, P7) or the port isn't published (Docker, P10). Otherwise the server page shows a warning "RCON is reachable on all interfaces" with firewall guidance and a one-click "disable RCON" (metrics then use the management protocol or SLP).

## Server Management Protocol (1.21.9+)

Vanilla 1.21.9+ ships a JSON-RPC 2.0 API over WebSocket (`ws(s)://host:port`), configured in `server.properties`:

| Key | Default | mcm sets |
|---|---|---|
| `management-server-enabled` | `false` | `true` (P5, when MC ≥ 1.21.9) |
| `management-server-host` | `localhost` | `127.0.0.1` (managed) |
| `management-server-port` | `0` (random) | allocated port (managed) |
| `management-server-secret` | generated 40 alphanumerics if empty | random 40 chars, **secret** |
| `management-server-allowed-origins` | empty (blocks browser origins) | empty (mcm is not a browser) |
| `management-server-tls-enabled` | `true` | `false` (loopback only) |
| `management-server-tls-keystore`, `management-server-tls-keystore-password` | — | unset (password marked secret if user sets it) |

- Auth: `Authorization: Bearer <secret>` (or `Sec-WebSocket-Protocol: minecraft-v1,<secret>`).
- Methods used: `minecraft:players` (list), `minecraft:allowlist` (+ `/add`, `/remove`, `/set`, `/clear`), `minecraft:players/kick`; notifications `minecraft:notification/players/joined` / `…/left`. Discover with `rpc.discover`.
- **Preferred data source** for players and allowlist on servers that support it (P5, P2 allowlist editing); RCON/SLP remain fallbacks. Because it has its own `host` setting, it is loopback-only even when the game port is public.
- Not available on Paper/Forge-derived builds unless they keep the vanilla implementation (to verify per flavour).

## Query (GameSpy4, UDP) — optional

- Enabled with `enable-query=true`, `query.port`.
- Handshake: `FE FD 09 <session id i32 BE & 0x0F0F0F0F>` → response type `09`, session, null-terminated ASCII challenge integer.
- Full stat: `FE FD 00 <session> <challenge i32 BE> 00 00 00 00` → K/V section then `\x00\x01player_\x00\x00` and null-terminated player names.
- Used only if RCON is disabled and user opts in; gives full player list without RCON.

## TPS / MSPT probes (best effort, via RCON)

| Flavor | Command | Output to parse |
|---|---|---|
| Paper/Purpur/Folia-like | `tps` | `TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.98` (with `§` codes, values may be prefixed `*` when capped) |
| Paper ≥ 1.16.5 | `mspt` | Three lines of avg/min/max over 5s/10s/60s (format **to verify**) |
| Vanilla ≥ 1.20.3 | `tick query` | Target tick rate and average/percentile ms per tick (format **to verify**) |
| Forge | `forge tps` | `Overall: Mean tick time: 2.345 ms. Mean TPS: 20.000` |
| NeoForge | `neoforge tps` | Same shape as Forge (to verify) |
| Spark installed | `spark tps` | Preferred when present (to verify format) |

All parsers are pure functions with fixtures in `crates/mcm-protocol/tests/fixtures/tps/*.txt` and proptest for "never panics".

## Player list

`list` via RCON: `There are 2 of a max of 20 players online: Alice, Bob` (1.13+; older: `There are 2/20 players online:` with names on the next line). Join/leave are also detected from console lines using the flavour-aware, chat-spoof-proof matchers in [log-formats.md](log-formats.md) (used for `player_sessions`). On 1.21.9+ the management protocol's join/left notifications are preferred.

## Open questions / to verify

- Server Management Protocol: method/notification names beyond those above, availability on Paper/Fabric/Forge/NeoForge builds, exact TLS default behaviour per version.

- Exact vanilla response type and body for unknown RCON packet types across versions (sentinel technique relies on it). Verify against 1.8, 1.12, 1.16, 1.20, 1.21 in the real-server smoke suite.
- `mspt`, `tick query`, `neoforge tps`, `spark tps` output formats — capture fixtures in the smoke suite.
- Protocol version numbers for recent releases come from SLP; we never hard-code them.
