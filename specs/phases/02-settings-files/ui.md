# Phase 2 — UI

Conventions: [frontend.md](../../architecture/frontend.md), [patterns.md §11](../../architecture/patterns.md#11-frontend-conventions). Features: `settings`, `players`, `files`.

## Routes

| Route | Page composes |
|---|---|
| `/servers/[id]/settings` | redirects to `/settings/general` |
| `/servers/[id]/settings/general` | `GeneralSettingsForm` |
| `/servers/[id]/settings/properties` | `PropertiesEditor` |
| `/servers/[id]/settings/players` | `PlayerListsPanel` |
| `/servers/[id]/files/[...path]` | `FileBrowser` (path = directory) or `FileEditor` when `?edit=<file>` |

Settings uses shadcn `Tabs` rendered as links (URL-addressable). A `RestartRequiredBanner` (shown when `status.restartRequired`) sits at the top of every server page with a "Restart now" button (`server.power`).

## Feature `settings`

```
features/settings/
├── api.ts                     getProperties, putProperties, patchServer, getSchema, getEula, postEula, getMemory
├── schema.ts                  zod for UpdateServerRequest (shares vectors in testdata/validation/server-settings.json)
├── properties-form.svelte.ts  class PropertiesFormState { entries=$state; dirty=$derived; etag; setValue(); reset(); }
└── components/
    ├── GeneralSettingsForm.svelte
    ├── MemoryField.svelte         two sliders/inputs + host RAM bar (from /system/memory), warnings inline
    ├── JvmArgsEditor.svelte       one arg per row, add/remove, preset menu (Aikar's flags, ZGC generational); non-admins validated client-side against the allow-list vectors (`testdata/validation/jvm_args.json`), admins see a free-form warning
    ├── PropertiesEditor.svelte
    ├── PropertyField.svelte       renders by spec type: Switch (bool), Input type=number (int), Select (enum), Input (string), masked (secret: shows `********` unless the user has `console.write`; editing replaces, leaving it untouched keeps the stored value)
    ├── UnknownPropertiesTable.svelte  raw key/value rows, add/remove
    ├── EulaCard.svelte
    └── RestartRequiredBanner.svelte
```

### General settings

Sections (Cards): **Identity** (name), **Memory** (`MemoryField`), **Java & JVM** (Java path admin-only, read-only otherwise; `JvmArgsEditor`; on native-runtime servers an info `Alert`: "JVM arguments and files can run code as the mcm system user — only grant to trusted admins"), **Lifecycle** (auto-start switch, restart-on-crash switch + max restarts + window, stop command (admin), stop timeout, ready pattern with "test against recent console" button that runs the regex client-side over the last 500 ring lines), **Network** (port with "find free port" — calls nothing new, suggests from `config.process.port_range` returned in server DTO). Save bar sticky at bottom when dirty; server warnings shown as `Alert` variant warning after save.

### Properties editor

- Groups from schema (`General`, `Players`, `World`, `Network`, `Performance`, `Resource pack`, `Advanced`) as collapsible sections; search box filters by key/description.
- Each field shows key (monospace), description tooltip, default, "modified from default" dot, and inline validation from zod built from `PropertySpecDto` at runtime.
- Managed keys show a lock icon and "Managed by mcm" (in P2 only `server-port`). Keys reserved for later phases (`rcon.*`, `management-server-*`) carry an info hint "mcm will manage this from monitoring (P5)".
- "Not used by this version" collapsible for keys outside `since/until`.
- Unknown keys in `UnknownPropertiesTable`.
- "Edit as text" link opens `FileEditor` on `server.properties`.
- Save → `PUT` with `If-Match`. On `412`: dialog "File changed on disk" with options **Reload** (discard mine) or **Overwrite** (re-fetch ETag, re-apply my changed keys on top, save).
- MOTD field renders a live preview with `§` colour codes (`McText.svelte` → spans with classes; no `{@html}`).

### EULA card

Shown on the server overview and in the create flow when `accepted=false`: text "Minecraft servers require accepting the Minecraft EULA", link `https://aka.ms/MinecraftEULA` (`target=_blank rel=noopener noreferrer`), checkbox + "Accept" button. Start button on the overview shows a confirm dialog when EULA is not accepted.

## Feature `players`

```
features/players/components/
├── PlayerListsPanel.svelte    Tabs: Whitelist | Operators | Bans | IP bans
├── PlayerTable.svelte         avatar (https://mc-heads.net/avatar/<uuid>/24 — img only, CSP img-src https:), name, uuid, extra cols
├── AddPlayerDialog.svelte     name input → debounced lookup (/players/lookup), shows resolved UUID/source; op level select; ban reason + expiry (date picker, "forever")
└── WhitelistToggle.svelte     enabled + enforce switches
```

IP-ban input rejects loopback/unspecified addresses client-side with the same message as `players.ban_ip_forbidden`; a warning banner on the IP bans tab explains that behind the router/relay without PROXY protocol all players share one IP (P7/P9).

`202 pending` responses show a toast "Sent to server, waiting for confirmation" and refetch after 5 s.

## Feature `files`

```
features/files/
├── api.ts                     list, read, write, mkdir, move, copy, delete, trash*, search, downloadUrl(), zipUrl()
├── upload.svelte.ts           class UploadQueue { items=$state([]); add(files, dir); pause(id); resume(id); cancel(id) } — chunked protocol, sequential chunks, 2 files concurrently
├── selection.svelte.ts        multi-select state (click, ctrl/cmd, shift-range)
├── language.ts                extension → CodeMirror language
└── components/
    ├── FileBrowser.svelte     toolbar + Breadcrumbs + DirTree (left, lazy) + FileTable (right)
    ├── Breadcrumbs.svelte
    ├── DirTree.svelte
    ├── FileTable.svelte       columns: name(icon), size, modified; sortable; keyboard nav (↑↓, Enter open, Del delete, F2 rename)
    ├── FileContextMenu.svelte open/edit, download, rename, move…, copy…, archive, extract (for archives), delete
    ├── DropZone.svelte        drag-drop overlay on the table; folders via webkitGetAsEntry (recursive mkdir + uploads)
    ├── UploadPanel.svelte     bottom-right sheet: per-file progress, speed, ETA, pause/resume/cancel, retry
    ├── TrashDialog.svelte     list, restore, purge
    ├── SearchBox.svelte
    ├── MoveCopyDialog.svelte  directory picker using DirTree
    ├── FileEditor.svelte      CodeMirror 6 wrapper
    └── EditorStatusBar.svelte language, line:col, size, "modified"
```

### Editor

- Languages: `.properties` → legacy-modes `properties`; `.json`/`.mcmeta` → `lang-json` with lint (JSON.parse errors as diagnostics); `.yml/.yaml` → `lang-yaml`; `.toml` → legacy-modes `toml`; `.cfg/.ini/.conf` → legacy-modes `properties`; `.sh` → legacy-modes `shell`; `.log`, `.txt`, `.log.gz` (not editable) → plain read-only for `.log`.
- Files under `logs/` and `*.log` open **read-only** with a "Download" button.
- Keybindings: `Mod-s` save, `Mod-f` search (CodeMirror search panel), default history.
- Theme follows app dark/light.
- Unsaved-changes guard: `beforeNavigate` cancels navigation with a confirm dialog when dirty; `beforeunload` listener while dirty.
- On `412`: same Reload/Overwrite dialog as properties (overwrite = re-fetch ETag then save my buffer). On `415 fs.binary`: show "Binary file — download instead".

### States

| State | Display |
|---|---|
| Loading dir | Skeleton rows |
| Empty dir | "This folder is empty" + upload button |
| `truncated` | Banner "Showing first 10 000 entries — use search" |
| Error | Problem component with retry |
| Symlink | Icon with arrow; actions other than delete disabled with tooltip |
| Running server + destructive op in world dir | Confirm dialog warns about corrupting a running world |

Permissions: buttons hidden when the principal lacks `files.write` (permission list comes with the server DTO's `myPermissions`, phase 1). `server.properties` opened without `console.write` shows a notice "Secret values are hidden; leaving `********` keeps them".
