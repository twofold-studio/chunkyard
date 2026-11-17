# Phase 9 — Test plan

Kinds: U unit, P property, I crate integration, A API integration (`chunkyard-api-tests`, `TestApp`), C component, E E2E, F fuzz, S soak. Backends are `fake-mc-server` instances ([fake-server.md](../../testing/fake-server.md)); relay integration tests start an in-process relay built from the `chunkyard-relay` crate's library target on `127.0.0.1:0` ports. Pure-logic tests (backoff math, frame codec) may use paused time/`FakeClock`; socket tests use real time with short configured timeouts (e.g. 200 ms heartbeat, 300 ms Hello timeout via test config).

## chunkyard-tunnel-proto

| Test | Location | FR | Kind |
|---|---|---|---|
| `frame_vectors_snapshot` (all variants, insta hex) | `tests/vectors.rs` | 04 | U |
| `frame_rejects_zero_and_oversize_len` | `src/codec.rs` | 04 | U |
| `frame_rejects_trailing_bytes_and_unknown_variant` | `src/codec.rs` | 04 | U |
| `stream_open_rejects_prebuffered_len_over_2048` | `src/codec.rs` | 06 | U |
| `control_roundtrip` | `src/codec.rs` | 04 | P |
| `tunnel_frame_decode` | `fuzz/fuzz_targets/tunnel_frame_decode.rs` | 04 | F |
| `pairing_string_parse_valid_and_invalid` (scheme, host, fp format, token prefix, missing fp = CA mode) | `src/pairing.rs` | 02, 10 | U |
| `pairing_string_roundtrip` | `src/pairing.rs` | 02, 10 | P |

## chunkyard-relay

| Test | Location | FR | Kind |
|---|---|---|---|
| `init_creates_config_db_cert_and_refuses_rerun` | `tests/cli.rs` | 01 | I |
| `agent_add_prints_pairing_with_matching_fingerprint` | `tests/cli.rs` | 02 | I |
| `agent_token_stored_hashed_only` | `tests/cli.rs` | 02 | I |
| `agent_set_applies_live_via_admin_socket` | `tests/cli.rs` | 02 | I |
| `tls_rejects_tls12_and_wrong_alpn` | `tests/session.rs` | 03 | I |
| `hello_with_valid_token_gets_assignment` | `tests/session.rs` | 03, 04 | I |
| `hello_with_revoked_token_rejected` | `tests/session.rs` | 03, 07 | I |
| `hello_timeout_closes` (300 ms configured) | `tests/session.rs` | 03 | I |
| `version_negotiation_picks_highest_common_or_errors` | `tests/session.rs` | 04 | I |
| `second_session_replaces_first_with_goaway` | `tests/session.rs` | 03 | I |
| `announce_outside_assignment_rejected` | `tests/session.rs` | 04 | I |
| `announce_duplicate_hostname_across_agents_rejected` | `tests/session.rs` | 04 | I |
| `heartbeat_missing_closes_session` | `tests/session.rs` | 04 | I |
| `shared_listener_routes_by_hostname_to_agent` | `tests/routing.rs` | 05, 06 | I |
| `shared_listener_normalizes_fml_marked_hostname` | `tests/routing.rs` | 05 | I |
| `dedicated_port_listener_opens_on_announce_closes_on_withdraw` | `tests/routing.rs` | 05 | I |
| `no_agent_status_returns_offline_motd` | `tests/routing.rs` | 05 | I |
| `stream_open_carries_client_addr_and_prebuffered_bytes` | `tests/routing.rs` | 06 | I |
| `max_streams_per_agent_enforced` | `tests/limits.rs` | 06 | I |
| `bandwidth_bucket_limits_throughput` | `tests/limits.rs` | 06 | I |
| `per_ip_connection_and_rate_limits` | `tests/limits.rs` | 08 | I |
| `revoke_disconnects_within_10s_and_closes_streams` | `tests/session.rs` | 07 | I |
| `rotate_token_old_session_goaway_revoked` | `tests/session.rs` | 07 | I |
| `auth_failures_block_ip` | `tests/session.rs` | 08 | I |
| `relay_never_dials_except_probe` (outbound connect hook counts dials) | `tests/hardening.rs` | 08 | I |
| `no_tokens_in_relay_logs` | `tests/session.rs` | 08 | I |
| `admin_http_requires_bearer_and_reports_status` | `tests/admin.rs` | 09 | I |
| `status_cli_reads_admin_socket` | `tests/admin.rs` | 09 | I |
| `probe_only_targets_agent_source_ip` | `tests/probe.rs` | 14 | I |
| `probe_rate_limited_per_agent` | `tests/probe.rs` | 14 | I |
| `relay_soak_500_players_10min` | `benches/soak.rs` (nightly) | 06 | S |

