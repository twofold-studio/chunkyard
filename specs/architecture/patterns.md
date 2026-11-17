# Patterns (binding for all phases)

Every phase spec assumes these. Reviewers reject code that deviates without updating this file first.

## 1. Errors

| Layer | Rule |
|---|---|
| Library crates | One `thiserror` enum per crate (or per module when large): `pub enum FsError { #[error("path escapes sandbox")] Escape, ... }`. No `anyhow`, no `Box<dyn Error>` in public signatures, no `String` errors. |
| Cross-crate | Each non-leaf crate error implements `chunkyard_core::error::Classify` → `ErrorKind { Invalid, Unauthorized, Forbidden, NotFound, Conflict, PreconditionFailed, PreconditionRequired, TooLarge, InsufficientStorage, RateLimited, Unavailable, Upstream, UpstreamConfig, Internal }` plus a stable `code()` string (`"fs.escape"`, `"server.busy"`). **Leaf crates** (`chunkyard-protocol`, `chunkyard-tunnel-proto`, `chunkyard-shim`) are exempt: they don't depend on `chunkyard-core`; the consuming crate wraps their errors in its own variants and classifies them. |
| HTTP | `chunkyard-api::error::ApiError` is the **only** place errors become HTTP. `impl<E: Classify> From<E> for ApiError`. Mapping table lives in [errors-and-logging.md](errors-and-logging.md). |
| Panics | Never in request paths. `unwrap`/`expect` only in tests and `main` with a reason. |
| Context | Add context via enum variants with fields (`#[error("download {url} failed")] Download { url: Url, #[source] source: reqwest::Error }`), not string concatenation. |

## 2. IDs and newtypes

```rust
// core/src/ids.rs
macro_rules! id_type { ($name:ident, $prefix:literal) => { ... } }
id_type!(ServerId, "srv");   // stored as TEXT uuid v7; displayed raw
id_type!(UserId, "usr");
id_type!(JobId, "job");
```

- All entity IDs are UUIDv7 newtypes (`#[serde(transparent)]`, `sqlx::Type` via `#[sqlx(transparent)]` in `chunkyard-db` through a wrapper impl). Never pass raw `Uuid`/`String` across crate boundaries.
- Other newtypes: `Port(u16)`, `MemoryMb(u32)`, `McVersion(String)` (validated), `RelPath` (validated sandbox-relative path, see [security.md](security.md)), `Secret<String>` (redacted `Debug`, zeroized on drop).

## 3. Repository pattern

- **Repo traits live in `chunkyard-core::repo`** (`pub trait ServerRepo: Send + Sync { async fn get(&self, id: ServerId) -> Result<Option<Server>, RepoError>; ... }`), one per aggregate; `chunkyard-db` provides the `Sqlite*Repo` impls. Domain crates (`chunkyard-java`, `chunkyard-backup`, …) depend on the traits, never on `chunkyard-db`.
- Repos return **domain types** from `chunkyard-core`, not row structs. Row ↔ domain conversion is private to `chunkyard-db`.
- Transactions: `Db::tx(|tx| async { ... })` helper; repos expose `*_tx` variants that take `&mut Tx` only where a service needs atomic multi-repo writes.
- Queries use `sqlx::query_as!` (compile-time checked, offline data committed in `.sqlx/`).
- One migration file per change: `crates/db/migrations/<NNNN>_<desc>.sql`. **Numbers are not pre-allocated per phase**: `NNNN` is the next monotonic number, assigned when the change merges (a CI check rejects gaps and duplicates). Phase specs name migrations by description only (e.g. `p1_servers.sql` means `<NNNN>_p1_servers.sql`). Migrations are forward-only and never edited after release; each is tested by `migrations_apply_cleanly_from_previous_release`.

## 4. Services and dependency injection

- Business logic lives in **services**: structs in domain crates implementing traits declared in `chunkyard-core::services`. Any trait used across crates (`ServerService`, `ServerLookup`, `ServerCommandSink`, `CommandRunner`, `BackupService`, `JavaRuntimeRepo`, `PropertiesEditor`, …) **must** be in `chunkyard-core`, so a crate that needs another area's behaviour (scheduler → backup/process, proxy → server start/properties, installers → run installer jars) depends only on `chunkyard-core` and receives the impl via DI. Traits used only inside one crate stay there (e.g. `VersionMetaSource` in `chunkyard-java`, implemented by `chunkyard-installers` and injected at wiring time).
- `AppState` (in `chunkyard-api`) holds `Arc<dyn Trait>` for each service:

