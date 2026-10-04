# Remote collections design

## Decision

Agentfolio accepts a git source wherever it accepts a collection directory. A new explicit `agentfolio sync` command fetches the source into one fixed managed clone, checks out one resolved commit, and runs the collection's optional `prepare` command. All other commands stay offline and read the managed clone.

## Problem

Today `--collection` and `AGENTFOLIO_COLLECTION` accept only a local directory (`findCollectionRoot()` in `src/lib/collection.mjs`). To use a published collection, a user must clone it, install its dependencies by hand, and then run Agentfolio from the checkout.

Agentfolio cannot tell the user that a dependency step is missing. With `luabagg/agent-skills`, a fresh clone without `npm ci` passes `doctor` and `plan`. `apply` then fails at the first adapter action that imports a missing package, and Agentfolio reports only `Adapter agent-skills apply pi:configure rejected request`.

## Who benefits

Users who consume a collection that another person writes. An author who edits a collection keeps a normal checkout. The author gets only the `prepare` step from this design. Build this feature only if other people consume collections.

## Source syntax

A `--collection` or `AGENTFOLIO_COLLECTION` value is a git source when it matches one of these forms. Every other value is a directory, as today.

| Form | Example | Clone URL |
| --- | --- | --- |
| GitHub shorthand | `github:luabagg/agent-skills` | `https://github.com/luabagg/agent-skills.git` |
| URL | `https://…`, `ssh://…`, `file://…` | unchanged |
| scp-like | `git@github.com:luabagg/agent-skills.git` | unchanged |

An optional `#<ref>` suffix selects a branch, a tag, or a full 40-character commit SHA. Without a ref, Agentfolio uses the remote `HEAD`. A name that is both a tag and a branch resolves to the tag, as in `git rev-parse`.

Agentfolio refuses:

- an `https` URL with user info, and any URL with a password. Git would store the credential in `.git/config`.
- a ref that starts with `-`, contains `..`, or contains a character outside `[A-Za-z0-9._/-]`. Git could read such a ref as an option or a range.

## Managed clone

The managed clone lives at `$AGENTFOLIO_HOME/collections/<host>/<path>`. `AGENTFOLIO_HOME` defaults to `~/.agentfolio`. This is Agentfolio's own data directory, not a harness target, so the rule that Agentfolio knows no home-directory targets still applies. The path does not include the ref. GitHub shorthand, `https`, `ssh`, and scp-like forms of one repository map to one path.

The path is fixed because adapters link files into the collection root. For example, `luabagg/agent-skills` links `~/.claude/AGENTS.md` to `<root>/AGENTS.global.md`. A directory per commit would break those links on each update. Agentfolio also could not delete old directories safely, because adapters own the links.

Sync refuses a managed clone when:

- a tracked file has local changes. Untracked files, such as `node_modules/`, do not block sync.
- its `origin` URL is different from the requested URL. The user removes the directory to switch URLs.

## Sync state

After a successful sync, Agentfolio writes `.git/agentfolio-sync.json` in the managed clone with `url`, `ref`, `commit`, and `syncedAt`. The file is inside `.git/`, so it is never part of the collection tree.

Sync removes the file before it changes the checkout. Other commands refuse a managed clone when the file is missing or when its `commit` is different from `HEAD`. Thus Agentfolio never uses a clone after an interrupted or failed sync. There is no automatic rollback. The error message prints the last synced commit, and the user runs `agentfolio sync <url>#<commit>` to return to it.

## Commands

- `agentfolio sync <source> [--dry-run]`
  - Resolves the target commit with `git ls-remote`. A dry run prints the current and target commits and stops. It writes no files.
  - Otherwise it clones (or fetches), checks out the target commit as a detached `HEAD`, loads and validates `collection.yaml`, runs `prepare`, and writes the sync state.
- `agentfolio sync [--collection DIR] [--dry-run]` with no source
  - Runs `prepare` for a local collection. A dry run prints the `prepare` argv.
  - This gives an author one command in place of a collection-specific install step.
