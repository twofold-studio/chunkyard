# Frontend architecture

Conventions are in [patterns.md §11](patterns.md#11-frontend-conventions); this file covers structure and tooling.

## Stack

| Concern | Choice |
|---|---|
| Framework | SvelteKit 2, Svelte 5 (runes only), TypeScript strict |
| Build | Vite, `@sveltejs/adapter-static` with `fallback: "index.html"`, `ssr = false`, `prerender = false` in root `+layout.ts` |
| UI kit | shadcn-svelte (components in `src/lib/components/ui`), bits-ui underneath, `@lucide/svelte` icons |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), CSS variables theme, dark mode default with light toggle |
| Data | `openapi-fetch` client; TanStack Query for Svelte **v6** (`@tanstack/svelte-query@^6`, runes-based API) for caching/invalidation |
| Theme | `mode-watcher` (dark/light/system) |
| Realtime | `lib/ws` singleton class (`$state` connection status), topic subscription returns an unsubscribe fn |
| Console | `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-search` |
| Editor | CodeMirror 6: `@codemirror/lang-json`, `@codemirror/lang-yaml`, `@codemirror/legacy-modes` (properties, toml, shell) |
| Charts | LayerChart (Svelte-native) |
| Forms/validation | zod |
| Package manager | pnpm (lockfile committed); bun allowed for local scripts only |

## Route map (cumulative)

| Route | Phase | Purpose |
|---|---|---|
| `/setup` | 0 | First-run owner creation |
| `/login` | 0 | Login |
| `/` | 1 | Dashboard: server cards with status, quick actions |
| `/servers/new` | 1 (expanded 3, 4) | Create wizard |
| `/servers/[id]` | 1 | Overview (status, address, resource summary) |
| `/servers/[id]/console` | 1 | Console |
| `/servers/[id]/settings` | 2 | General, Java/JVM, properties, players |
| `/servers/[id]/files/[...path]` | 2 | File manager + editor |
| `/servers/[id]/content` | 4 | Mods/plugins/packs |
| `/servers/[id]/metrics` | 5 | Graphs |
| `/servers/[id]/backups` | 6 | Backups |
| `/servers/[id]/schedules` | 6 | Scheduled tasks |
| `/servers/[id]/worlds` | 6 | World management |
| `/servers/[id]/network` | 7 | Routes/exposure |
| `/admin/users`, `/admin/audit`, `/admin/notifications`, `/admin/java`, `/admin/relays`, `/admin/storage`, `/admin/settings`, `/admin/nodes` | various | Admin |
| `/account` | 0 (expanded 8) | Profile, password, API tokens, 2FA |

## Features directory (cumulative)

`auth`, `tokens`, `servers`, `console`, `settings`, `files`, `java`, `installers`, `content`, `metrics`, `backups`, `schedules`, `worlds`, `network`, `users`, `audit`, `notifications`, `jobs`, `nodes`.

## Embedding and dev loop

- `pnpm --dir web build` → `web/build/`; `chunkyard-server` embeds it via `rust-embed` (feature `embed-ui`).
- Static handler: exact file match → serve with long cache for `/_app/immutable/*`; otherwise `index.html` with `Cache-Control: no-cache`. `/api/*` never falls through to the SPA.
- **Dev loop (the only one):** run `cargo run -p chunkyard-server --no-default-features --features test-hooks` (API on `127.0.0.1:8420`, no embedded UI) and `pnpm --dir web dev`; open Vite on `:5173`, which proxies `/api` (incl. WS upgrade) to mcm. mcm never proxies to Vite.
- CSP: `kit.csp = { mode: "hash" }`; theme bootstrap via static `/theme-init.js` (see [security.md](security.md#http-security-headers-and-csp-p0)).

## Accessibility and UX baselines

- Keyboard navigable; all dialogs from shadcn (focus trapped); destructive actions use `ConfirmDialog` requiring typing the server name for delete/reset/restore.
- Every async action shows pending state; job-backed actions show a progress toast linked to the job.
- Empty, loading, error states are designed for every list.