```rust
#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub auth: Arc<dyn AuthService>,
    pub servers: Arc<dyn ServerService>,
    pub files: Arc<dyn FileService>,
    pub jobs: Arc<dyn JobService>,
    pub events: EventBus,
    pub clock: Arc<dyn Clock>,
    // added by later phases
}
```

- `chunkyard-server::wiring::build_state(cfg) -> AppState` is the single composition root. `chunkyard-testkit::TestApp` calls the same function with overrides (`StateOverrides { adoptium: Some(fake), .. }`); override hooks compile only with the `test-hooks` feature.
- Handlers never touch repos directly; they call services.
- Time is injected (`Clock` trait: `now()`, `sleep()`), so scheduler/retention/rollup tests use `FakeClock`.
- Seams for later runtimes/nodes: services address servers only by `ServerId` through `ServerService`/`ProcessSpawner`; nothing outside `chunkyard-process`/`chunkyard-fs` builds a filesystem path to a server dir. This is the only P11 (multi-node) preparation required before 1.0.

## 5. Actor / handle pattern (per-server supervisor)

```
ServerHandle (Clone)             Supervisor task (owns state)
  cmd_tx: mpsc::Sender<Cmd>  ───▶  loop { select! { cmd, child exit, stdout line, cancel } }
  status: watch::Receiver<Status>
  console: broadcast::Sender<ConsoleLine>  (subscribe())
  ring: Arc<LogRing>
```

- Commands carry a `oneshot::Sender<Result<_, ProcessError>>` for replies. Bounded `mpsc` (capacity 32); callers `send().await` with a 5 s timeout → `Unavailable`.
- State is **only** mutated inside the actor loop. No `Mutex<State>` shared with handlers.
- `watch` for current status (latest-value semantics), `broadcast` for streams (lossy for slow consumers, which receive `Lagged(n)` and resync from the ring).
- The same pattern is used for: tunnel client, scheduler, metrics collector, McRouter, RCON connection.

## 6. Cancellation and shutdown

- Root `CancellationToken` in `main`; each subsystem gets `root.child_token()`; each job/connection gets a further child.
- Every `loop`/`select!` includes `_ = token.cancelled() => break`.
- `tokio::task::JoinSet` / `TaskTracker` per subsystem; shutdown awaits trackers with a deadline.
- No detached `tokio::spawn` without tracking, except fire-and-forget metrics with a comment.

## 7. Tracing

- `#[tracing::instrument(skip_all, fields(server_id = %id))]` on service methods; never log secrets (types wrapping secrets implement redacting `Debug`).
- Span names: `<crate>.<operation>` e.g. `process.start`, `installers.paper.download`.
- Levels: `error` = needs operator action; `warn` = degraded but handled; `info` = lifecycle events; `debug` = per-request detail; `trace` = protocol bytes.

## 8. Typed config

- Each crate defines its own sub-struct (`BackupConfig`, `RouterConfig`, …) with `Deserialize + Default`, `#[serde(deny_unknown_fields)]` and a `validate()`; `chunkyard-config` composes them into `Config` and runs all validations before startup.
- Crates receive **only their own sub-struct**, never the whole `Config`, and never depend on `chunkyard-config`.

## 9. Rust module layout and naming

- Prefer `foo.rs` + `foo/` directory over `foo/mod.rs` (2018-style). `lib.rs` contains only `mod` declarations and re-exports.
- One concept per file: `supervisor.rs`, `log_ring.rs`, `spawn.rs`. Rust source and test files have a 400-line review budget, enforced by `scripts/check-architecture.mjs`; exceptions need a reason and explicit budget in `scripts/architecture-policy.json`. Static schemas are excluded. Extract cohesive responsibilities with their tests; do not compress code or hide tests to meet the limit.
- Naming: traits are nouns (`Installer`, `StorageTarget`); impls prefixed with backend (`PaperInstaller`, `S3Storage`); async fns are verbs; DTOs suffixed `Dto` only when a domain type of the same name exists (`ServerDto`), requests `CreateServerRequest`, responses `…Response`.
- Errors `<Crate>Error`, events `Event::ServerStatusChanged { .. }` (past tense).
- External API clients: `<vendor>/client.rs` (trait + reqwest impl), `<vendor>/model.rs` (serde types, `#[serde(rename_all = "camelCase")]` as the API dictates; unknown fields ignored).

