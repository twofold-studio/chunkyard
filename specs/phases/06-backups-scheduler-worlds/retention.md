# Phase 6 — Retention algorithm (GFS)

Pure function in `backup/src/retention.rs`:

```rust
pub struct RetentionPolicy { keep_last: Option<u32>, keep_daily: Option<u32>, keep_weekly: Option<u32>, keep_monthly: Option<u32>, tz: chrono_tz::Tz }
pub struct Candidate { id: BackupId, created_at: OffsetDateTime, locked: bool }
pub struct Decision { keep: Vec<BackupId>, delete: Vec<BackupId> }
pub fn decide(policy: &RetentionPolicy, candidates: &[Candidate]) -> Decision;
```

## Inputs

Candidates = backups of one (server, target) with `state = complete`. `running` and `failed` rows are never passed in.

## Algorithm

1. If all four `keep_*` are `None` → keep everything.
2. Sort candidates by `created_at` descending, ties broken by `id` descending (UUIDv7 ⇒ creation order). Result is independent of input order.
3. `keep = { locked candidates }`. Locked backups **do not consume** any slot below.
4. Let `U` = unlocked candidates in sorted order.
5. **last**: add the first `keep_last` of `U`.
6. **daily**: walk `U`; bucket key = local date in `tz` (`YYYY-MM-DD`). The first (newest) backup seen in each new bucket is kept, until `keep_daily` distinct buckets are taken.
7. **weekly**: same with ISO week key (`iso_year-Www`, weeks start Monday).
8. **monthly**: same with `YYYY-MM`.
9. A backup selected by several rules is kept once; rules are evaluated independently over the full `U` (a backup kept by `last` still occupies its day bucket — this is the restic/borg semantics).
10. `delete = U − keep`.

`None` for a rule means "rule not applied" (0 slots); `0` is equivalent to `None`.

## Examples

Policy `keep_last=2, keep_daily=3`, tz UTC. Backups (newest first):

| id | created_at | last | daily bucket | kept by |
|---|---|---|---|---|
| a | 11-10 22:00 | ✔ | 11-10 (1st) | last, daily |
| b | 11-10 04:00 | ✔ | 11-10 (dup) | last |
| c | 11-09 04:00 | | 11-09 (2nd) | daily |
| d | 11-08 04:00 | | 11-08 (3rd) | daily |
| e | 11-07 04:00 | | 11-07 (4th, over) | — delete |

Policy `keep_daily=7, keep_weekly=4, keep_monthly=6` with one backup per day at 04:00 for 120 days → keeps 7 most recent days, plus the newest backup of each of the 4 most recent ISO weeks (overlapping the dailies for the current week), plus the newest of each of the 6 most recent months; total ≤ 7 + 4 + 6 = 17, typically 13–15.

Locked: `keep_last=1`, backups `x (locked, newest)`, `y`, `z` → keep `x, y`; delete `z` (locked `x` does not use the single `last` slot).

Timezone: backup at `2026-03-29T23:30Z` with tz `Europe/Berlin` falls in bucket `2026-03-30` (UTC+2 after DST).

## Properties (proptest, `backup/src/retention.rs` tests)

| Property | Test name |
|---|---|
| Locked candidates are always in `keep` | `retention_locked_never_deleted` |
| `keep ∪ delete` = input, disjoint | `retention_partitions_input` |
| Output independent of input order | `retention_order_independent` |
| Idempotent: applying `decide` to `keep` deletes nothing | `retention_idempotent` |
| `|keep − locked| ≤ keep_last + keep_daily + keep_weekly + keep_monthly` | `retention_bounded_by_slots` |
| Newest unlocked candidate always kept when any rule ≥ 1 | `retention_newest_kept` |
