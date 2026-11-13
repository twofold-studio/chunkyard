# Phase 10 — UI

Feature dirs: `features/isolation` (new), `features/settings` (extended), `features/servers` (status). Conventions: [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions).

## Screens

| Route | Who | Content |
|---|---|---|
| `/admin/settings/isolation` | admin | Three cards. **Docker**: availability, version, rootless/userns flags, mcm-in-container + host data dir, runtime image (present/digest, "Pull image" → job toast), warnings. **Shim**: binary path/version, `KillMode` warning with docs link. **cgroups**: mode badge (`delegated` / `none`), controllers, `cgroup.kill`, reason text with a docs link explaining `Delegate=yes`. "Re-check" (`?refresh=true`). Host totals and committed-vs-max memory bar (hidden when max = 0 / unlimited). |
| `/servers/[id]/settings/runtime` | admin (others read-only) | Runtime radio: **Native** ("stops when mcm restarts"), **Shim** ("keeps running across mcm restarts"), **Docker** ("isolated container; required to delegate file/content/settings access to non-admins"). Unavailable options disabled with reason; control disabled while running ("Stop the server to change runtime"). Switching to Native/Shim shows `TrustWarning` (phase 8) and, on `409 server.runtime_grants_conflict`, the phase 8 `RuntimeConflictDialog`. Advanced: image override. Limits form: CPU cores slider (0.1 step, max host CPUs, "unlimited"), PIDs limit, memory overhead (live effective limit), disk quota + "Block writes when exceeded". Banner when limits are configured but not enforced. |
| `/servers/[id]` overview | view | Runtime chip (Native / Shim / Docker), "Adopted after restart" chip when `adopted`, `Unknown` badge with reason, OOM-killed exit with suggestion, disk quota bar (amber ≥ 90 %, red ≥ 100 %) |
| Dashboard | view | Runtime icon per card; admins see "Memory committed X / Y GiB" when a max is set |
| Start action | power | On `409 limits.memory_exceeded`: dialog with committed/max and running servers' limits |

## Components (new)

| Component | Notes |
|---|---|
| `IsolationStatusCard.svelte` | Generic capability card: title, badge, key/value list, warnings |
| `RuntimeSelector.svelte` | Props `{value, caps, running}`; descriptions above |
| `LimitsForm.svelte` | zod schema in `features/settings/schema.ts` mirroring `testdata/validation/limits.json` |
| `EffectiveMemory.svelte` | Uses `effectiveMemoryLimit()` from `features/settings/limits.ts` |
| `QuotaBar.svelte` | Thresholds 90/100 % |
| `MemoryCommittedMeter.svelte` | From `/system/memory`; renders nothing when `maxTotalMb = 0` |

## States

| Screen | Case | Display |
|---|---|---|
| Isolation | Docker unreachable | Red badge + reason + docs link |
| Isolation | `KillMode` would kill shims | Amber warning on the Shim card |
| Runtime tab | Image missing | Inline "Pull runtime image" button |
| Overview | `unknown` | Grey badge "Runtime unreachable"; power buttons disabled except Kill (503 until reachable) |
| Console | adopted | System line "Re-attached after mcm restart" after the replayed output |
