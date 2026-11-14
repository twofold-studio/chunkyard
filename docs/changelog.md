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

Use `changie batch 0.2.0 --dry-run` to preview notes without consuming fragments. Keep work under Unreleased while any requested implementation or verification remains unfinished.
