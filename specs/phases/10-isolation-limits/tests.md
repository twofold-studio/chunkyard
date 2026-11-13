# Phase 10 — Test plan

Kinds: U unit, P property, I integration (crate), A API (`crates/mcm-api-tests/tests/p10_*.rs` via `TestApp`), D Docker-gated (`CHUNKYARD_TEST_DOCKER=1`; runs in the `docker-integration` merge-queue job, [ci.md](../../testing/ci.md#merge-queue)), G cgroup-gated (`CHUNKYARD_TEST_CGROUPS=1`, runner whose test scope has `Delegate=yes`), C component, E E2E. Tests with real processes (fake-mc, shim, containers) use real time with short timeouts; paused time only for pure logic.

## Test infrastructure

- `fake-mc-server` built for `x86_64-unknown-linux-musl` so the FakeJre (`bin/java` → fake) runs inside the runtime image mounted at `/opt/java`.
- `mcm-testkit::docker::TestDocker` — skips with a visible `SKIPPED` unless `CHUNKYARD_TEST_DOCKER=1`; builds `docker/runtime.Dockerfile` as `mcm-runtime:test`; all objects labelled `mcm.test_run=<uuid>` and removed on drop.
- `mcm-testkit::cgroup::TestCgroup` — skips unless `CHUNKYARD_TEST_CGROUPS=1`; CI runs the suite inside a delegated transient system scope created by the runner setup (not by mcm).
- `FakeDockerApi` (trait `DockerApi` over the bollard calls used) for spec-building and adoption logic without a daemon.
- `mcm-testkit::spawner_conformance::run_all(spawner)` — phase 1 lifecycle scenarios parameterised over spawners.

## mcm-shim

| Test | Location | FR | Kind |
|---|---|---|---|
| `frame_roundtrip_all_messages` | `mcm-shim/src/proto.rs` | 05 | U |
| `frame_decode_never_panics` | `mcm-shim/src/proto.rs` | 05 | P |
| `log_offsets_monotonic_across_rotation` | `mcm-shim/src/log.rs` | 06 | U |
| `replay_since_rotated_offset_reports_gap` | `mcm-shim/src/log.rs` | 06 | U |
| `peer_with_other_uid_rejected` (socketpair with forged cred via test hook, or skipped when not root) | `mcm-shim/tests/peercred.rs` | 05 | I |
| `socket_created_with_mode_0600` | `mcm-shim/tests/socket.rs` | 05 | I |
| `slow_client_never_blocks_child_output` (fake-mc `flood_lines_per_sec`, client not reading) | `mcm-shim/tests/backpressure.rs` | 06 | I |
| `exit_without_client_writes_exit_json_and_waits_for_ack` | `mcm-shim/tests/exit.rs` | 07 | I |
| `signal_term_reaches_java_process_group` (fake-mc `spawn_child`) | `mcm-shim/tests/signals.rs` | 07 | I |
| `shim_sigkill_sends_sigterm_to_java_via_pdeathsig` | `mcm-shim/tests/signals.rs` | 07 | I |
| `hello_version_negotiation_lowest_common` | `mcm-shim/src/proto.rs` | 08 | U |

## mcm-process

| Test | Location | FR | Kind |
|---|---|---|---|
| `conformance_native_spawner` / `conformance_shim_spawner` | `mcm-process/tests/conformance.rs` | 01 | I |
| `conformance_docker_spawner` | `mcm-process/tests/conformance.rs` | 01 | D |
| `shim_path_ownership_checked` (group-writable binary → unavailable) | `mcm-process/src/shim/locate.rs` | 04 | U |
| `shim_spawned_with_setsid_and_without_pdeathsig` (shim survives its spawning thread and a simulated mcm exit) | `mcm-process/tests/shim_spawn.rs` | 04 | I |
| **`shim_server_survives_mcm_restart_and_console_resumes`** (start via ShimSpawner, drop registry/kill test mcm process, new registry adopts, replayed lines present, new commands work, epoch changed → `reset`) | `mcm-process/tests/shim_adopt.rs` | 08, 09 | I |
| `shim_adopt_rejects_server_id_mismatch` / `shim_adopt_pid_mismatch_marks_unknown` | `mcm-process/tests/shim_adopt.rs` | 08 | I |
| `shim_adopt_records_exit_from_exit_json` | `mcm-process/tests/shim_adopt.rs` | 08 | I |
| `shutdown_leaves_shim_running_by_default` | `mcm-process/tests/shim_adopt.rs` | 09 | I |
| `container_spec_has_hardening_flags` | `mcm-process/src/docker/spec.rs` | 13 | U |
| `container_spec_binds_only_server_and_jre_dirs` | `mcm-process/src/docker/spec.rs` | 13 | U |
| `container_spec_name_and_labels_include_server_and_instance_id` | `mcm-process/src/docker/spec.rs` | 12 | U |
| `container_spec_publishes_game_port_loopback_when_router_only` | `mcm-process/src/docker/spec.rs` | 15 | U |
| `container_spec_never_publishes_rcon_query_or_management` | `mcm-process/src/docker/spec.rs` | 15 | U |
| `uid_mapping_rootful_uses_mcm_uid` / `uid_mapping_rootless_uses_root` / `userns_remap_refused_by_default` | `mcm-process/src/docker/uid.rs` | 14 | U |
| `docker_api_version_below_1_41_reported_unavailable` | `mcm-process/src/docker/connect.rs` | 10 | U |
| `effective_memory_limit_formula` (1024→1536, 4096→5120, 8192→10240, override) | `mcm-process/src/limits.rs` | 26 | U |
| `effective_memory_limit_monotonic` | `mcm-process/src/limits.rs` | 26 | P |
| `cpu_percent_from_stats_delta` (recorded stats fixtures) | `mcm-process/src/docker/stats.rs` | 20 | U |
| `docker_adopt_running_ignores_foreign_instance` (FakeDockerApi) | `mcm-process/tests/docker_adopt_fake.rs` | 18 | I |
| `docker_adopt_removes_containers_of_deleted_servers` | `mcm-process/tests/docker_adopt_fake.rs` | 18 | I |
| `docker_replay_dedups_by_timestamp` / `replay_gap_inserts_output_lost_line` | `mcm-process/src/docker/replay.rs` | 18 | U |
| `host_path_translation_maps_data_dir_prefix` / `..._rejects_outside_data_dir` | `mcm-process/src/docker/paths.rs` | 21 | U |
| `cgroup_mode_detection_from_fixture_trees` (delegated vs none; no systemd-user branch) | `mcm-process/src/platform/cgroup.rs` | 22 | U |
| `cgroup_limit_files_rendered` (`cpu.max "150000 100000"` for 1.5 cores, etc.) | `mcm-process/src/platform/cgroup.rs` | 23 | U |
| `oom_kill_delta_parsed_from_memory_events` | `mcm-process/src/platform/cgroup.rs` | 23, 29 | U |
| `global_memory_guard_unlimited_when_zero` / `global_memory_guard_rejects_over_commit` / `global_memory_guard_concurrent_starts_serialized` | `mcm-process/tests/registry_limits.rs` | 27 | I |
| `oom_exit_counts_as_crash_for_restart_policy` (fake spawner, FakeClock) | `mcm-process/src/supervisor.rs` | 29 | U |

## Docker-gated (`mcm-process/tests/docker_*.rs`)

| Test | FR | Kind |
|---|---|---|
| `docker_start_ready_stop_graceful` | 12, 16, 17 | D |
| `docker_console_output_not_lost_before_attach` | 16 | D |
| `docker_stderr_demuxed_to_stderr_stream` | 16 | D |
| `docker_attach_drop_reconnects` | 16 | D |
| `docker_stop_escalates_to_sigterm_then_kill` | 17 | D |
| `docker_oom_killed_reported` | 17, 29 | D |
| `docker_inspect_matches_hardening` (CapDrop, ReadonlyRootfs, SecurityOpt, Memory==MemorySwap, PidsLimit, NanoCpus) | 13, 26 | D |
| `docker_file_ownership_matches_mcm_uid` | 14 | D |
| `docker_rcon_reachable_via_mcm_net_not_host` | 15 | D |
| `docker_server_survives_mcm_restart_and_console_resumes` | 18, 19 | D |
| `docker_daemon_unavailable_marks_unknown` (nonexistent socket; not gated) | 18, 29 | I |
| `docker_name_conflict_not_removed` | 12 | D |
| `docker_pull_job_reports_progress` (local `registry:2`) | 11 | D |
| `docker_stats_feed_metrics` | 20 | D |
| `mcm_in_container_path_translation_probe` (nightly) | 21 | D |

## cgroup-gated (`mcm-process/tests/cgroup_*.rs`)

| Test | FR | Kind |
|---|---|---|
| `cgroup_delegated_limits_applied` (native and shim children) | 22, 23 | G |
| `cgroup_oom_detected_native` | 23, 29 | G |
| `cgroup_kill_reaches_setsid_escapee` | 24 | G |
| `cgroup_stats_used_when_available` | 25 | G |
| `cgroup_none_mode_starts_with_warning` (default runner) | 22 | I |

## API (`mcm-api-tests`)

| Test | File | FR | Kind |
|---|---|---|---|
| `isolation_capabilities_admin_only` / `isolation_reports_none_without_docker` | `p10_isolation.rs` | 03 | A |
| `runtime_change_while_running_409` / `runtime_change_to_docker_without_docker_424` / `runtime_change_to_shim_without_binary_424` | `p10_isolation.rs` | 02 | A |
| `runtime_change_to_native_with_user_file_write_grant_409` (grant created while docker via fake spawner) | `p10_isolation.rs` | 02 | A |
| `runtime_change_audited` | `p10_isolation.rs` | 02 | A |
| `limits_fields_admin_only_on_patch` | `p10_isolation.rs` | 26 | A |
| `start_over_memory_budget_409_audited` | `p10_isolation.rs` | 27 | A |
| `disk_quota_warning_and_exceeded_events` (fake disk sampler) | `p10_isolation.rs` | 28 | A |
| `enforced_disk_quota_blocks_upload_507` | `p10_isolation.rs` | 28 | A |
| `system_memory_reports_committed_and_unlimited_zero` | `p10_isolation.rs` | 27 | A |
| `native_shim_docker_native_switch_preserves_files` | `p10_isolation_docker.rs` | 02 | D |

## Frontend

| Test | File | FR | Kind |
|---|---|---|---|
| `RuntimeSelector › unavailable runtimes disabled; all disabled when running` | `features/isolation/components/RuntimeSelector.test.ts` | 02 | C |
| `RuntimeSelector › switching to native shows trust warning` | same | 02 | C |
| `LimitsForm › validation vectors from testdata/validation/limits.json` | `features/settings/components/LimitsForm.test.ts` | 26 | C |
| `effectiveMemoryLimit › matches Rust table` | `features/settings/limits.test.ts` | 26 | U |
| `QuotaBar › colour thresholds` | `features/isolation/components/QuotaBar.test.ts` | 28 | C |
| `MemoryCommittedMeter › hidden when unlimited` | `MemoryCommittedMeter.test.ts` | 27 | C |
| `IsolationStatusCard › renders warnings` | `IsolationStatusCard.test.ts` | 03 | C |

## E2E

| Spec | Scenario | FR / US |
|---|---|---|
| `p10-isolation.spec.ts › capabilities page shows cgroup none on CI` | default runner | 03 |
| `p10-isolation.spec.ts › memory budget dialog` | `max_total_memory_mb` set low; second start shows dialog | 27 / US-10.5 |
| `p10-shim.spec.ts › shim server survives mcm restart` | Create shim server, start, restart mcm binary, console live with "Re-attached" line | 08 / US-10.2 |
| `p10-docker.spec.ts › docker server survives mcm restart` (D, nightly) | Same for Docker | 18 / US-10.2 |
