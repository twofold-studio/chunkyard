# Filesystem layout

```
<data_dir>/                         default /var/lib/mcm (Docker: /data)
├── mcm.db, mcm.db-wal, mcm.db-shm
├── secret.key                      0600, master encryption key
├── setup-token                     present only before first-run setup
├── servers/
│   └── <server-id>/                server root = SandboxRoot; ENTIRELY user-controlled, untrusted
│       ├── server.properties, eula.txt, whitelist.json, ops.json, banned-*.json
│       ├── world/ …
│       └── mods/ | plugins/ | config/ | libraries/ …
├── state/
│   └── <server-id>/                chunkyard-owned, never exposed to the file manager
│       ├── pid                     "<pid> <starttime> <epoch>"
│       ├── console.log[.1-5], crash-<ts>.log, install.log
│       ├── trash/                  deleted files + trash.json metadata (P2)
│       ├── previous/               replaced jars on version switch (P3)
│       └── shim.sock               (P10 shim runtime)
├── runtimes/
│   └── java/<vendor>-<major>-<fullver>-<os>-<arch>/   extracted JRE; bin/java
├── cache/
│   ├── downloads/<sha1-or-sha256>  content-addressed download cache (LRU, default cap 10 GiB)
│   └── meta/                       cached API metadata (version manifests) with TTL
├── backups/<server-id>/<backup-id>.tar.zst   local storage target
├── uploads/<upload-id>/            in-progress chunked uploads (GC after 24 h)
└── tmp/                            scratch; same filesystem as servers/ for atomic rename
```

Rules:
- Server directories are named by **server id** (`servers/<id>`), never by name or slug, so renames and slug changes never move files. `slug` is only a human-friendly handle used in archive names and logs.
- Deleting a server moves `servers/<id>` and `state/<id>` to `tmp/delete-<id>-<ts>/` then deletes asynchronously.
- No mcm state is stored inside `servers/<id>`; see [security.md](security.md#untrusted-server-directory).
- `cache/downloads` is shared across servers; installers hard-link (fallback copy) from cache into server dirs.
- All directories created with mode 0750, files 0640 (umask 027 set at startup).
- mcm refuses to start if `data_dir` is on a filesystem without `rename` atomicity guarantees between `tmp/` and `servers/` (checked by creating a test file and renaming).
