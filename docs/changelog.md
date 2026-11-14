# Changelog workflow

We use [Changie](https://changie.dev/) for the whole project. Each meaningful change gets a small YAML fragment in `.changes/unreleased/`. The generated [changelog](../CHANGELOG.md) includes the current Unreleased notes and, once releases exist, their history. Rust crates and the frontend share this project changelog.

Add a note alongside the implementation:

```sh
changie new
changie merge --include-unreleased '## Unreleased'
```

Or supply the values directly:

```sh
changie new --kind Fixed --body 'REST API: reject expired sessions on Java runtime routes.' --interactive=false
changie merge --include-unreleased '## Unreleased'
```

On this NixOS host, use `nix run nixpkgs#changie --` before the subcommand instead of `changie`. Changie 1.26.0 was used to initialize and verify this setup. It adds no application runtime dependency.

Choose Added, Changed, Deprecated, Removed, Fixed, Security, or Breaking. Keep notes short and describe the resulting behavior. Name affected REST routes/contracts and explain migration steps for breaking changes. Backend-only implementation details belong in a note only when they affect behavior, compatibility, performance, or operation. Tiny formatting and documentation corrections need no note.

CI regenerates the changelog and checks for differences so fragments and the readable history stay synchronized. Future agents follow the rule in the root `AGENTS.md`.

The user authorizes a versioned milestone once the entire current set of requested changes is complete and verified. Choose the next semantic version, batch its notes, update Cargo/frontend/OpenAPI versions and lockfiles, then commit, push and verify deployment. Requests arriving during work join that set unless explicitly separate. Tags and forge release publication still require a separate request.

For the versioned changelog, run:

```sh
changie batch 0.2.0
changie merge --include-unreleased '## Unreleased'
```

Use the actual next project version in place of the example. Batching combines pending fragments into a version file under `.changes/` and consumes those fragments; that file retains their notes. Changie only manages release notes: package versions, lockfiles, commits, pushes and deployment checks are separate steps.

Update project metadata with the field-aware helper; a global version replacement can accidentally change dependency ranges:

```sh
node scripts/bump-version.mjs 0.9.1
cargo update --workspace --offline
node scripts/bump-version.mjs 0.9.1 --check
pnpm --dir web install --lockfile-only --frozen-lockfile --ignore-scripts
node --test scripts/bump-version.test.mjs
```

Substitute the intended numeric version. The helper changes only the Cargo workspace version, frontend project version, OpenAPI info version and HTTP version-response example. It leaves dependency requirements and other examples alone. Run the frozen-lockfile check before pushing, and generate the changelog before compiling: the API and its tests embed it at build time, so do not regenerate it during a Cargo test run.

Use `changie batch 0.2.0 --dry-run` to preview notes without consuming fragments. Keep work under Unreleased while any requested implementation or verification remains unfinished.
