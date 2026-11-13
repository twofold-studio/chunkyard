# Project change tracking

Use Changie for the project changelog. Read `docs/changelog.md` for commands.

- For each meaningful feature, behavior fix, security change, or compatibility change, add a concise fragment under `.changes/unreleased/` in the same work as the implementation.
- Record Rust/backend, frontend, and REST API changes. For API changes, name affected routes or contracts; for breaking changes, describe the migration required.
- Describe implemented behavior. Do not present planned work, an unfinished scaffold, or an unverified platform as complete.
- Regenerate `CHANGELOG.md` with `changie merge --include-unreleased '## Unreleased'` before handing back the work. Do not edit the generated changelog directly.
- Pure formatting and minor documentation corrections do not require a fragment. Changes to this changelog mechanism do.
- Keep unreleased fragments until a release is explicitly requested. Preparing a release is separate from adding a change note; do not batch fragments, change package versions, create tags, or publish as part of routine implementation.

# Current product scope

Build a single-owner Minecraft manager. Authentication is simple email/password, enabled by default and switchable with `MCM_AUTH__ENABLED=false` for local/protected environments. Multi-user roles/permissions, 2FA and scoped API tokens in the original specs are deferred; do not prioritize them over server lifecycle, console, settings and installers. Preserve browser origin/CSRF checks in both auth modes. Frontend implementation is delegated to Opus. Codex owns the Rust backend; coordinate through the implemented API contracts in docs/http-api.md and docs/docker.md.

# Milestone commits

After a meaningful implementation milestone passes its relevant checks, create a focused commit and push the current branch to its configured upstream. The user has authorized this ongoing workflow. Include its Changie fragments and regenerated changelog. Do not force-push, publish releases, or include secrets, local app data, build output, or unrelated work. If a remote push is blocked, report the blocker and retain the local commit.
