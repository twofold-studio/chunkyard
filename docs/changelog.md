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

When preparing a release, choose an explicit version and run:

```sh
changie batch 0.1.0
changie merge --include-unreleased '## Unreleased'
```

The version above is an example for the first release, not an already published release. Batching combines the pending fragments into a version file under `.changes/` and consumes those fragments; the version file retains their notes. Review the result, update the Cargo workspace version and lockfile separately, and run the relevant checks. Changie is configured only to manage release notes: it does not change crate versions, commit, tag, or publish anything.

Use `changie batch 0.1.0 --dry-run` to preview notes without consuming fragments. Ongoing work remains under Unreleased until a release is requested.
