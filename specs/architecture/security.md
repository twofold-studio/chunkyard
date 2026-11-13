# Security model and threat model

## Assets

| Asset | Why it matters |
|---|---|
| Host OS | mcm runs Java with arbitrary mods = arbitrary code. Compromise of mcm ≈ code exec as mcm's OS user |
| World data, backups | Irreplaceable player data |
| Credentials | Passwords, sessions, API tokens, TOTP secrets, CurseForge key, S3 keys, webhook URLs, relay tokens, RCON/management secrets |
| Relay | Internet-facing; abuse as open proxy |

## Native runtime is single-trust

On the **native** runtime (default, P1–P9) every server runs as the mcm OS user. Several capabilities therefore equal **arbitrary code execution as mcm** (read the DB, the master key, other servers):

| Capability | Why it is code execution |
|---|---|
| `files.write` | Upload a plugin/mod jar, or edit configs that load code |
| `content.manage` | Installs arbitrary jars |
| `server.settings` | JVM args, launch spec, env, Java selection |

Consequences (enforced from P8, documented from P1):
- On native servers these permissions may only be granted to **admin-trust users** (role `owner` or `admin`). Granting them to a `user` on a native server is rejected (`422 permission.requires_admin_trust`); the UI explains why.
- `files.read`, `console.*`, `server.power`, `players.manage`, `backups.read`, `server.view` remain safe to delegate.
- Real multi-user isolation (letting untrusted users manage their own servers) **requires the Docker runtime (P10)**; on Docker servers the above permissions are grantable to any user, and non-admin JVM args are restricted by the allow-list below.

## Trust boundaries and threats

