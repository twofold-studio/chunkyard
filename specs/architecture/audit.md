# Audit log

Catalog and types: `mcm-core::audit`. The `AuditService` trait is in `mcm-core`, implemented on top of `AuditRepo` (`mcm-db`) and wired in `mcm-server`. Table: `audit_log` ([data-model.md](data-model.md)).

## Naming

- Format: `<area>.<object>.<verb>` or `<area>.<verb>`; segments match `[a-z][a-z_]*`; the **verb is always last**.
- Every name below is a variant of `mcm_core::audit::Action`. Phase specs must use these exact strings; adding an action means adding it here and to the enum.
- Failed attempts are recorded under the same action with `outcome = "failure"` (e.g. failed login = `auth.login` + failure), never under a separate name.
- System-initiated actions (auto-start, crash restart, schedules, retention) use `actor_user_id = NULL` and `details.trigger` (`autostart`, `crash_restart`, `schedule:<id>`, `retention`).

## Catalog

| Phase | Actions |
|---|---|
| 0 | `auth.setup`, `auth.login`, `auth.logout`, `auth.password.change`, `auth.password.reset` (CLI), `auth.token.create`, `auth.token.revoke`, `auth.totp.enable`, `auth.totp.disable`, `auth.recovery_codes.regenerate`, `auth.session.revoke`, `settings.update` |
| 1 | `server.create`, `server.update`, `server.delete`, `server.clone`, `server.start`, `server.stop`, `server.restart`, `server.kill`, `server.eula.accept`, `console.command` |
| 2 | `server.settings.update`, `server.properties.update`, `players.whitelist.update`, `players.ops.update`, `players.bans.update`, `files.write`, `files.upload`, `files.delete`, `files.move`, `files.copy`, `files.mkdir`, `files.archive`, `files.extract`, `files.download` |
| 3 | `java.install`, `java.remove`, `java.discover`, `server.install`, `server.install.rollback` |
| 4 | `integrations.curseforge.update`, `content.install`, `content.update`, `content.remove`, `content.enable`, `content.disable`, `pack.import`, `pack.import.cancel`, `pack.manual.resolve`, `pack.manual.skip`, `pack.finalize` |
| 5 | — (read-only phase; settings changes use `server.settings.update`) |
| 6 | `backup.create`, `backup.update`, `backup.delete`, `backup.restore`, `backup.download`, `backup.import`, `backup.verify`, `backup.policy.update`, `backup.retention.delete`, `storage_target.create`, `storage_target.update`, `storage_target.delete`, `schedule.create`, `schedule.update`, `schedule.delete`, `schedule.run`, `schedule.run.cancel`, `world.upload`, `world.download`, `world.reset`, `world.activate`, `world.delete` |
| 7 | `proxy.route.create`, `proxy.route.update`, `proxy.route.delete`, `proxy.settings.update`, `portmap.create`, `portmap.delete`, `portmap.probe` |
| 8 | `user.create`, `user.update`, `user.delete`, `user.disable`, `user.enable`, `user.password.reset`, `user.invite.create`, `user.invite.revoke`, `user.invite.accept`, `permission.grant`, `permission.revoke`, `notify.channel.create`, `notify.channel.update`, `notify.channel.delete`, `notify.channel.test`, `audit.export` |
| 9 | `relay.connection.create`, `relay.connection.update`, `relay.connection.delete` |
| 10 | `server.runtime.change` |
| 11 | `node.create`, `node.update`, `node.delete`, `server.migrate` |

Note: **event** names (notifications, bus events such as `server.crashed`, `backup.succeeded`) are a separate namespace and use past tense; they are not audit actions.

## Details scrubbing

- `details` is built with `AuditDetails::builder()` using an **explicit allow-list of fields per action** defined next to the enum (e.g. `server.properties.update` → `changed_keys`, plus `values` only for keys not marked secret in the properties schema; `files.write` → `path`, `size`; `auth.login` → `username` on failure only).
- Never included: request bodies, file contents, passwords, tokens, RCON/management secrets, webhook URLs, S3 credentials.
- Test: `audit_details_only_contain_allow_listed_fields` (iterates all actions with a fuzzed input map) in `mcm-core`.

## Visibility

- Admins see everything (`/admin/audit`).
- Per-server audit view (P8) shows entries with `server_id = X` to users with `server.view`; **`console.command` rows additionally require `console.read`** (commands can reveal player data and moderation actions).

## Retention

365 days default (`audit.retention_days` setting), hourly sweeper.
