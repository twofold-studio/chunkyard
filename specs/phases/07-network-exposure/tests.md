# Phase 7 — Test plan

Kinds: U unit, P property, I crate integration, A API integration (`mcm-api-tests`, `TestApp`), C component, E E2E, F fuzz, S soak/load. Backends are `fake-mc-server` instances (login → disconnect reason names the server; `--accept-proxy-protocol` / `proxy-protocol=true` parses a v2 header and echoes the client address; `LOCAL` headers are logged to the control channel) — see [fake-server.md](../../testing/fake-server.md).

Time: pure-logic tests (route table, renewal schedule, backoff math) may use `FakeClock`/paused time; tests with sockets or fake-mc use **real time** with short configured timeouts (e.g. a 200 ms handshake timeout and `lease_s = 2` via test config; durations are `Duration`-typed internally) and `wait_until` ([patterns.md §10](../../architecture/patterns.md#10-test-layout-rust)).

## mcm-protocol

| Test | Location | FR | Kind |
|---|---|---|---|
| `normalize_host_strips_fml_markers` (`\0FML\0`, `\0FML2\0`, `\0FML3\0`) | `src/handshake.rs` | 02 | U |
| `normalize_host_trailing_dot_port_and_case` | `src/handshake.rs` | 02 | U |
| `normalize_host_empty_and_nul_only` | `src/handshake.rs` | 02 | U |
| `handshake_parse_rejects_oversize_and_bad_next_state` | `src/handshake.rs` | 02 | U |
| `handshake_parse_never_panics` | `src/handshake.rs` | 02 | P |
| `handshake_parse` | `fuzz/fuzz_targets/handshake_parse.rs` | 02 | F |
| `legacy_kick_encoding_matches_vector` | `src/legacy.rs` | 07 | U |
| `proxy_v2_encode_ipv4_matches_spec_vector` | `src/proxy_v2.rs` | 09 | U |
| `proxy_v2_encode_ipv6_matches_spec_vector` | `src/proxy_v2.rs` | 09 | U |
| `proxy_v2_mapped_ipv4_encoded_as_ipv4` | `src/proxy_v2.rs` | 09 | U |
| `proxy_v2_mixed_families_encoded_as_ipv6` | `src/proxy_v2.rs` | 09 | U |
| `proxy_v2_authority_tlv_roundtrip` | `src/proxy_v2.rs` | 09 | U |
| `proxy_v2_local_header_is_exact_16_bytes` (`…0A 20 00 00 00`) | `src/proxy_v2.rs` | 09, 17 | U |
| `proxy_v2_decode_rejects_v1_and_oversize` | `src/proxy_v2.rs` | 10 | U |
| `proxy_v2_roundtrip` | `src/proxy_v2.rs` | 09, 10 | P |
| `proxy_v2_roundtrip` | `fuzz/fuzz_targets/proxy_v2_roundtrip.rs` | 09, 10 | F |
| `slp_client_with_proxy_local_writes_header_first` | `tests/slp.rs` | 17 | I |

## mcm-router

| Test | Location | FR | Kind |
|---|---|---|---|
| `route_table_exact_beats_wildcard` | `src/route_table.rs` | 04 | U |
| `route_table_wildcard_single_label_only` | `src/route_table.rs` | 04 | U |
| `route_table_longest_wildcard_wins` | `src/route_table.rs` | 04 | U |
| `route_table_fallback_then_unknown` | `src/route_table.rs` | 04 | U |
| `status_response_echoes_client_protocol` | `src/responses.rs` | 06 | U |
| `motd_is_json_escaped_not_component` | `src/responses.rs` | 06 | U |
| `validate_routes_proxy_with_direct_and_router_rejected` (table: create, update PROXY on, update exposure, add 2nd route) | `src/validate.rs` | 03, 18 | U |
| `exposure_warns_real_ip_hidden_without_proxy` | `src/exposure.rs` | 15, 19 | U |
| `backend_expects_proxy_only_when_route_enabled_and_config_applied` | `src/exposure.rs` | 17 | U |
| `router_routes_three_backends_by_hostname` | `tests/router.rs` | 01, 03, 05 | I |
| `router_forge_marked_handshake_routes_and_replays_marker` (fake-mc control log shows original address bytes) | `tests/router.rs` | 02, 05 | I |
| `router_handshake_split_across_segments` | `tests/router.rs` | 02 | I |
| `router_handshake_and_login_start_in_one_segment_replayed` | `tests/router.rs` | 05 | I |
| `router_handshake_timeout_closes_connection` (real time, 200 ms configured) | `tests/router.rs` | 02 | I |
| `router_oversize_frame_closed_and_counted` | `tests/router.rs` | 02, 13 | I |
| `router_unknown_host_status_and_pong` | `tests/router.rs` | 06 | I |
| `router_unknown_host_login_disconnect_json` | `tests/router.rs` | 06 | I |
| `router_offline_backend_returns_offline_motd` | `tests/router.rs` | 06 | I |
| `router_legacy_ping_kick_without_fallback` | `tests/router.rs` | 07 | I |
| `router_legacy_ping_spliced_to_fallback` | `tests/router.rs` | 07 | I |
| `router_idle_timeout_closes_both_sides` (real time, 300 ms configured) | `tests/router.rs` | 05 | I |
| `router_half_close_propagates` | `tests/router.rs` | 05 | I |
| `router_route_table_swap_keeps_existing_connections` | `tests/router.rs` | 04 | I |
| `router_stats_counts_connections_and_bytes` | `tests/router.rs` | 14 | I |
| `router_bind_failure_reported_mcm_keeps_running` | `tests/router.rs` | 01 | I |
| `router_sends_proxy_v2_with_client_addr` (fake-mc with PROXY) | `tests/router_proxy.rs` | 05, 09 | I |
| `router_inbound_proxy_from_trusted_sets_peer` | `tests/router_proxy.rs` | 10 | I |
| `router_inbound_proxy_from_untrusted_closed` | `tests/router_proxy.rs` | 10 | I |
| `router_trusted_peer_without_header_closed` | `tests/router_proxy.rs` | 10 | I |
| `router_proxy_local_command_keeps_socket_peer` | `tests/router_proxy.rs` | 10 | I |
| `route_health_sends_proxy_local_to_proxy_backend` (fake-mc with PROXY reachable; without LOCAL it would reject) | `tests/health.rs` | 16, 17 | I |
| `route_health_flag_follows_backend_slp` | `tests/health.rs` | 16 | I |
| `router_wake_on_join_starts_server_and_disconnects` (fake `ServerService`) | `tests/wake.rs` | 08 | I |
| `router_wake_on_status_ping_does_not_start` | `tests/wake.rs` | 08 | I |
| `router_wake_rate_limited_per_server_and_ip` | `tests/wake.rs` | 08 | I |
| `router_wake_skips_crash_loop_and_maintenance` | `tests/wake.rs` | 08 | I |
| `router_per_ip_concurrency_limit` | `tests/limits.rs` | 13 | I |
| `router_per_ip_rate_limit_token_bucket` | `tests/limits.rs` | 13 | I |
| `paper_global_yml_sets_proxy_protocol_key` | `src/backend_config.rs` | 11 | U |
| `paper_global_yml_missing_marks_pending_then_applies` (fake `ServerFileAccess`) | `tests/backend_config.rs` | 11 | I |
| `router_only_exposure_sets_server_ip_and_restores` (fake `PropertiesEditor`) | `tests/exposure.rs` | 12 | I |
| `router_1000_concurrent_connections_memory` | `benches/router_load.rs` (nightly) | 13 | S |

## Cross-crate PROXY `LOCAL` consumers

| Test | Crate / location | FR | Kind |
|---|---|---|---|
| `ready_slp_fallback_sends_proxy_local_when_backend_expects_proxy` (fake-mc with PROXY and no ready line) | `mcm-process/tests/ready.rs` | 17 | I |
| `slp_fallback_sends_proxy_local_when_backend_expects_proxy` | `mcm-metrics/tests/players.rs` | 17 | I |

## mcm-portmap

Fake gateways: `tests/support/fake_igd.rs` (SSDP responder + SOAP HTTP server with programmable errors 718/725) and `tests/support/fake_natpmp.rs` (UDP).

| Test | Location | FR | Kind |
|---|---|---|---|
| `classify_external_ip_table` (public, 100.64/10, RFC1918, 0.0.0.0, loopback) | `src/classify.rs` | 24 | U |
| `renewal_scheduled_at_half_lease` (FakeClock) | `src/schedule.rs` | 22 | U |
| `renewal_backoff_sequence_30s_to_5min` (FakeClock) | `src/schedule.rs` | 22 | U |
| `discover_prefers_upnp_then_natpmp` | `tests/portmap.rs` | 20 | I |
| `discover_none_when_no_gateway` | `tests/portmap.rs` | 20 | I |
| `upnp_add_mapping_and_external_ip` | `tests/portmap.rs` | 21, 24 | I |
| `upnp_conflict_718_returns_portmap_conflict` | `tests/portmap.rs` | 21 | I |
| `upnp_725_falls_back_to_permanent_lease` | `tests/portmap.rs` | 22 | I |
| `natpmp_add_mapping_uses_granted_lifetime` | `tests/portmap.rs` | 21, 22 | I |
| `natpmp_renews_before_expiry` (real time, granted lifetime 2 s) | `tests/portmap.rs` | 22 | I |
| `natpmp_epoch_reset_readds_mappings` | `tests/portmap.rs` | 22 | I |
| `renewal_failure_sets_last_error_and_emits_event` | `tests/portmap.rs` | 22 | I |
| `shutdown_removes_mappings_within_3s` | `tests/portmap.rs` | 23 | I |
| `startup_readds_enabled_mappings` | `tests/portmap.rs` | 23 | I |

## mcm-api-tests (`crates/mcm-api-tests/tests/`)

| Test | File | FR | Kind |
|---|---|---|---|
| `routes_crud_requires_proxy_manage` | `p7_routes.rs` | 03 | A |
| `routes_hostname_validation_vectors` | `p7_routes.rs` | 03 | A |
| `routes_hostname_unique_case_insensitive_409` | `p7_routes.rs` | 03 | A |
| `routes_proxy_with_direct_and_router_422` | `p7_routes.rs` | 18 | A |
| `routes_response_contains_real_ip_hidden_warning` | `p7_routes.rs` | 19 | A |
| `routes_mutations_audited_with_catalog_names` | `p7_routes.rs` | 03 | A |
| `routes_paper_proxy_enable_returns_restart_warning` | `p7_routes.rs` | 11 | A |
| `exposure_lists_lan_router_upnp_entries` | `p7_routes.rs` | 15 | A |
| `router_settings_admin_only_and_applied_live` | `p7_router.rs` | 04, 06, 10 | A |
| `ws_network_topic_streams_route_stats_filtered_by_visibility` | `p7_router.rs` | 14 | A |
| `portmap_endpoints_disabled_when_config_off` | `p7_portmap.rs` | 20 | A |
| `portmap_create_delete_audited` | `p7_portmap.rs` | 21 | A |
| `portmap_router_only_server_409` | `p7_portmap.rs` | 21 | A |

## Frontend (Vitest)

| Test | File | FR | Kind |
|---|---|---|---|
| `RouteDialog › validates hostname and wildcard` | `features/network/components/RouteDialog.test.ts` | 03 | C |
| `RouteDialog › PROXY toggle shows flavour-specific warning` | same | 11 | C |
| `RouteDialog › enabling PROXY forces router-only exposure` | same | 18 | C |
| `RouteDialog › wake on join shows warning` | same | 08 | C |
| `ExposureCard › renders entries with health, real-ip indicator and copy` | `ExposureCard.test.ts` | 15 | C |
| `RealIpBanner › shown only when a route lacks PROXY` | `RealIpBanner.test.ts` | 19 | C |
| `RouteTable › live stats update from ws` | `RouteTable.test.ts` | 14 | C |
| `PortmapCard › cgnat shows tunnelling guidance` | `features/portmap/components/PortmapCard.test.ts` | 24 | C |
| `McText › renders § codes as spans, escapes html` | `lib/components/McText.test.ts` | 06 | C |

## E2E (Playwright)

| Spec › test | US / FR |
|---|---|
| `p7-router.spec.ts › add two hostname routes; status-ping helper (e2e/support) gets each server's MOTD via router port` | US-01 / 01–06 |
| `p7-router.spec.ts › enable PROXY on paper fake; real IP in console join line; server still reaches Running (LOCAL probe)` | US-02 / 09, 11, 17 |
| `p7-router.spec.ts › PROXY toggle disables direct exposure option` | US-02 / 18 |
| `p7-router.spec.ts › wake on join starts stopped server` | US-03 / 08 |
| `p7-network.spec.ts › exposure card lists paths; real-IP banner shown on network tab and players panel` | US-06 / 15, 19 |

UPnP is not exercised in E2E (no gateway in CI); covered by `mcm-portmap` integration tests with fake gateways (US-04, US-05).