| # | Boundary | Threat | Mitigation |
|---|---|---|---|
| T1 | Browser → API | Credential stuffing, brute force, owner lockout | argon2id; throttling keyed on (IP, username) plus a per-IP cap — never on username alone ([auth.md](auth.md#login-throttling)); TOTP (P0) |
| T2 | Browser → API | CSRF, clickjacking | Custom header + Origin check ([auth.md](auth.md#csrf)); headers below |
| T3 | Browser → API | XSS via console, file names, MOTDs, mod descriptions | xterm.js (no HTML); Svelte escaping; `{@html}` banned except DOMPurify-sanitized Markdown; CSP below |
| T4 | User → file manager | Path traversal, symlink escape, zip-slip, zip bombs, disk exhaustion | `SandboxRoot`; archive limits; free-space checks |
| T5 | User → settings | JVM args as code exec (`-javaagent`, `-XX:OnError=`) | Allow-list for non-admins; admins free-form with warning ([below](#jvm-arguments)) |
| T6 | User → server dir | Planting files that mcm later trusts (pid files, manifests, trash metadata) | mcm state lives outside server dirs; restored manifests validated as untrusted ([below](#untrusted-server-directory)) |
| T7 | External APIs | Malicious pack: arbitrary URLs, path escape | Host allow-lists; `RelPath`; hash verification; size caps |
| T8 | Downloads | MITM / tampering | HTTPS only; hash verification wherever the source provides one |
| T9 | Relay | Open proxy, hostname hijack, DoS | P9 relay rules (assigned hostnames only, limits, timeouts) |
| T10 | Network | RCON / management protocol exposure | RCON off until P5; strong random secrets; loopback when possible; UI warning when public ([minecraft-protocols.md](minecraft-protocols.md#rcon-source-rcon-over-tcp)) |
| T11 | Logs, files | Secret leakage | `Secret<T>`; audit allow-list ([audit.md](audit.md)); `server.properties` secret redaction ([below](#secret-properties)) |
| T12 | SSRF | URL fetches hitting internal services | One SSRF-safe client for every fetch ([below](#outbound-http-ssrf)) |
| T13 | Router/relay | Real player IP hidden → bans hit everyone | Warn when backend lacks PROXY protocol; block `ban-ip` of loopback/relay addresses ([below](#player-ip-integrity)) |

## JVM arguments

- **Non-admins** (any runtime): every arg must match the vetted allow-list in `crates/mcm-core/data/jvm_allowlist.toml`, each entry a regex for the full token:
  - GC/tuning: `-XX:[+-](UseG1GC|UseZGC|ZGenerational|UseShenandoahGC|UseParallelGC|ParallelRefProcEnabled|DisableExplicitGC|AlwaysPreTouch|PerfDisableSharedMem|UnlockExperimentalVMOptions|UseStringDeduplication|UseCompactObjectHeaders)`; `-XX:(MaxGCPauseMillis|G1NewSizePercent|G1MaxNewSizePercent|G1HeapRegionSize|G1ReservePercent|G1HeapWastePercent|G1MixedGCCountTarget|G1MixedGCLiveThresholdPercent|G1RSetUpdatingPauseTimePercent|InitiatingHeapOccupancyPercent|SurvivorRatio|MaxTenuringThreshold|ActiveProcessorCount|MaxMetaspaceSize|ReservedCodeCacheSize)=[0-9]+[kKmMgG]?`; `-Xss[0-9]+[kKmM]`.
  - `-D` only for vetted keys with value regexes: `file.encoding`, `user.timezone`, `java.net.preferIPv4Stack`, `log4j2.formatMsgNoLookups`, `using.aikars.flags`, `aikars.new.flags`, `terminal.jline`, `terminal.ansi`, `IReallyKnowWhatIAmDoingISwear`, `paper.disableChannelLimit`.
  - `-Xms`/`-Xmx` are rejected in `jvmArgs` (use memory fields: `settings.memory_in_jvm_args`); everything else → `422 settings.jvm_arg_not_allowed` naming the token.
- **Admins**: free-form; response includes warning `jvm_args_admin_freeform` and the UI shows it.
- Test vectors shared by Rust and the UI: `testdata/validation/jvm_args.json`.

## Untrusted server directory

Everything under `<data>/servers/<id>/` is writable by users (files, uploads, packs, restores) and is **untrusted input** to mcm:
- mcm state (pid, console logs, crash logs, install log, trash metadata, shim sockets) lives in `<data>/state/<id>/` ([filesystem-layout.md](filesystem-layout.md)).
- Backup manifests (`mcm-backup.json`) and pack metadata read from archives are parsed as untrusted: paths via `RelPath`, `LaunchSpec::Custom` rejected, Java paths ignored (re-resolved by mcm), unknown fields ignored, size-capped.
- Vendor scripts are parsed, never executed.

## Secret properties

Keys marked `secret` in the properties schema (`rcon.password`, `management-server-secret`, `management-server-tls-keystore-password`) are replaced with `********` in file read, file download, folder-zip download, and properties API responses for principals **without `console.write`** on that server. Writing back the placeholder keeps the stored value. Backup downloads include secrets and therefore require `console.write` in addition to `backups.read`.

## Outbound HTTP (SSRF)

`mcm_download::SafeHttp` is the **only** outbound HTTP client (P1 onward): installers, packs, Java, webhooks, custom URLs, Mojang profile lookups.
- Custom DNS resolver: resolves, then rejects loopback, private (RFC 1918), CGNAT 100.64/10, link-local, ULA `fc00::/7`, multicast, unspecified, and IPv4-mapped forms of these unless `security.allow_private_targets = true` (or the URL matches a configured test base URL under `test-hooks`).
- **IP pinning**: the vetted address is used for the connection (no second resolution → no DNS rebinding).
- Redirects followed manually (max 5), re-validating scheme (HTTPS only, except test hooks) and target IP per hop.
- Response size caps per caller; timeouts (connect 10 s, total per caller).

## Player IP integrity

- When a server is reachable through the router (P7) or relay (P9) and its backend does not accept PROXY protocol, every player appears as `127.0.0.1`/the relay address. The Network tab and players page show a warning ("IP bans and IP-based plugins will not work").
- `ban-ip`/`pardon-ip` (P2) rejects loopback (`127.0.0.0/8`, `::1`), unspecified, and configured relay/trusted-proxy addresses: `422 players.ban_ip_forbidden`.

## SandboxRoot (path safety) — `mcm-fs`

```rust
pub struct SandboxRoot { root: PathBuf /* canonicalized */ }
impl SandboxRoot { pub fn resolve(&self, user: &str) -> Result<Resolved, FsError>; }
```

1. Reject `\0`, input > 4096 bytes, any component > 255 bytes.
2. Normalize separators; treat as relative.
3. Lexical `..` above root → reject (never clamp); drop `.`.
4. Walk component by component with `openat`/`O_NOFOLLOW` semantics (`cap-std`): symlinks are listed (`type: "symlink"`) but never followed (`fs.symlink`).
5. Operate on the opened handle (TOCTOU-safe).

Archive extraction:
- Entry names → `RelPath`; reject absolute, `..`, symlink/hardlink, device entries (internal opt-in `allow_internal_symlinks` only for JRE tarballs: relative links resolving inside the root).
- Caps: total uncompressed 20 GiB (configurable), 200k entries, per-entry ratio > 200:1 for entries > 10 MiB aborts.
- **Free-space precheck**: free bytes on the target filesystem ≥ declared uncompressed size + max(10 %, 512 MiB), else `507 fs.no_space`; re-checked while writing.
- Uploads go to `<data>/tmp` then `rename`.

Trash: deletes move items to `<data>/state/<id>/trash/` (with metadata there). Items are kept **at least 24 h**; after that the GC removes oldest first while free disk < max(10 %, 5 GiB), and unconditionally after 7 days.

## HTTP security headers and CSP (P0)

| Header | Value |
|---|---|
| `Content-Security-Policy` (response header set by mcm on `index.html`) | `default-src 'self'; script-src 'self' <hashes>; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | only when mcm terminates TLS |

- SvelteKit `kit.csp = { mode: "hash" }` hashes its inline bootstrap; the build emits those hashes, and `mcm-server` reads them from the built `index.html` meta at startup to put in the header (single source).
- `style-src 'unsafe-inline'` is required by CodeMirror 6 and xterm.js (dynamic `style` attributes). No inline `<script>` beyond SvelteKit's.
- `mode-watcher`: its inline head script is disabled (`disableHeadScriptInjection`, to verify); theme is applied by `/theme-init.js`, a static same-origin file referenced from `app.html`.
- E2E asserts zero CSP violations on every page ([../testing/e2e.md](../testing/e2e.md)).

## Process isolation stance

| Runtime | Isolation | Phase |
|---|---|---|
| Native | Process group, same OS user as mcm. Not a boundary between servers (single-trust, above) | 1 |
| Native + dedicated OS user | Run mcm as `mcm` (systemd unit) to protect the rest of the host | 1 (packaging) |
| Docker | Container per server, cap-drop ALL, no-new-privileges, read-only rootfs, limits | 10 |

## Transport

Default listen `127.0.0.1:8420`; TLS via reverse proxy or built-in (`[http.tls]`). `Secure` cookies unless `http.allow_insecure_http`. Non-loopback listen requires `public_url` ([config.md](config.md)).

## Secrets storage

- Master key `<data>/secret.key` (0600). Encrypted columns use XChaCha20-Poly1305; **AAD = `"<table>.<column>:<row_id>"`**, so ciphertexts cannot be swapped between rows or columns.
- CurseForge key: `MCM_INTEGRATIONS__CURSEFORGE_API_KEY` env / `integrations.curseforge_api_key` config / settings UI (encrypted). Env wins.

## Supply chain

`cargo-deny`, `cargo-audit` nightly, `pnpm audit --prod`; lockfiles committed; Renovate weekly.
