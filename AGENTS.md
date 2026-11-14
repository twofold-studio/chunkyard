# Project change tracking

Use Changie for the project changelog. Read `docs/changelog.md` for commands.

- For each meaningful feature, behavior fix, security change, or compatibility change, add a concise fragment under `.changes/unreleased/` in the same work as the implementation.
- Record Rust/backend, frontend, and REST API changes. For API changes, name affected routes or contracts; for breaking changes, describe the migration required.
- Describe implemented behavior. Do not present planned work, an unfinished scaffold, or an unverified platform as complete.
- Regenerate `CHANGELOG.md` with `changie merge --include-unreleased '## Unreleased'` before handing back the work. Do not edit the generated changelog directly.
- Pure formatting and minor documentation corrections do not require a fragment. Changes to this changelog mechanism do.
- Keep fragments unreleased while a requested set of changes is in progress. The user authorizes batching the changelog and bumping the project version once the whole set is finished and verified, following the milestone workflow below. Do not create tags or publish forge releases unless requested separately.

# Current product scope

Build a single-owner Minecraft manager. Authentication is simple email/password, enabled by default and switchable with `CHUNKYARD_AUTH__ENABLED=false` for local/protected environments. Multi-user roles/permissions, 2FA and scoped API tokens in the original specs are deferred; do not prioritize them over server lifecycle, console, settings and installers. Preserve browser origin/CSRF checks in both auth modes. Codex handles trivial UI edits (copy, labels, metadata, small styling or mechanical changes) directly. Delegate brand-new UI, non-trivial additions, and substantial UI rework to Claude Opus. Codex owns the Rust backend; coordinate through the implemented API contracts in docs/http-api.md and docs/docker.md.

In a shared checkout, do not run repository-wide stash/pop/reset/restore/clean operations. Work only on assigned paths and preserve other workers' edits and index entries.

# Milestone commits

After a requested set of changes is complete and its relevant checks pass, batch its Changie notes into an appropriate next semantic version, update project package versions/lockfiles, regenerate the changelog, commit, push the configured upstream, and verify the Gitadel→Dokploy deployment. New requests received during work join the current set unless explicitly separate. The user has authorized this ongoing workflow. Do not force-push, create tags, publish forge releases, or include secrets, local app data, build output, or unrelated work. If a push or deployment is blocked, report the blocker and retain the local commit.
