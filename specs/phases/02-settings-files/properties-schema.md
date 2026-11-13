# `server.properties` schema

Lives in `crates/mcm-fs/src/properties/schema.rs` as a static table, exported through `GET /api/v1/meta/server-properties-schema` so the UI renders forms from the same source. Version bounds use the MC release ordering from the Mojang manifest (phase 3); before phase 3, bounds are informational only.

## Field model

```rust
pub struct PropertySpec {
    key: &'static str,
    ty: PropType,             // Bool | Int { min, max } | Enum(&[..]) | String { max_len } | Seed | Secret
    default: &'static str,
    group: Group,             // General | Players | World | Network | Performance | Resource pack | Advanced
    since: Option<&'static str>,   // first MC version, None = ancient
    until: Option<&'static str>,   // last version that reads the key
    managed_since: Option<u8>,  // phase from which mcm owns the key (P2-FR-12 registry); None = user-editable
    secret: bool,               // redacted per P2-FR-32
    description: &'static str,
}
```

Validation: `Bool` accepts `true|false` only (Java accepts any string as false; we are stricter); `Int` parsed as i64 then range-checked; `Enum` compared case-sensitively against the version-appropriate set; unknown keys are untyped strings.

## Known keys

| Key | Type | Default | Range / values | Group | Since / until | Managed (phase) |
|---|---|---|---|---|---|---|
| `accepts-transfers` | bool | false | | Network | 1.20.5 | |
| `allow-flight` | bool | false | | Players | | |
| `allow-nether` | bool | true | | World | | |
| `broadcast-console-to-ops` | bool | true | | Advanced | | |
| `broadcast-rcon-to-ops` | bool | true | | Advanced | | |
| `bug-report-link` | string | "" | ≤ 256 | Advanced | 1.21 (verify) | |
| `difficulty` | enum | easy | peaceful, easy, normal, hard (≤ 1.13: 0–3) | World | | |
| `enable-command-block` | bool | false | | World | | |
| `enable-jmx-monitoring` | bool | false | | Advanced | 1.16 | |
| `enable-query` | bool | false | | Network | | |
| `enable-rcon` | bool | false | | Network | | P5 |
| `enable-status` | bool | true | | Network | 1.16 | |
| `enforce-secure-profile` | bool | true | | Players | 1.19 | |
| `enforce-whitelist` | bool | false | | Players | 1.13 | |
| `entity-broadcast-range-percentage` | int | 100 | 10–1000 | Performance | 1.16 | |
| `force-gamemode` | bool | false | | Players | | |
| `function-permission-level` | int | 2 | 1–4 | Advanced | 1.14 | |
| `gamemode` | enum | survival | survival, creative, adventure, spectator (≤ 1.13: 0–3) | Players | | |
| `generate-structures` | bool | true | | World | | |
| `generator-settings` | string | {} | ≤ 32 768 | World | | |
| `hardcore` | bool | false | | World | | |
| `hide-online-players` | bool | false | | Network | 1.18 | |
| `initial-disabled-packs` | string | "" | | World | 1.19.3 | |
| `initial-enabled-packs` | string | vanilla | | World | 1.19.3 | |
| `level-name` | string | world | ≤ 128, valid dir name | World | | |
| `level-seed` | seed | "" | any string (numeric or text) | World | | |
| `level-type` | enum+free | minecraft:normal | minecraft:normal, minecraft:flat, minecraft:large_biomes, minecraft:amplified, minecraft:single_biome_surface (≤ 1.18: DEFAULT, FLAT, LARGEBIOMES, AMPLIFIED); modded values allowed with warning | World | | |
| `log-ips` | bool | true | | Advanced | 1.20.2 | |
| `max-chained-neighbor-updates` | int | 1000000 | −1–2³¹−1 | Performance | 1.19 | |
| `max-players` | int | 20 | 0–2³¹−1 (UI caps 10 000) | Players | | |
| `max-tick-time` | int | 60000 | −1–2⁶³−1 | Performance | | |
| `management-server-enabled` | bool | false | | Network | 1.21.9 | P5 |
| `management-server-host` | string | localhost | host/IP | Network | 1.21.9 | P5 (`127.0.0.1`) |
| `management-server-port` | int | 0 | 0–65535 (0 = random) | Network | 1.21.9 | P5 |
| `management-server-secret` | secret | "" (generated, 40 alphanumerics) | `[A-Za-z0-9]{40}` | Network | 1.21.9 | P5 |
| `management-server-allowed-origins` | string | "" | comma-separated origins | Network | 1.21.9 | P5 (empty) |
| `management-server-tls-enabled` | bool | true | | Network | 1.21.9 | P5 (`false`, loopback) |
| `management-server-tls-keystore` | string | "" | sandbox-relative PKCS12 path | Network | 1.21.9 | |
| `management-server-tls-keystore-password` | secret | "" | | Network | 1.21.9 | |
| `max-world-size` | int | 29999984 | 1–29999984 | World | | |
| `motd` | string | A Minecraft Server | ≤ 59 chars recommended (warning), `§` codes allowed | General | | |
| `network-compression-threshold` | int | 256 | −1–65535 | Performance | | |
| `online-mode` | bool | true | | Players | | |
| `op-permission-level` | int | 4 | 0–4 | Players | | |
| `pause-when-empty-seconds` | int | 60 | ≥ 0 | Performance | 1.21.2 (verify) | |
| `player-idle-timeout` | int | 0 | ≥ 0 | Players | | |
| `prevent-proxy-connections` | bool | false | | Network | | |
| `pvp` | bool | true | | Players | | |
| `query.port` | int | 25565 | 1–65535 | Network | | |
| `rate-limit` | int | 0 | ≥ 0 | Network | | |
| `rcon.password` | secret | "" | | Network | | P5 |
| `rcon.port` | int | 25575 | 1–65535 | Network | | P5 |
| `region-file-compression` | enum | deflate | deflate, lz4, none | Performance | 1.20.5 | |
| `require-resource-pack` | bool | false | | Resource pack | 1.17 | |
| `resource-pack` | string | "" | URL | Resource pack | | |
| `resource-pack-id` | string | "" | UUID | Resource pack | 1.20.3 | |
| `resource-pack-prompt` | string | "" | JSON text component | Resource pack | 1.17 | |
| `resource-pack-sha1` | string | "" | 40 hex or empty | Resource pack | | |
| `server-ip` | string | "" | IP or empty | Network | | P7 (router-only exposure only) |
| `server-port` | int | 25565 | 1–65535 | Network | | P2 |
| `simulation-distance` | int | 10 | 3–32 | Performance | 1.18 | |
| `spawn-animals` | bool | true | | World | until 1.21.1 (verify) | |
| `spawn-monsters` | bool | true | | World | | |
| `spawn-npcs` | bool | true | | World | until 1.21.1 (verify) | |
| `spawn-protection` | int | 16 | ≥ 0 | World | | |
| `sync-chunk-writes` | bool | true | | Performance | 1.16 | |
| `text-filtering-config` | string | "" | | Advanced | 1.17 | |
| `use-native-transport` | bool | true | | Performance | | |
| `view-distance` | int | 10 | 3–32 | Performance | | |
| `white-list` | bool | false | | Players | | |

Notes:
- **Secret** type keys (`rcon.password`, `management-server-secret`, `management-server-tls-keystore-password`) render masked and are redacted per P2-FR-32. Keys with a Managed phase are editable until that phase ships and are locked from then on (registry in P2-FR-12); in P2 only `server-port` is locked.
- Management-protocol keys: [minecraft-protocols.md § Server Management Protocol](../../architecture/minecraft-protocols.md#server-management-protocol-1219).
- Keys with `since` newer than the server's `mc_version` are shown under "Not used by this version" (collapsed) rather than hidden, because modded/forked servers sometimes read them.
- Year-based versions (26.x) may move more settings to game rules; the schema is data, updated per release, and unknown keys always remain editable.
- Paper/Purpur/Spigot settings live in their own YAML files and are edited via the file editor.
