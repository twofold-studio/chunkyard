# Phase 5 — Monitoring

## Goal

Show, live and historically, how each server and the host are doing: CPU, memory, disk, players, TPS/MSPT, uptime and availability — collected without polluting the console and without Java-side agents.

## Scope

| In | Detail |
|---|---|
| `chunkyard-metrics` crate | `MetricsCollector` actor, process-tree sampler (`/proc`, `sysinfo` fallback), disk walker, `TpsProbe` per flavor, rollups, retention |
| RCON | **First enabled in this phase** (managed keys appended to the P2 registry); one `RconActor` per running server; exposure check + warning; per-server `rconDisabled` |
| Management protocol | Vanilla 1.21.9+ JSON-RPC/WebSocket API on loopback: preferred source for players, sessions and allowlist |
| Players | Online list via management protocol → RCON `list` → SLP → Query; sessions from management notifications or flavour-aware anchored console matchers |
| Uptime & availability | Current uptime; availability % over 24 h / 7 d / 30 d from a state-history table |
| Host metrics | Host CPU %, memory, data-dir filesystem usage, load average |
| History | `metric_samples` at 10 s / 60 s / 3600 s with rollups and retention ([data-model.md](../../architecture/data-model.md#retention)) |
| Realtime | WS topics `metrics:<id>`, `players:<id>`, `host` |
| Prometheus | Optional `/metrics` endpoint, token-auth |
| UI | Overview cards, metrics page with LayerChart graphs and range selector, players panel, TPS gauge, host widget on dashboard |

## Non-goals

- JVM-internal metrics (heap, GC, threads) via JMX/agents — later, possibly via spark integration.
- Per-world/per-chunk/entity profiling (spark's job).
- Alerting rules (threshold notifications) — phase 8 notifications may consume events; generic alert rules are later.
- Network bandwidth per server (needs cgroups/eBPF; revisit in P10 with Docker stats).
- Long-term external TSDB; Prometheus endpoint is the integration point.

## User stories

| ID | Story |
|---|---|
| US-1 | On a server's overview I see CPU, RAM, disk, players online/max, TPS and uptime updating live. |
| US-2 | I open Metrics and view the last 24 h / 7 d / 30 d of CPU, RAM, TPS and players to find when lag started. |
| US-3 | I see who is online now and a history of player sessions (who joined when, for how long). |
| US-4 | I see each server's availability over the last 30 days. |
| US-5 | On the dashboard I see host CPU, memory and disk so I know if I can add another server. |
| US-6 | I scrape mcm with Prometheus using an API token. |
| US-7 | Monitoring never prints anything into my server console. |
| US-8 | If RCON is reachable from the internet I am warned and can turn it off with one click; monitoring keeps working via the management protocol or SLP. |

## Dependencies

| Phase | Needed for |
|---|---|
| [0](../00-foundation/README.md) | DB, settings, tokens (Prometheus), WS hub |
| [1](../01-lifecycle-console/README.md) | Supervisor status/pid/pgid, console line broadcast, `ServerStatusChanged` events |
| [2](../02-settings-files/README.md) | Managed-key registry (P2-FR-12) that P5 extends with RCON and `management-server-*` keys; secret-key redaction (P2-FR-32); allowlist endpoints that P5 routes through the management protocol |

Phase 3 is **not** required (flavor is known from phase 1's `servers.flavor`; `custom` gets RCON players only).

## Files

[requirements](requirements.md) · [api](api.md) · [ui](ui.md) · [tests](tests.md) · [collection-reference](collection-reference.md)

## Exit checklist

- [ ] All `P5-FR-*` implemented and mapped to tests in [tests.md](tests.md).
- [ ] fake-mc reports RSS/CPU, TPS, players; integration tests run collector end-to-end against it.
- [ ] TPS parser fixtures captured from real servers in the smoke suite for every flavor listed in [minecraft-protocols.md](../../architecture/minecraft-protocols.md#tps--mspt-probes-best-effort-via-rcon); unverified formats documented as such.
- [ ] Verified (smoke suite) that a full day of collection adds zero lines to the server console for vanilla and Paper (`smoke_paper_metrics_console_silent`).
- [ ] Rollup + retention proven with `FakeClock` (pure-logic) tests; DB size for 10 servers × 400 days estimated in docs.
- [ ] Management protocol verified against real vanilla ≥ 1.21.9 in the smoke suite (`smoke_vanilla_management_protocol_players`).
- [ ] Chat-spoof tests pass for every log family (join/leave/uuid).
- [ ] Fuzz target `tps_parse` clean.
- [ ] E2E for overview cards, metrics range switch, players panel.
- [ ] OpenAPI/TS regenerated.

## Open questions / to verify

| Topic | Question |
|---|---|
| RCON logging | Does Paper/Forge/vanilla log RCON-issued commands or connection lines to the console? (Vanilla logs `Thread RCON Client /127.0.0.1 started` per connection — we keep one persistent connection; verify) |
| TPS formats | `mspt`, `tick query`, `neoforge tps`, `spark tps` output — see [minecraft-protocols.md](../../architecture/minecraft-protocols.md#open-questions--to-verify) |
| Join/leave lines | Per-family prefixes — see [log-formats.md](../../architecture/log-formats.md#open-questions--to-verify); fixtures captured by `smoke_capture_log_fixtures` |
| Management protocol | Availability on Paper/Forge/NeoForge builds; whether fabric/quilt keep it (assumed yes, vanilla server code) |
