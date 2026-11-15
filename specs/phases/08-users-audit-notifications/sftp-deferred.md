# 8b — SFTP (deferred, post-1.0 candidate)

**Status: deferred.** Not part of the phase 8 exit checklist; carries no FR IDs and no required tests until it is scheduled. This sketch exists so earlier decisions don't block it.

## Why

Large modpack uploads and bulk edits are easier with FileZilla/WinSCP/`rsync`-over-SFTP than with the web file manager.

## Sketch

| Aspect | Design |
|---|---|
| Server | Embedded SSH server (`russh`) in a new crate `chunkyard-sftp` (depends on `chunkyard-core`, `chunkyard-fs`); separate listener `[sftp] listen = ""` (disabled by default); SFTP subsystem only — no shell, exec, port forwarding or agent forwarding |
| Host key | Ed25519, generated on first enable into `<data>/sftp_host_key` (0600); fingerprint shown in UI |
| Username | `<chunkyard-username>.<server-slug>` selects the server; one session = one server |
| Auth | SSH public keys registered per user in `/account` (preferred), or password **plus** TOTP via keyboard-interactive when the user has 2FA; same throttling as web login ((IP, username) + per-IP) |
| Authorization | `files.read` for read ops, `files.write` for write ops, evaluated by `AuthService::authorize` on every request (revocation immediate); disabled users' sessions dropped via `SessionsRevoked` |
| Sandbox | Every path through `SandboxRoot` (same no-follow semantics, reserved paths, size limits); `setstat` limited to mtime/permissions bits within 0o644/0o755 |
| Trust | Native single-trust applies unchanged: `files.write` on native servers stays admin-only ([security.md](../../architecture/security.md#native-runtime-is-single-trust)) |
| Audit | `files.write` / `files.upload` / `files.delete` / `files.move` actions with `details.via = "sftp"`; batched per session to avoid one row per block |
| Quotas | Phase 10 soft quotas checked on close of each written file |

## Open questions

- Whether `russh`'s SFTP server crate is mature enough, or a minimal SFTP v3 implementation is needed.
- Per-user key management UI and key types allowed (Ed25519, ECDSA; RSA ≥ 3072).
