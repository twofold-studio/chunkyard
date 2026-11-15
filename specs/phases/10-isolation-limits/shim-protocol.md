# Phase 10 — `chunkyard-shim` design and wire protocol

Crate `chunkyard-shim`: a **leaf** crate (no `mcm-*` deps) with a binary `chunkyard-shim` and a small client library used by `chunkyard-process::shim` (`ShimSpawner`). Errors are mapped into `ProcessError` by `chunkyard-process` (leaf exemption, [patterns.md §1](../../architecture/patterns.md#1-errors)).

## Process topology

```
mcm (any thread; via spawner thread)            survives mcm exit
  └─ spawn chunkyard-shim  ── setsid(), no PDEATHSIG, stdio=/dev/null, cwd=<data>/state/<id>/
        └─ java (process_group(0), PDEATHSIG=SIGTERM tied to shim's main thread, cwd=<data>/servers/<id>/)
```

- mcm launches the shim through the dedicated spawner thread ([process-model.md](../../architecture/process-model.md#dedicated-spawner-thread)) but **without** `PR_SET_PDEATHSIG` and with `setsid()` in `pre_exec`, so the shim is not tied to mcm's lifetime or terminal session.
- The shim is single-threaded for spawning (spawns java from its main thread, which lives until exit), so java's PDEATHSIG fires only if the shim itself dies.
- Under systemd the shipped unit uses `Delegate=yes` **and `KillMode=process`** when the shim or Docker runtime is enabled, so `systemctl restart mcm` signals only the mcm main process; shims stay in the unit's delegated cgroup subtree (`<unit>/servers/<id>`). `mcm` itself stops shim servers on shutdown only if `shim.leave_running_on_shutdown = false`.

## Invocation

```
chunkyard-shim --server-id <id> --state-dir <data>/state/<id> --cwd <data>/servers/<id> \
         --log-max-bytes 8388608 -- <java> <jvm args…> <launch target> nogui
```

The argv after `--` is built by mcm exactly like the native runtime; the shim never reads files from the server directory and never interprets the command.

## Files in `<data>/state/<id>/`

| File | Mode | Purpose |
|---|---|---|
| `shim.sock` | 0600 | Unix stream socket, created by the shim (umask 077) |
| `shim.pid` | 0600 | `<shim pid> <starttime> <java pid> <java starttime>` |
| `shim.log`, `shim.log.1` | 0600 | Output records, rotated at `log-max-bytes` (2 files kept) |
| `shim.exit.json` | 0600 | Written when java exits while no client is connected: `{code, signal, at, lastOffset}` |

## Framing

`Frame = len: u32 big-endian | payload` with `1 ≤ len ≤ 1 MiB`; payload = `postcard` encoding of `ClientMsg` / `ShimMsg`. Protocol version **1**; enums are append-only.

```rust
enum ClientMsg {
    Hello { proto: u16, mcm_version: String },
    Stdin { data: Vec<u8> },                      // already validated & newline-terminated by mcm
    Subscribe { since_offset: Option<u64> },       // replay from shim.log, then live
    Signal { sig: Sig },                           // Term | Kill → killpg(java pgid)
    Status,
    AckExit,                                       // mcm persisted exit; shim cleans up and exits
}
enum ShimMsg {
    HelloOk { proto: u16, shim_version: String, server_id: String,
              java_pid: u32, java_start_time: u64, started_at_ms: u64 },
    HelloErr { code: String /* "version" | "server_mismatch" */ },
    Output { offset: u64, ts_ms: u64, stream: Stream /* Stdout|Stderr */, data: Vec<u8> },
    ReplayGap { from: u64, to: u64 },              // requested offset already rotated away
    ReplayDone { next_offset: u64 },
    Status { running: bool, java_pid: u32, rss_kb: Option<u64> },
    Exited { code: Option<i32>, signal: Option<i32>, at_ms: u64 },
}
```

## Rules

| Topic | Rule |
|---|---|
| Peer check | On accept, `SO_PEERCRED` uid must equal the shim's own uid, else close immediately |
| Clients | One client at a time; a new connection replaces the old (old gets EOF) |
| Output | The shim reads java stdout/stderr continuously (never blocks on the client); every chunk is appended to `shim.log` with a monotonically increasing byte `offset`, then forwarded if a client is subscribed. If the client's socket buffer is full, the shim drops live forwarding for that client and sends nothing more until it re-subscribes with `since_offset` (mcm reconnects and replays) |
| Stdin | Written to java stdin in order; if java's stdin pipe is full, the shim buffers ≤ 64 KiB then closes the client with an error |
| Exit | On java exit: send `Exited` if connected, else write `shim.exit.json`; wait for `AckExit` (or, with no client, up to `exit_hold_s` = 24 h), then remove socket/pid files and exit 0 |
| Version skew | mcm speaks `proto` 1; a newer mcm talking to an older shim uses the lowest common version; unknown → `HelloErr{version}` → server state `Unknown` with reason "restart required to upgrade shim" |
| Signals to shim | SIGTERM → forward SIGTERM to java's process group; SIGKILL to the shim → java gets SIGTERM via PDEATHSIG (JVM shutdown hooks save the world) |

## Adoption (`ShimSpawner::adopt`)

1. If `shim.sock` exists: connect (1 s timeout) → `Hello` → expect `HelloOk.server_id == id`.
2. Compare `java_pid`/`java_start_time` with `shim.pid`; mismatch → treat as foreign, state `Unknown`, `warn`.
3. `Subscribe { since_offset: <last persisted offset> }`; replayed `Output` frames go into the ring (new epoch → clients receive `reset`). `ReplayGap` inserts a system line "… output lost while mcm was offline".
4. Connection refused + `shim.exit.json` present → record that exit (crash policy applies if it was not requested), delete the file, return `Ok(None)`.
5. Neither → stale files removed; `Ok(None)`.

mcm persists the last delivered `offset` in `servers.runtime_state` every 5 s and on shutdown.
