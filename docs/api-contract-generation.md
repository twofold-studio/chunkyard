# REST contract generation

Axum remains the HTTP framework. Utoipa 5.4.0 and utoipa-axum 0.2.0 derive OpenAPI from the handlers registered by the production router. JSON responses use concrete serializable Rust DTOs, including envelopes and problem details. Handler annotations reference the same request and response DTOs; update status/media declarations when changing a handler's HTTP behavior.

After dependencies have been installed, generation is offline and needs no running manager, database, setup token, Docker engine, or Minecraft server:

```sh
cargo fetch --locked
pnpm --dir web install --frozen-lockfile
pnpm --dir web api:generate
pnpm --dir web api:check
pnpm --dir web api:test-types
pnpm --dir web check
```

The Rust exporter constructs only the route registry. It writes deterministic OpenAPI to crates/api/src/openapi.json. Hey API is pinned to 0.99.0 in the frontend manifest and lockfile. It reads this local document and generates the checked-in SDK in web/src/lib/api/generated. Explicit formatter configuration keeps regeneration identical in temporary directories and CI.

Frontend endpoint wrappers call generated SDK operations and re-export generated wire types. They do not supply generic response assertions. The transport retains relative same-origin fetch, credentials, CSRF, cancellation, SvelteKit fetch injection, and existing ApiError/auth-loss behavior. Raw uploads pass their original Blob through native fetch; downloads use native attachment URLs and WebSocket consumers retain native sockets.

CI compares a fresh Rust document and a temporary SDK against committed artifacts, then runs Svelte/TypeScript checking. Negative checks regenerate bindings after incompatible request and response schema mutations and require real caller code to fail tsc. Compile-only negative cases also run with the full frontend checker. A bundler success is insufficient: pnpm build runs the checker before Vite. Docker packaging first exports and compares the Rust contract, checks SDK drift, and runs that same checked frontend build.

HTTP contract tests validate actual successes and problem responses against the generated JSON Schemas, and retain the existing auth, Host, Origin, CSRF, routing, and local-reference tests. Their fixtures use temporary local state.

## Explicit coverage limits

- Job.result is deliberately unknown JSON because durable historical jobs contain different result shapes by job kind. Existing result readers validate the shape they consume; a change inside this field alone does not fail frontend checking.
- Minecraft whitelist/operator/ban entries preserve arbitrary native JSON. PlayerLists has concrete fields, but entries remain unknown and the display code narrows them at runtime.
- Installer providers still use JSON internally. Their HTTP boundary deserializes into concrete catalog/version/CurseForge DTOs before serialization; malformed internal data is rejected rather than given a permissive schema.
- Binary request/response bodies are documented as binary strings with concrete paths, query parameters, media types, and statuses. WebSocket upgrades are documented as 101; message protocols remain in their existing native consumers and are outside REST SDK typing.
- The OpenAPI document describes itself without a recursive JSON schema. MCP at /mcp remains its separate JSON-RPC protocol and is not presented as REST SDK coverage.
- Existing Axum path/query rejections can be plain text; their 400 responses are documented separately from application/problem+json errors.
- Schema generation enforces Rust field/type changes; it does not prove implementation semantics or validate every possible runtime response. Keep focused HTTP checks when changing behavior.