## 10. Test layout (Rust)

- Unit tests inline: `#[cfg(test)] mod tests` at the bottom of each file.
- Integration tests per crate in `crates/<crate>/tests/<area>.rs`; shared helpers in `tests/common/mod.rs`.
- HTTP/WS-level tests live in **`crates/api-tests/tests/`**, grouped under `contracts`, `instances`, `streams` and `storage` entry points with shared `tests/common::TestApp` fixtures. Real Docker checks remain separate targets. The older phase plans describe proposed filenames and a testkit crate; that crate is not part of the implemented workspace.
- **Time in tests**: `tokio::time::pause()` / `FakeClock` only for pure-logic tests (backoff calculation, cron, retention, rollups, actor logic with a fake spawner). Tests that run real processes (fake-mc-server) use real time with short configured timeouts (e.g. `stop_timeout_s = 2`) and `wait_until` polling — never paused time.
- Test names: `<unit>_<condition>_<expected>`, e.g. `resolve_dotdot_outside_root_is_rejected`. Phase test plans use these exact names.
- Recorded fixtures: `crates/<crate>/tests/fixtures/<vendor>/<endpoint>.json`.
- Snapshot tests via `insta` for OpenAPI output, generated command lines, and parsed protocol responses.

## 11. Frontend conventions

```
web/src/
├── routes/                       # pages ONLY: load data via feature api, render feature components
├── lib/
│   ├── api/                      # generated: schema.d.ts (openapi-typescript) + client.ts (openapi-fetch instance)
│   ├── ws/                       # single multiplexed WS client (connection, topic subscriptions, reconnect)
│   ├── components/ui/            # shadcn-svelte generated components (do not hand-edit except via CLI updates)
│   ├── components/               # app-wide composites (PageHeader, ConfirmDialog, DataTable)
│   ├── features/<feature>/
│   │   ├── components/           # Svelte components for this feature
│   │   ├── api.ts                # typed wrappers over the generated client
│   │   └── *.svelte.ts           # stores/state using runes ($state, $derived) — class-based
│   └── utils/
```

- **Runes only**: no `svelte/store` writables in new code; shared state is a class in `*.svelte.ts` with `$state` fields, exported as a context or module singleton.
- **No business logic in `routes/`**: `+page.svelte` composes feature components; `+page.ts` calls `features/*/api.ts`.
- All HTTP through `lib/api/client.ts`; never `fetch` directly (except file streaming helpers in `features/files/api.ts`).
- Forms: `sveltekit-superforms` is **not** used (SPA, no server actions); use `zod` schemas derived from OpenAPI types via hand-written schemas co-located in `features/<f>/schema.ts`.
- Test files co-located: `Component.test.ts` next to `Component.svelte`, `foo.svelte.test.ts` for rune modules.
- `data-testid` only where role/label queries are impossible.

## 12. Audit actions

- One catalog: `chunkyard_core::audit::Action`, an enum with `as_str()` giving dot-separated, lowercase, `<area>.<object>.<verb>` or `<area>.<verb>` names (`auth.login`, `server.start`, `server.properties.update`, `files.write`, `console.command`, `backup.restore`). Phase specs reference names from this catalog; a test (`audit_catalog_names_are_unique_and_well_formed`) enforces format and uniqueness, and the catalog is exported in OpenAPI as an enum.
- `details` is built from an **explicit per-action field allow-list** (`AuditDetails::builder().field("keys", …)`); arbitrary request bodies are never serialized into the audit log. See [audit.md](audit.md).

## 13. Definition of a "feature" in a phase spec

Each FR in a phase names: crate(s) touched, API endpoints, events emitted, audit action (from the catalog), permission required, and test names. Phase `tests.md` lists every test with its crate and FR mapping.
