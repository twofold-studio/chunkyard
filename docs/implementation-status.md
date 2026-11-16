# Implementation status

The phase specs describe the long-term product. This page records the smaller, single-owner product implemented today. Use the contracts in [http-api.md](http-api.md), [docker.md](docker.md) and the linked operational docs when building UI; a route in an old phase spec is not evidence that it exists.

## Implemented

| Area | Current behavior | Limits / remaining work |
| --- | --- | --- |
| Setup and authentication | Two-step setup token and owner creation; email/password sessions; environment-controlled auth bypass; same-origin and CSRF checks in both modes; one-time owner API keys and bearer REST/MCP integration. | Multi-user roles, 2FA, scoped keys and OAuth connector flows are deferred. |
| Navigation | Keyboard quick-navigation palette with tab deep links; server-list search, state/software filters and deterministic sorting. | Search covers the returned server inventory, currently up to 100 records. Only the sort preference persists in the browser. |
| Lifecycle | Docker instances, shared configured ports with one running instance per port, start/stop/restart/kill, stopped-instance deletion, editable CPU/RAM and publish address. Opt-in manager-startup and bounded crash recovery preserve manual Stop intent. | No native runtime or cloning. Recovery defaults off, respects clean exits and never accepts the EULA. |
| Software | Vanilla/Paper/Purpur version selection and verified automatic downloads; standalone Fabric/Forge/NeoForge loader installation; CurseForge linked server packs with isolated loader preparation. | Standalone Forge starts at Minecraft 1.12.2. No general client-pack conversion, Modrinth imports, mod/plugin marketplace or software version switching. See [CurseForge limits](curseforge.md). |
| Java and launch | Docker Java image selection; editable JAR, argument-file or Bash launch profiles. | Java runs inside Docker images. Host Java management is removed. |
| Configuration | Searchable structured properties, raw text, autosave, immutable history, restore-as-new-revision and saved/applied revision indicators. Dedicated whitelist, operator and ban management uses guarded stopped edits or confirmed live commands. | Generic files are writable only while stopped. Player counts/sample names come from bounded Minecraft status probes, not a complete player-session tracker. |
| Files | Browse, download, file uploads including drag/drop, syntax-aware text editing, mkdir, folder-picker move/copy and confirmed deletion. Select files/folders and pass them to the export flow. Optional Vim editing and browser folder/file Back/Forward history preserve the stay/discard guard for dirty edits. | No folder/resumable/chunked uploads or generic archive extraction. Selection survives in-app navigation but not reload. |
| Console | Authenticated same-origin WebSocket stream with bounded buffers, reconnect/fallback and commands. Safe ANSI/Minecraft colors, full-height log, filter, wrap/follow, text download/copy, per-instance command recall and Tab suggestions. | Suggestions are built-in/history, not server-authoritative plugin/player completion. No persisted searchable console history. |
| Monitoring | On-demand Docker metrics and shared attention-aware WebSockets down to 100 ms. Persistent snapshots about once a minute, independently of browsers, with Live/1h/24h/7d charts. Java Server List Ping reports readiness and advertised player counts. | Persistent history defaults on, retains seven days and at most 100,000 rows globally; snapshots are not continuous averages. Live charts retain 180 samples per watched server. No TPS/MSPT or complete player-session collection. |
| Exports and storage | World/full/selected archives, local or S3 storage, verification, archived identities and one-click full-instance restore. Opt-in stopped-only schedules and acknowledged retention prune scheduler-created backups after verification. | Full S3 backup required before removing local files. Running instances are skipped, never stopped automatically. Manual backups and pinned restore points are retained. No hot backups. See [export contract](exports-contract.md). |
| Activity | Global and per-instance cursor-paged jobs, loaded-record state/type filters, safe result summaries and job details. Returning server pages reconnect to active operations without resubmitting them. | Sidebar count queries active jobs globally on navigation and observed changes; no separate polling timer. Observed install/export stages and byte progress are available; no cancellation or estimated overall percentage. |
| Deployment | Version/changelog badge, local OpenAPI viewer, static UI serving, Gitadel-to-Dokploy deployment on Oracle ARM64. | No multi-node agents, relay or automatic router configuration. |

## Next useful milestones

Queued after the readiness/player controls, backup automation, recovery and stored-metrics release: browser-based OAuth authorization for MCP in OpenCode, Codex and Claude Code. Add owner consent, connected-client visibility and revocation, and verify each harness's actual authorization flow. Existing API keys remain usable; this follow-up is not part of the current release.

1. Implement the queued MCP browser-authorization flow and verify OpenCode, Codex and Claude Code compatibility.
2. Add content updates and additional installers with explicit compatibility checks and a backup-first workflow.
3. Consider hot backups only with a verified Minecraft save/flush protocol and restore checks.

Keep these as bounded milestones with real integration checks and changelog notes. Existing worlds, owner settings and credentials must survive upgrades. Do not implement broader authentication or multi-node specifications ahead of these core workflows.