## chunkyard-tunnel (agent; against an in-process relay)

| Test | Location | FR | Kind |
|---|---|---|---|
| `backoff_sequence_bounds_with_jitter` (pure, FakeClock) | `src/backoff.rs` | 11 | U |
| `tunnel_fingerprint_mismatch_stops_retrying` | `tests/tunnel.rs` | 11 | I |
| `tunnel_pinned_verifier_still_checks_signatures` (cert with mismatched key) | `tests/tunnel.rs` | 11 | I |
| `tunnel_reconnects_after_relay_restart` (real time, `reconnect_max_s = 1`) | `tests/tunnel.rs` | 11 | I |
| `tunnel_reannounces_on_route_change` | `tests/tunnel.rs` | 11, 13 | I |
| `tunnel_end_to_end_player_reaches_backend_with_real_ip` (fake player → relay → agent → router handler → fake-mc with PROXY; control log shows client addr) | `tests/tunnel.rs` | 06, 12 | I |
| `tunnel_stream_wake_on_join_works_with_router_disabled` (fake `ServerService`) | `tests/tunnel.rs` | 12 | I |
| `tunnel_rejected_announce_sets_route_state` | `tests/tunnel.rs` | 13 | I |
| `tunnel_route_without_proxy_reports_real_ip_hidden` | `tests/tunnel.rs` | 15 | I |

## chunkyard-router (P9 additions)

| Test | Location | FR | Kind |
|---|---|---|---|
| `exposure_includes_relay_entry_with_health` | `src/exposure.rs` | 15 | U |
| `router_only_route_valid_with_relay_and_no_listener` | `src/validate.rs` | 13 | U |

## chunkyard-api-tests (`crates/api-tests/tests/p9_relays.rs`)

| Test | FR | Kind |
|---|---|---|
| `relays_admin_only_and_token_needs_admin_scope` | 10 | A |
| `relays_add_with_pairing_never_returns_token` | 10 | A |
| `relays_invalid_pairing_422_names_part` | 10 | A |
| `relays_delete_unbinds_routes` | 10, 13 | A |
| `relays_mutations_audited_relay_connection_actions` | 10 | A |
| `relay_token_encrypted_with_row_aad` (swap ciphertext between rows → decrypt fails) | 10 | A |
| `no_secrets_in_logs_relay_token` | 10 | A |
| `routes_relay_binding_requires_admin` | 13 | A |
| `routes_relay_not_found_422` | 13 | A |
| `ws_network_relay_status_admin_only` | 11 | A |
| `portmap_probe_audited_and_409_without_relay` | 14 | A |
| `exposure_lists_relay_entry` | 15 | A |

## Frontend (Vitest)

| Test | File | FR | Kind |
|---|---|---|---|
| `parsePairing › valid / missing fp / bad scheme / bad token` | `features/relays/pairing.test.ts` | 10 | U |
| `AddRelayDialog › parses pairing preview and masks token` | `features/relays/components/AddRelayDialog.test.ts` | 10 | C |
| `RelayTable › status badge and counters update from ws` | `RelayTable.test.ts` | 11 | C |
| `RelaysEmptyState › links to alternatives guide` | `RelaysEmptyState.test.ts` | 16 | C |
| `RouteDialog › relay binding admin-only and port options from assignment` | `features/network/components/RouteDialog.test.ts` | 13 | C |
| `PortMappingTable › probe enabled only with connected relay` | `features/portmap/components/PortMappingTable.test.ts` | 14 | C |

## E2E (Playwright)

| Spec › test | US / FR |
|---|---|
| `p9-relay.spec.ts › start chunkyard-relay binary, add agent via CLI, paste pairing, status-ping and join through relay hostname` | US-01, US-03 / 01–06, 10–13 |
| `p9-relay.spec.ts › revoke agent shows error status in UI` | US-02 / 07, 11 |
| `p9-relay.spec.ts › exposure card lists relay address` | US-03 / 15 |
| `p9-relay.spec.ts › relays empty state links to alternatives docs` | US-05 / 16 |

US-04 (probe) is covered by `chunkyard-relay` and `chunkyard-api-tests` probe tests; no real gateway exists in CI.
