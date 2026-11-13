# Phase 10 — Test plan

Kinds: U unit, P property, I integration, A API (`TestApp`/`TestCluster`), C component, E E2E, F fuzz.

## Test infrastructure

- `mcm-testkit::TestCluster::spawn(n_agents)` — one primary `TestApp` + N in-process agents (`mcm agent` composition root with temp data dirs, `127.0.0.1:0`, generated certs), already paired. Helpers: `cluster.partition(node)` / `heal(node)` via a TCP proxy (`toxiproxy`-like in-process proxy in testkit) placed between primary and each agent; `cluster.restart_agent(node)`.
- Parameterised suites: phase 1 lifecycle, phase 2 files, phase 6 backup API tests are written against `trait ServerTarget { async fn create(&self, app) -> ServerId }` with impls `Local` and `Remote(node)`; macro `local_and_remote!` generates both variants.

## mcm-node

| Test | Location | FR | Kind |
|---|---|---|---|
| `pairing_string_parse_valid_and_invalid` | `mcm-node/src/pairing.rs` | 05 | U |
| `pairing_string_parse_never_panics` | `mcm-node/src/pairing.rs` | 05 | P |
| `fingerprint_verifier_accepts_pinned_rejects_other` | `mcm-node/src/tls.rs` | 05 | U |
| `proto_version_window_accepts_p_and_p_minus_1` | `mcm-node/src/version.rs` | 08 | U |
| `router_dispatches_by_node_id` (fake local + fake remote services) | `mcm-node/src/router.rs` | 09 | U |
| `remote_error_problem_passthrough_preserves_code` | `mcm-node/tests/client.rs` (wiremock agent) | 13 | I |
| `node_supervisor_marks_offline_after_30s_no_pong` (paused time) | `mcm-node/src/supervisor.rs` | 07 | U |
| `node_supervisor_reconnect_backoff` | `mcm-node/src/supervisor.rs` | 07 | U |
| `reconcile_pushes_newer_specs_and_reports_orphans_missing` | `mcm-node/src/reconcile.rs` | 11 | U |
| `stream_frame_roundtrip` (serde snapshot of each message) | `mcm-node/src/stream.rs` | 14 | U |
| `mirror_ring_serves_since_seq_locally` | `mcm-node/src/console.rs` | 15 | U |
| `console_upstream_unsubscribes_30s_after_last_subscriber` | `mcm-node/src/console.rs` | 15 | U |
| `migration_state_machine_rolls_back_before_commit` (each failure point) | `mcm-node/src/migrate.rs` | 20 | U |
| `port_allocation_respects_node_ranges_and_probe` | `mcm-node/src/ports.rs` | 22 | U |

## mcm-api::node / mcm-server (agent side)

| Test | Location | FR | Kind |
|---|---|---|---|
| `agent_init_writes_cert_token_and_prints_pairing` | `mcm-server/tests/agent_cli.rs` | 01 | I |
| `agent_rotate_token_invalidates_old` | `mcm-server/tests/agent_cli.rs` | 01 | I |
| `agent_serves_no_spa_no_api_v1` | `mcm-api/tests/node_agent.rs` | 02 | A |
| `agent_rejects_missing_or_wrong_token_401` | `mcm-api/tests/node_agent.rs` | 02 | A |
| `agent_binds_first_primary_rejects_second_403` | `mcm-api/tests/node_agent.rs` | 03 | A |
| `agent_rejects_stale_spec_rev_409` | `mcm-api/tests/node_agent.rs` | 10 | A |
| `agent_revalidates_sandbox_paths` (bypass primary, send `../` directly) | `mcm-api/tests/node_agent.rs` | 18, security | A |
| `agent_autostarts_from_local_specs_without_primary` | `mcm-server/tests/agent_autostart.rs` | 12 | I |
| `agent_secrets_not_persisted` (scan agent DB + logs for S3 secret after backup job) | `mcm-api/tests/node_agent.rs` | 24 | A |

## Cluster API (`mcm-api/tests/cluster_*.rs`, `TestCluster`)

| Test | FR | Kind |
|---|---|---|
| `node_add_with_pairing_string_online` | 05, 07 | A |
| `node_add_fingerprint_mismatch_409` / `node_add_unreachable_502` / `node_add_skewed_version_409` | 05, 08 | A |
| `node_delete_with_servers_409_force_ok` | 06 | A |
| `local_and_remote!(lifecycle_*)` — full phase 1 lifecycle suite on remote server | 09, 13, 14 | A |
| `local_and_remote!(files_*)` — phase 2 file suite incl. range download and chunked upload | 18, 19 | A |
| `local_and_remote!(backup_*)` — phase 6 backup suite with local target on node and memory-S3 | 24 | A |
| `remote_console_ws_from_browser_receives_lines_and_resume` | 14, 15 | A |
| `remote_audit_written_on_primary_only` | 04 | A |
| `partition_marks_unknown_and_503_then_heals_and_reconciles` | 07, 11, 12 | A |
| `schedule_on_offline_node_records_failed_and_notifies` | 12, 23 | A |
| `metrics_backfilled_after_partition` | 16 | A |
| `job_mirrored_and_cancel_forwarded` | 17 | A |
| `job_interrupted_when_agent_restarts_mid_job` | 17 | A |
| `migrate_local_to_remote_preserves_world_hash_and_changes_port` | 20, 22 | A |
| `migrate_partition_during_transfer_rolls_back` | 20 | A |
| `migrate_progress_reports_bytes_and_cancel` | 21 | A |
| `create_server_on_node_port_unique_per_node` (same port on two nodes OK; same node 409) | 22, 26 | A |
| `router_routes_hostname_to_remote_server` (phase 7 router + fake-mc login disconnect reason) | 25 | A |
| `version_matrix_agents_n_n1_n2` (agents built with `NODE_PROTO` override via test feature) | 08 | A |
| `migration_p10_null_node_port_uniqueness_enforced` | 22 | I (`mcm-db/tests/migrate.rs`) |

## Fuzz

| Target | Crate | FR |
|---|---|---|
| `pairing_parse` | mcm-node | 05 |
| `node_stream_frame_decode` | mcm-node | 14 |

## Frontend

| Test | File | FR | Kind |
|---|---|---|---|
| `parsePairing › extracts host and fingerprint; rejects malformed` | `features/nodes/pairing.test.ts` | 05 | U |
| `AddNodeDialog › maps error codes to messages` | `features/nodes/components/AddNodeDialog.test.ts` | 05 | C |
| `NodeSelect › disables offline and insufficient-memory nodes` | `NodeSelect.test.ts` | 26 | C |
| `NodeOfflineBanner › disables actions when node offline` | `NodeOfflineBanner.test.ts` | 12 | C |
| `MigrateDialog › same-node target disabled` | `MigrateDialog.test.ts` | 20 | C |
| `nodes.svelte › status updates from WS` | `features/nodes/nodes.svelte.test.ts` | 07 | U |

## E2E (`e2e/tests/p10-nodes.spec.ts`)

E2E launches primary + one agent binary (`MCM_BIN agent`) with temp dirs.

| Scenario | FR / US |
|---|---|
| Add node via pairing string; node online | 05, 07 / US-10.1 |
| Create server on node; start; console shows Done; send command | 09, 14 / US-10.2, 10.3 |
| Upload and edit a file on remote server | 18 / US-10.3 |
| Kill agent process → banner + disabled actions; restart agent → recovers | 12 / US-10.4 |
| Migrate server back to Local | 20 / US-10.5 |
