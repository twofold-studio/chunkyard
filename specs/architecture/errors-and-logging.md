# Errors, logging, tracing

## Problem details (RFC 9457)

```json
{
  "type": "https://mcm.dev/problems/server.busy",
  "title": "Server is busy",
  "status": 409,
  "code": "server.busy",
  "detail": "A backup job is running for this server.",
  "instance": "/api/v1/servers/0193.../start",
  "requestId": "01HZX...",
  "errors": [ { "field": "memoryMaxMb", "code": "range", "message": "must be ≥ memoryMinMb" } ]
}
```

- `code` is stable and documented; the UI switches on `code`, never on `title`/`detail`.
- `errors[]` present only for validation failures (`422`).
- `detail` never includes secrets, absolute host paths, or upstream response bodies verbatim (truncated to 200 chars and sanitized for upstream errors).

## ErrorKind → HTTP

| `ErrorKind` | Status | Example codes |
|---|---|---|
| `Invalid` | 422 (validation) / 400 (malformed) | `validation`, `fs.invalid_path`, `cron.invalid` |
| `Unauthorized` | 401 | `auth.required`, `auth.invalid_credentials`, `auth.totp_required` |
| `Forbidden` | 403 (or 404 when hiding existence) | `auth.forbidden`, `auth.reauth_failed`, `fs.escape`, `fs.symlink` |
| `NotFound` | 404 | `server.not_found`, `fs.not_found` |
| `Conflict` | 409 | `server.busy`, `server.running`, `server.port_in_use`, `name.taken` |
| `PreconditionFailed` | 412 | `etag.mismatch` |
| `PreconditionRequired` | 428 | `etag.required` |
| `TooLarge` | 413 | `upload.too_large` |
| `InsufficientStorage` | 507 | `fs.no_space`, `upload.insufficient_space`, `fs.quota_exceeded` |
| `RateLimited` | 429 | `rate_limited` |
| `Unavailable` | 503 | `setup_required`, `supervisor.unavailable` |
| `Upstream` | 502 | `upstream.curseforge`, `upstream.mojang` |
| `UpstreamConfig` | 424 | `curseforge.api_key_missing` |
| `Internal` | 500 | `internal` (details logged with `requestId`, not returned) |

## Job errors

Failed jobs store `error_code` (same code space) and `error_detail` (sanitized human message). UI renders jobs with the same problem component.

## Logging

- `tracing` + `tracing-subscriber`. Format: human (`pretty`) on TTY, JSON otherwise (`log.format = "auto"|"json"|"pretty"`).
- Filter via `log.level` or `RUST_LOG` (env wins).
- Log file: optional `log.file` with daily rotation (`tracing-appender`), keep 14.
- Every request span: `request_id`, `method`, `route` (matched template, not raw path), `status`, `latency_ms`, `principal` (user id, never username in debug of auth failures).
- Request id: `X-Request-Id` accepted if it is a valid ULID/UUID, otherwise generated; echoed in response.

## Tracing export

Optional OTLP exporter behind `log.otlp_endpoint` (feature `otel`, off by default). Not required for any phase exit.

## What NOT to log

Passwords, tokens, cookie values, `Authorization` headers, CurseForge key, S3 secrets, webhook URLs (contain secrets for Discord), RCON passwords, full file contents. Enforced by `Secret<T>` and a test that scans captured logs in integration tests for known secret values (`no_secrets_in_logs`).
