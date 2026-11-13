# Phase 8 — UI

Feature dirs: `features/users`, `features/audit`, `features/notifications`. Conventions: [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions). TOTP enrolment, own sessions and the login TOTP step are phase 0 screens.

## Screens

| Route | Who | Content |
|---|---|---|
| `/admin/users` | admin | DataTable: username, role badge, 2FA badge, status, last login, actions (edit, disable/enable, reset password, revoke sessions, delete). "Invite user" and "Create with temporary password" buttons. Pending invites tab with copy-link and revoke. |
| `/admin/users/[id]` | admin | Profile card, role selector (hierarchy-aware), `canCreateServers` switch (disabled with tooltip "requires Docker runtime" when Docker is unavailable), server grants table, sessions list, token count, danger zone. Role demotion shows a confirm listing grants that will be revoked. |
| `/invite/[token]` | public | Instance name, role; username + password with strength meter; on success → dashboard; dropped grants (if any) listed |
| `/servers/[id]/settings/access` | admin | Runtime badge (native/shim/docker). Users with grants; "Add user" combobox; preset dropdown + permission grid. On native/shim servers a persistent **warning callout**: "This server runs as the mcm system user. File write, content management and settings let a user run arbitrary code on the host, so they can only be given to admins. Use the Docker runtime to delegate them safely." The three permissions render disabled with a lock icon for `user` rows; presets marked not grantable are disabled. |
| `/servers/[id]/activity` | `server.view` | Server-scoped audit feed; console commands appear only for users with `console.read` |
| `/admin/audit` | admin | Filter bar (actor, server, action prefix, outcome, date range), infinite-scroll table, row expand shows `details` JSON (read-only CodeMirror), "Export CSV" |
| `/admin/notifications` | admin | Channel list; create/edit sheet (kind, URL with `urlPreview` after save, event picker with defaults, server filter, enable switch, "Send test" inline result); secret reveal once; deliveries drawer |
| `/admin/settings` (security section) | owner | "Require 2FA for admins" switch |
| `/account` | self | Adds a Notifications tab (in-app list) to the phase 0 account page; API token dialog offers the `admin` scope only to admins |
| Global | all | Bell with unread count; toasts for `warn`/`error`; WS close `4401` → toast "You were signed out" + redirect `/login` |
| Enforcement gate | admin w/o 2FA when required | Full-page interstitial routing to the phase 0 2FA enrolment on `auth.2fa_enrolment_required` |

## Components (new)

| Component | Feature | Notes |
|---|---|---|
| `UserTable.svelte` | users | Cursor paging; row actions in `DropdownMenu` |
| `InviteDialog.svelte` | users | Role, optional username, expiry, optional initial grants (same grid, same trust rules); URL with copy button |
| `RoleBadge.svelte` | users | |
| `PermissionGrid.svelte` | users | Props `{catalog, value, runtime, targetRole, onchange}`; implication rules client-side (shared vectors); locks admin-trust permissions per `PermissionInfo.adminTrustOn` |
| `PresetSelect.svelte` | users | Preset replaces grid value; edits show "Custom"; non-grantable presets disabled with reason |
| `TrustWarning.svelte` | users | The native single-trust callout (text above), reused by the grid, invite dialog and runtime-change dialog (phase 10) |
| `RuntimeConflictDialog.svelte` | users | Shown on `409 server.runtime_grants_conflict`: lists conflicts, buttons "Cancel" / "Revoke these grants and continue" |
| `AdminSessionList.svelte` | users | Another user's sessions with revoke |
| `AuditFilterBar.svelte`, `AuditTable.svelte`, `AuditDetails.svelte` | audit | Filters synced to URL query |
| `ChannelForm.svelte`, `ChannelList.svelte`, `DeliveryLog.svelte`, `EventPicker.svelte` | notifications | |
| `NotificationBell.svelte` | notifications | Uses `inbox.svelte.ts` |

## State classes

- `features/notifications/inbox.svelte.ts` — `$state items`, `unread = $derived(...)`, WS topic `notifications`, `markRead(ids)`.
- `features/auth/session.svelte.ts` (phase 0) gains `permissionsFor(serverId)` from `/auth/me.serverPermissions`; UI hides controls the user lacks (server stays authoritative).

## States

| Screen | Empty | Error |
|---|---|---|
| Users | "Only you so far — invite someone" | problem toast |
| Audit | "No events match these filters" | |
| Channels | "No channels — add Discord or a webhook" | auto-disabled banner with reason and "Re-enable" |
| Access | "Only admins can access this server" | `permission.requires_admin_trust` → inline field errors on the locked permissions |
