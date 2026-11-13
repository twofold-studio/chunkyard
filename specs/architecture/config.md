# Configuration

Owned by `mcm-config`, which **composes** the `*Config` sub-structs defined by each crate ([patterns.md §8](patterns.md#8-typed-config)). Static config is read at startup; runtime-editable settings live in the `settings` table and are edited through the UI.

## Sources (later wins)

1. Built-in defaults.
2. `/etc/mcm/mcm.toml`, or path from `--config` / `CHUNKYARD_CONFIG`.
3. Environment: `CHUNKYARD_` prefix, `__` as section separator (`CHUNKYARD_HTTP__LISTEN=0.0.0.0:8420`).
4. CLI flags for a handful of keys (`--listen`, `--data-dir`).

Unknown keys are an error. `mcm config check` validates and prints the effective config with secrets redacted.

**Non-config `CHUNKYARD_` variables** are excluded from the env provider before `deny_unknown_fields` applies: `CHUNKYARD_CONFIG`, `CHUNKYARD_LOG` (alias for `RUST_LOG`), `CHUNKYARD_SMOKE`, `CHUNKYARD_TEST_DOCKER`, `CHUNKYARD_CURSEFORGE_TEST_KEY`, and any `CHUNKYARD_TEST_*`. Only variables containing `__` (section separator) or matching a top-level key (`CHUNKYARD_DATA_DIR`) are treated as config.

**Listen/origin rule:** if `http.listen` is not a loopback address, `http.public_url` is required (startup error `config.public_url_required`); see [auth.md](auth.md#first-run-setup).

**Test hooks** (upstream `*_base_url` overrides, the debug no-op job route, fake clock) exist only when `mcm-server` is built with the `test-hooks` cargo feature, which release builds never enable. They are not config keys in release builds (unknown-key error).

## Example `mcm.toml`

```toml
data_dir = "/var/lib/mcm"

[http]
listen = "127.0.0.1:8420"
public_url = "https://mc.example.com"      # used for Origin checks, links in notifications
allow_insecure_http = false
trusted_proxies = ["127.0.0.1/32"]          # X-Forwarded-For honoured only from these
# [http.tls]  cert = "...", key = "..."      # optional built-in TLS

[log]
level = "info"
format = "auto"
# file = "/var/log/mcm/mcm.log"

[process]
default_stop_timeout_s = 60
autostart_stagger_s = 5
console_ring_lines = 5000
console_ring_bytes = 4194304
port_range = [25565, 25665]                 # auto-assigned game ports
rcon_port_range = [25575, 25675]
start_timeout_s = 600
import_roots = []                           # dirs admins may import existing servers from (P1)
default_runtime = "native"                  # native | shim | docker (P10)

[security]
allow_private_targets = false               # allow webhooks/URL fetches to private IPs (T12)

[cache]
max_bytes = 10737418240                     # download cache LRU cap (10 GiB)

[java]
allow_system_java = true                    # detect java on PATH / JAVA_HOME / common dirs

[integrations]
curseforge_api_key = ""                     # env: CHUNKYARD_INTEGRATIONS__CURSEFORGE_API_KEY (the only env name)
user_agent_contact = "admin@example.com"    # appended to User-Agent (Modrinth/Paper etiquette)

[limits]
max_upload_bytes = 21474836480              # 20 GiB
max_archive_uncompressed_bytes = 21474836480
max_servers = 100
max_total_memory_mb = 0                     # 0 = unlimited (the single default); cap on the sum of memory_max_mb of running servers (enforced P10)

[router]                                    # phase 7
listen = ""                                 # e.g. "0.0.0.0:25565"; empty = disabled

[portmap]                                   # phase 7
enabled = false

[backup]                                    # phase 6
default_target = "local"
compression_level = 3                       # zstd

[metrics]                                   # phase 5
sample_interval_s = 10
```

## Phase-owned sections

The example above shows base keys. Each phase's `api.md` defines the full key list for its section; `Config` gains those fields when the phase lands.

| Section | Defined in |
|---|---|
| `[integrations]` (test-only `*_base_url` overrides exist only with the `test-hooks` feature) | phases 3, 4 |
| `[metrics]` (`tps_interval_s`, `disk_walk_interval_s`, `prometheus`, `player_session_retention_days`, `max_concurrent_probes`) | [phase 5 api](../phases/05-monitoring/api.md) |
| `[backup]` (`max_concurrent`, `restore_keep_previous_h`, `retention_sweep_cron`, `compression_level`) | [phase 6 api](../phases/06-backups-scheduler-worlds/api.md) |
| `[router]`, `[portmap]` (listen, limits, timeouts, trusted CIDRs, port mapping) | [phase 7 api](../phases/07-network-exposure/api.md) |
| `[relay_client]` | [phase 9 api](../phases/09-relay/api.md) |
| `[docker]`, `[shim]`, `[cgroup]` | [phase 10 api](../phases/10-isolation-limits/api.md) |
| `[agent]`, `[primary]` (post-1.0) | [phase 11 api](../phases/11-multi-node/api.md) |

## Runtime settings (`settings` table)

| Key | Type | Phase |
|---|---|---|
| `integrations.curseforge_api_key` | encrypted string | 4 |
| `ui.instance_name` | string | 0 |
| `security.require_2fa_for_admins` | bool | 8 |
| `audit.retention_days` | int | 8 |

Env/config values override DB settings and are shown read-only in the UI with "set by environment".

## CLI

```
mcm serve                  # default
mcm openapi                # print OpenAPI JSON
mcm config check
mcm user reset-password <username>   # offline recovery, prints a temp password
mcm migrate                # run migrations and exit
mcm version
```
