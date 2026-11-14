# Implementation status

The phase specs describe the long-term product. This page records the smaller, single-owner product implemented today. Use the contracts in [http-api.md](http-api.md), [docker.md](docker.md) and the linked operational docs when building UI; a route in an old phase spec is not evidence that it exists.

## Implemented

| Area | Current behavior | Limits / remaining work |
| --- | --- | --- |
| Setup and authentication | Two-step setup token and owner creation; email/password sessions; environment-controlled auth bypass; same-origin and CSRF checks in both modes. | Multi-user roles, 2FA and API tokens are deferred. |
| Lifecycle | Docker instances, shared configured ports with one running instance per port, start/stop/restart/kill, stopped-instance deletion, editable CPU/RAM and publish address. | No native runtime, cloning, auto-start or crash-restart policy yet. |
| Software | Vanilla/Paper version selection and verified automatic downloads; CurseForge linked server packs with Forge/NeoForge/Fabric detection and isolated loader preparation. | No general client-pack conversion, Modrinth imports, mod/plugin marketplace or software version switching. See [CurseForge limits](curseforge.md). |
| Java and launch | Host runtime discovery/managed downloads; Docker Java image selection; editable JAR, argument-file or Bash launch profiles. | Host Java inventory is separate from Docker runtimes. Windows host support is not production-verified. |
| Configuration | Searchable structured properties, raw text, autosave, immutable history, restore-as-new-revision and saved/applied revision indicators. | Generic files are writable only while stopped. No dedicated player administration yet. |
| Files | Browse, download, upload, edit text, mkdir, move, copy and confirmed deletion. Select files/folders and pass them to the export flow. | No resumable/chunked uploads or generic archive extraction. Selection survives in-app navigation but not reload. |
| Console | Authenticated same-origin WebSocket stream with bounded buffers, reconnect/fallback and commands. | No persisted searchable console history. |
| Monitoring | On-demand Docker CPU/memory/IO/network snapshots; configurable polling; bounded CPU/RAM charts from samples collected while Overview is open. | Charts reset on leaving Overview. No persisted history, host metrics, TPS/MSPT or player-session collection. |
| Exports and storage | Stopped-instance world/full/selected `.tar.gz` exports, checksum verification, local or S3-compatible storage, retained archives after instance deletion. RustFS verified over NetBird. | Restore is manual extraction. No one-click restore, schedules, retention or hot backups. See [export contract](exports-contract.md). |
| Activity | Cursor-paged jobs, loaded-record filters, active-job refresh, safe result summaries and job details linked to existing instances. | Sidebar count checks only the newest 20 jobs on navigation. No cancellation or percentage progress. |
| Deployment | Version/changelog badge, local OpenAPI viewer, static UI serving, Gitadel-to-Dokploy deployment on Oracle ARM64. | No multi-node agents, relay or automatic router configuration. |

## Next useful milestones

1. Improve the file editor: syntax-aware editing, search/replace, line numbers and reliable in-app unsaved-change protection, using existing file APIs.
2. Add archive restore with backend validation, staging and rollback before a UI exposes destructive replacement. Restoring into a new instance should be the first safe workflow.
3. Add server readiness/player status and persistent bounded metrics collection before historical dashboards or player controls claim that data exists.
4. Add stopped-instance player-list management, then content updates and additional installers with explicit compatibility checks.
5. Add backup schedules and retention only after restore is verified, including archives of deleted instances.

Keep these as bounded milestones with real integration checks and changelog notes. Existing worlds, owner settings and credentials must survive upgrades. Do not implement broader authentication or multi-node specifications ahead of these core workflows.
