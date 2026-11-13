# Frontend tests

## Tooling

| Tool | Use |
|---|---|
| Vitest (jsdom env for components, node env for pure TS) | Unit + component tests |
| `@testing-library/svelte` (Svelte 5 compatible) + `@testing-library/user-event` + `@testing-library/jest-dom` | Component tests |
| MSW (`msw/node`) | Mock HTTP for components that call the API client; handlers typed from `schema.d.ts` |
| `mock-socket` or a hand-written `FakeWs` | WS client tests |
| `svelte-check`, ESLint (`eslint-plugin-svelte`), Prettier | Static checks (CI gates) |

## What to test

| Target | Kind | Examples |
|---|---|---|
| `lib/ws` client | unit | reconnect backoff with fake timers, resubscribe with `sinceSeq`, `lagged` handling, ack/error correlation by `id` |
| `features/*/*.svelte.ts` state classes | unit | derived values, optimistic updates and rollback |
| `features/*/schema.ts` | unit | zod validation mirrors server validation for the same table of inputs used by Rust tests (shared JSON test vectors in `specs`-adjacent `testdata/validation/*.json`) |
| Components | component | renders states (loading/empty/error), emits correct API calls, keyboard interaction, a11y roles |
| Formatting utils | unit | bytes, durations, MC colour codes → spans |
| Routes | none directly | Covered by E2E; routes contain no logic by convention |

Shared validation vectors: `testdata/validation/<schema>.json` (`[{input, valid, errorField?}]`) consumed by both `mcm-api` tests and Vitest to keep client/server validation aligned.

## Conventions

- File `X.svelte` → `X.test.ts` beside it. Rune modules `foo.svelte.ts` → `foo.svelte.test.ts` (Vitest must process them with the Svelte plugin).
- Query by role/label/text; `data-testid` only as a last resort.
- No snapshot tests of DOM markup (brittle); snapshot only of serialised request payloads.
- `components/ui/**` (shadcn) are not unit-tested.

## Commands

```
pnpm --dir web test          # vitest run
pnpm --dir web test:cov      # with coverage gate (80 % lines lib/**)
pnpm --dir web check         # svelte-check + tsc
pnpm --dir web lint
```
