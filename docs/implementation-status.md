# Implementation status

The phase specs describe the long-term product. This page records the smaller, single-owner product implemented today. Use the contracts in [http-api.md](http-api.md), [docker.md](docker.md) and the linked operational docs when building UI; a route in an old phase spec is not evidence that it exists.

## Implemented

| Area | Current behavior | Limits / remaining work |
| --- | --- | --- |
| Setup and authentication | Two-step setup token and owner creation; email/password sessions; environment-controlled auth bypass; same-origin and CSRF checks in both modes; one-time owner API keys and bearer REST/MCP integration. | Multi-user roles, 2FA, scoped keys and OAuth connector flows are deferred. |
| Navigation | Keyboard quick-navigation palette with tab deep links; server-list search, state/software filters and deterministic sorting. | Search covers the returned server inventory, currently up to 100 records. Only the sort preference persists in the browser. |
| Lifecycle | Docker instances, shared configured ports with one running instance per port, start/stop/restart/kill, stopped-instance deletion, editable CPU/RAM and publish address. | No native runtime, cloning, auto-start or crash-restart policy yet. |
| Software | Vanilla/Paper version selection and verified automatic downloads; CurseForge linked server packs with Forge/NeoForge/Fabric detection and isolated loader preparation. | No general client-pack conversion, Modrinth imports, mod/plugin marketplace or software version switching. See [CurseForge limits](curseforge.md). |
| Java and launch | Docker Java image selection; editable JAR, argument-file or Bash launch profiles. | Java runs inside Docker images. Host Java management is removed. |
| Configuration | Searchable structured properties, raw text, autosave, immutable history, restore-as-new-revision and saved/applied revision indicators. | Generic files are writable only while stopped. No dedicated player administration yet. |
| Files | Browse, download, file uploads including drag/drop, syntax-aware text editing, mkdir, folder-picker move/copy and confirmed deletion. Select files/folders and pass them to the export flow. Optional Vim editing and browser folder/file Back/Forward history preserve the stay/discard guard for dirty edits. | No folder/resumable/chunked uploads or generic archive extraction. Selection survives in-app navigation but not reload. |
| Console | Authenticated same-origin WebSocket stream with bounded buffers, reconnect/fallback and commands. Safe ANSI/Minecraft colors, full-height log, filter, wrap/follow, text download/copy, per-instance command recall and Tab suggestions. | Suggestions are built-in/history, not server-authoritative plugin/player completion. No persisted searchable console history. |
| Monitoring | On-demand Docker CPU/memory/IO/network snapshots and shared live statistics WebSockets; configurable delivery intervals; bounded CPU/RAM charts from a shared sampler while a server page is open. Docker engine CPU/RAM totals, architecture and OS are available through the isolation API. | Chart history is bounded to 180 samples per watched server and 32 idle channels in browser memory. Host capacity is not live free memory; no persisted history, host usage metrics, TPS/MSPT or player-session collection. |
| Exports and storage | World/full/selected archives, local or S3 storage, verification, archived identities and one-click full-instance restore. RustFS verified over NetBird. | Stopped only; full S3 backup required before removing local files. No schedules, retention or hot backups. See [export contract](exports-contract.md). |
| Activity | Global and per-instance cursor-paged jobs, loaded-record state/type filters, safe result summaries and job details. Returning server pages reconnect to active operations without resubmitting them. | Sidebar count queries active jobs globally on navigation and observed changes; no separate polling timer. Observed install/export stages and byte progress are available; no cancellation or estimated overall percentage. |
| Deployment | Version/changelog badge, local OpenAPI viewer, static UI serving, Gitadel-to-Dokploy deployment on Oracle ARM64. | No multi-node agents, relay or automatic router configuration. |

## Next useful milestones

1. Add server readiness/player status and persistent bounded metrics collection before historical dashboards or player controls claim that data exists.
2. Add stopped-instance player-list management, then content updates and additional installers with explicit compatibility checks.
3. Add backup schedules and retention only after restore is verified, including archives of deleted instances.

Keep these as bounded milestones with real integration checks and changelog notes. Existing worlds, owner settings and credentials must survive upgrades. Do not implement broader authentication or multi-node specifications ahead of these core workflows.