- `plan`, `apply`, `doctor`, `verify`, and `list` with a source
  - Use the synced managed clone and never fetch.
  - Fail with `Run: agentfolio sync <source>` when the source is not synced.
  - When the source names a ref, the synced ref must be the same. Otherwise `plan --collection github:o/r#v2` could silently use a clone synced at `#v1`. A source without a ref uses whichever ref was synced.
  - `plan` text and `doctor` show `Source: <url> @ <commit>`.

## Schema: `prepare`

```yaml
prepare:
  executable: npm
  args: [ci, --ignore-scripts, --no-audit, --no-fund]
  timeout: 600000
```

`prepare` is an optional top-level mapping with the same fields and validation as an adapter. Agentfolio runs it as literal argv with `shell: false` from the collection root. The default timeout is 600000 ms. Only `sync` runs it.

`runProcess()` captures at most 64 KiB per stream, and output above that limit stops the child. Collections must use quiet flags.

The schema stays `version: 1`. Agentfolio 0.1.x rejects a collection that declares `prepare` with `unknown top-level field: prepare`. Release this feature as 0.2.0, and document 0.2.0 as the minimum version for `prepare`.

## Network, trust, and credentials

- Only `sync` uses the network. This extends the existing rules: the Skills CLI stays pinned, there are no network installs during normal operation, and there are no collection registries. A source is a plain git URL, not a registry entry.
- Syncing a source trusts it, the same as cloning it by hand. `sync` runs `prepare`, and every later command runs adapters from the clone. `sync` prints the commit. `#<sha>` gives an exact pin. A branch ref moves only when the user runs `sync` again.
- Git uses the user's SSH agent or credential helper. Agentfolio sets `GIT_TERMINAL_PROMPT=0` so git never waits for input. Agentfolio never reads, stores, or prints credentials.

## Requirements

`git` must be on `PATH` for `sync` and for commands that use a managed clone.

## Effort

| Scope | Estimate | Note |
| --- | --- | --- |
| Clone wired into collection discovery | ~1 day | Not useful alone. The dependency step stays manual. |
| This design | 2 to 4 days | Sync, prepare, sync state, local-change refusal, docs, tests |
| This design plus update and lock commands, old-clone cleanup, Windows paths | ~1 week | Not planned |

## Excluded

- Windows support for `prepare` and `file://` sources. Adapters have the same limit today: an executable such as `npm.cmd` must be named literally.
- Tarball or GitHub API downloads. They need tokens for private repositories, and Agentfolio rejects credentials.
- Abbreviated SHAs and SHA-256 repositories.
- Lock files that record pins in a collection or a user configuration file.
- Cleanup of managed clones. To remove one, delete its directory.
- Automatic sync from `plan` or `apply`.

## Considered: OKF knowledge bundles

[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) (OKF, v0.2) is a directory of Markdown concept files with YAML frontmatter, a required `type` field, and optional `index.md` and `log.md` files.

Decision: OKF is not part of Agentfolio core.

- OKF defines content, not placement. Its non-goals exclude storage, serving, and packaging. Agentfolio has no generic apply step for a bundle.
- Agentfolio keeps `skills.imports` and `tools.catalog` reference-only until an executable, pinned contract exists. A `knowledge:` field would be one more field with no behavior.
- The only generic part, fetching and pinning a git source, is the `sync` primitive in this design. Connecting a bundle to a harness, for example through a skill path, an `AGENTS.md` line, or an MCP server, is adapter work that the collection owns.

Revisit after `sync` ships if a collection needs pinned knowledge sources next to its own root. Then add source entries that `sync` fetches, and give adapters their paths.

## Follow-up in `luabagg/agent-skills`

After the 0.2.0 release:

1. Declare `prepare: { executable: npm, args: [ci, --ignore-scripts, --no-audit, --no-fund] }` in `collection.yaml`.
2. Change the README Quick Start to `agentfolio sync github:luabagg/agent-skills`, then `agentfolio apply --profile default --collection github:luabagg/agent-skills`.
3. Keep the clone path for authors, with `agentfolio sync` in place of `npm ci`.
