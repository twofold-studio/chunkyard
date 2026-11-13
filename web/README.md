# Chunkyard web UI

SvelteKit (Svelte 5, TypeScript) single-page app styled with Tailwind v4 and shadcn-svelte. It talks to the Rust backend only through the REST API described in [`docs/http-api.md`](../docs/http-api.md) and [`docs/docker.md`](../docs/docker.md). See [`docs/frontend.md`](../docs/frontend.md) for scope and integration limits.

## Development

The backend has no CORS support and checks `Host`, `Origin` and `X-MCM-CSRF` against `CHUNKYARD_HTTP__PUBLIC_URL`. In development the Vite server proxies `/api` and `/healthz` to the backend while keeping the browser's `Host` header, so the backend must be told that the browser origin is the Vite origin:

```sh
# terminal 1: backend (from the repository root)
CHUNKYARD_HTTP__PUBLIC_URL=http://localhost:5173 cargo run -p mcm-server -- serve
# optional: trusted local use without login
CHUNKYARD_AUTH__ENABLED=false CHUNKYARD_HTTP__PUBLIC_URL=http://localhost:5173 cargo run -p mcm-server -- serve

# terminal 2: frontend
cd web
pnpm install
pnpm dev            # always http://localhost:5173 (strictPort)
```

Open exactly `http://localhost:5173`. Using `127.0.0.1:5173` instead changes the origin and mutations fail with `auth.csrf`/`http.host`. Set `CHUNKYARD_DEV_BACKEND` to proxy to a backend other than `http://127.0.0.1:8420`.

With authentication enabled, the first visit shows owner setup. Read the token from `<data-dir>/setup-token` on the backend host.

## Checks

```sh
pnpm check          # svelte-check + TypeScript
pnpm lint           # prettier + eslint
pnpm test           # unit (node) + component (Chromium) tests
pnpm build          # static SPA in build/ (fallback 200.html)
```

Component tests run in Playwright Chromium. Where Playwright's bundled browser is unavailable (e.g. NixOS), point it at a system browser:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome-stable) pnpm test
```

## Layout

- `src/lib/api/` – typed wire DTOs, the same-origin fetch client (CSRF header, problem+json errors), endpoint functions, error messages, job polling.
- `src/lib/polling.ts` – sequential polling that pauses while the tab is hidden and stops on abort.
- `src/lib/servers/` – server form validation and the detail-page lifecycle controller.
- `src/lib/components/app/` – shell (sidebar, top bar), page/section layout, shared states.
- `src/lib/components/{servers,java}/` – feature components.
- `src/lib/components/ui/` – shadcn-svelte components added with the CLI (`pnpm dlx shadcn-svelte@latest add …`).
- `src/routes/(auth)/` – setup and login; `src/routes/(app)/` – the authenticated shell.
