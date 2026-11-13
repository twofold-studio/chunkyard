# Phase 0 — UI

Conventions: [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions), [frontend.md](../../architecture/frontend.md).

## Directory skeleton created in this phase

```
web/
├── components.json                  # shadcn-svelte config (aliases → $lib/components/ui, $lib/utils)
├── svelte.config.js                 # adapter-static, fallback index.html, kit.csp { mode: "hash" }
├── vite.config.ts                   # tailwindcss(), sveltekit(), dev proxy /api → mcm on 127.0.0.1:8420 (ws: true) — the only dev loop
├── static/theme-init.js             # applies stored/system theme before paint (CSP-safe external script)
├── vitest.config.ts
├── src/
│   ├── app.css                      # @import "tailwindcss"; theme tokens (CSS vars) for light/dark
│   ├── app.html                     # <script src="/theme-init.js"> in <head>; no inline scripts
│   ├── routes/
│   │   ├── +layout.ts               # ssr=false, prerender=false
│   │   ├── +layout.svelte           # QueryClientProvider (@tanstack/svelte-query v6), Toaster, ModeWatcher (head script injection disabled)
│   │   ├── setup/+page.svelte
│   │   ├── login/+page.svelte
│   │   └── (app)/                   # authenticated group: guard in +layout.ts via features/auth/api.me()
│   │       ├── +layout.svelte       # AppShell
│   │       ├── +page.svelte         # empty dashboard placeholder ("No servers yet" – phase 1 fills)
│   │       ├── account/+page.svelte
│   │       └── admin/audit/+page.svelte
│   └── lib/
│       ├── api/{openapi.json, schema.d.ts, client.ts, problem.ts}
│       ├── ws/{client.svelte.ts, types.ts}
│       ├── components/ui/…          # shadcn: button, input, label, card, dialog, alert-dialog, dropdown-menu,
│       │                            # sidebar, sonner, table, badge, select, checkbox, tooltip, separator, skeleton, form-like field
│       ├── components/{AppShell.svelte, PageHeader.svelte, ConfirmDialog.svelte, DataTable.svelte,
│       │               ProblemAlert.svelte, ThemeToggle.svelte, ConnectionIndicator.svelte, CopyButton.svelte}
│       ├── features/
│       │   ├── auth/{api.ts, session.svelte.ts, schema.ts,
│       │   │        components/{LoginForm,TotpStep,SetupForm,ChangePasswordForm}.svelte,
│       │   │        sessions/{api.ts, components/SessionList.svelte},
│       │   │        totp/{api.ts, components/{TotpCard,TotpEnrollDialog,RecoveryCodesDialog,TotpDisableDialog}.svelte}}
│       │   ├── tokens/{api.ts, components/{TokenList,CreateTokenDialog,TokenRevealDialog}.svelte}
│       │   ├── jobs/{api.ts, jobs.svelte.ts, components/{JobToast,JobStatusBadge}.svelte}
│       │   └── audit/{api.ts, components/AuditTable.svelte}
│       └── utils/{format.ts, cn.ts}
```

## Screens

| Route | Components | Behaviour |
|---|---|---|
| `/setup` | `SetupForm` | Fields: setup token (help text: "printed in the mcm log and stored in `<data>/setup-token`"), username, password, confirm. Client validation from `features/auth/schema.ts`. On `setup.already_done` redirect to `/login`. On success → `/`. If `/setup/status` says not required → redirect `/login`. |
| `/login` | `LoginForm`, `TotpStep` | Username/password, submit on Enter, shows `auth.throttled` with countdown from `Retry-After`. On `kind:"totp_required"` swaps to `TotpStep` (6-digit input with `autocomplete="one-time-code"`, link "Use a recovery code"); `auth.challenge_invalid` returns to the password step. Redirects to `next` query param (only same-origin relative paths accepted). |
| `(app)` layout | `AppShell` | shadcn `Sidebar`: instance name, nav (Dashboard; Admin → Audit visible when `isAdmin`), footer with user menu (Account, Logout), `ThemeToggle` (light/dark/system via `mode-watcher`), `ConnectionIndicator` (WS state dot with tooltip). Collapses to sheet on < 768 px. |
| `/` | placeholder | Empty state card. |
| `/account` | `ChangePasswordForm`, `TotpCard`, `SessionList`, `TokenList`, `CreateTokenDialog`, `TokenRevealDialog` | Sections: Password · Two-factor · Sessions · API tokens. `auth.reauth_failed` shows an inline field error and never logs out. **Two-factor**: `TotpEnrollDialog` shows QR (rendered client-side from `otpauthUri` to an SVG, no external service) + secret text, confirm code → `RecoveryCodesDialog` (download `.txt`, copy, must tick "I saved these"). Disable/regenerate ask for password (+code). **Sessions**: table with device (parsed UA), IP, last seen, "This device" badge; per-row Revoke and "Sign out other sessions". If `mustChangePassword` the layout forces this page with a banner and hides nav. Token creation: name, scope multi-select (grouped by area, plus "Full access"), optional expiry (7/30/90 days, never, custom date). Reveal dialog shows secret once with copy button and warning; closing requires confirming "I've copied it". Revoke uses `ConfirmDialog`. |
| `/admin/audit` | `AuditTable` | Columns: time (relative + tooltip absolute), actor, action, target, outcome badge, details (expandable JSON). Filters: action prefix, from/to. Infinite "Load more" via cursor. |

## Global behaviours

- `JobToast`: subscribed to `jobs` topic via `jobs.svelte.ts`; shows progress toasts for jobs created by the current user in this tab; finished jobs show success/failure with problem `code` mapped to message.
- `ProblemAlert` renders `ApiProblem` (title + detail + field errors) and is used by all forms.
- 401 anywhere → clear query cache, redirect to `/login?next=<current>`.
- Theme preference persisted in `localStorage` by `mode-watcher`; default dark; `theme-init.js` reads the same key so there is no flash and no inline script (CSP, [security.md](../../architecture/security.md#http-security-headers-and-csp-p0)).
- Icons from `@lucide/svelte` only.

## States to design

Every form: idle / submitting (button spinner, inputs disabled) / field errors / problem banner. Lists: loading skeleton / empty / error with retry.
