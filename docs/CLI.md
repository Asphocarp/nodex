# CLI Reference

## Purpose

The packaged `nodex` binary is a native Adapter over the same private Core used
by the desktop app. It is the supported local interface for shell-capable
agents, scripts, inspection, and semantic mutations. Run `nodex --help` and
`nodex --json <command> --help` for the executable command catalog, validators,
result schema revision, error codes, and examples; those generated results are
authoritative when this overview and the binary disagree.

The CLI never exposes a database path, raw SQL, Core bearer capability, physical
rank, Yjs storage coordinate, or Desktop renderer state.

## Local Profile clones

`nodex profile clone --from <profile-home> --to <new-profile-home>` is the
offline provisioning command for production-shape local testing. It selects the
latest current evidence-backed, assets-inclusive published backup by default;
`--backup <id>` selects an exact current backup. Create a fresh backup when only
an older manifest exists. The target and its parent must be local real paths,
and the target must not already exist.

This command does not connect to or launch the source Profile's Core. The Core
Administration materializer verifies the published database SHA-256 and
deterministic asset-tree digest after copying through a private staging
directory. On macOS, regular-file copies prefer APFS copy-on-write and fall back
to ordinary copy when unavailable. The materializer preserves semantic
identities and the imported Store epoch, remints instance secrets, performs the
clone-specific semantic checks, then atomically publishes the target with a
`profile-snapshot.json` receipt. It copies neither Agent credentials nor
arbitrary files from the source Profile. The receipt records the evidence-backed
local-fork provenance and reports managed asset references that were already
missing from the source backup; formal restore continues to require a complete
asset closure and rotates the installed Store epoch.

## Installation and capabilities

The macOS app bundle distributes the CLI and Core as one update closure. The app
menu's `Install Command Line Tool…` action manages its user-local command link;
package-manager installation may link the same bundled binary. Neither path
copies a separately updatable executable or edits shell startup files.

`nodex capabilities --json` is a side-effect-free compatibility handshake. It
runs before Profile/Project discovery and reports the Agent API, Nested Markdown
revision, command capabilities, deep-link kinds, and packaged Skill identity.
An unpackaged development binary reports an unavailable bundle rather than
creating Profile state.

## Context and reads

Profile selection follows nonblank `NODEX_HOME`, the nearest project config,
the user config, then the default home. A command that needs Project authority
accepts explicit identity or resolves the longest containing managed-worktree
or source root; ambiguous matches fail with stable candidates.

The primary read families are:

- `context` and `tree` for bounded Project/Library orientation;
- `read` for canonical Page metadata and `body.nested.md`;
- `history` for a retained cursor timeline;
- `view query` for one saved View's persisted query and row order;
- `rg` for exact read-only search over a Core-issued immutable snapshot lease;
- `open page` and `open view` for validated Nodex deep links.

Page selectors resolve canonical `@pageId` first, then an authorized current or
historical Page key, then an explicitly unique supported title path. Key input
accepts documented case normalization, one optional leading `#`, and
no-hyphen shorthand; output reports canonical current `page_key` alongside
`page_id`. If compact input maps to more than one authorized Page, the command
reports ambiguity and asks for a canonical hyphenated key or `@pageId` rather
than choosing one. An explicit `#` miss does not fall back to a title path.
Core resolves the alias inside the selected Project before the CLI invokes the
UUID-based operation. Other selectors use stable typed
identities or an explicitly unique supported name or path. Unauthorized
alternatives are never returned as disambiguation evidence. All growing
collections are bounded and use opaque continuations.

## Drafts and mutations

`draft create` materializes one bounded Page editing workspace with immutable
base, editable work, a direct Page File manifest, and a private manifest. File
bytes remain lazy and are read through explicit semantic commands; a draft is
not a mounted checkout or authority.
`draft diff` is local. `draft apply` rereads current authority, semantically
merges the supported title/body changes when safe, and commits them atomically.
`draft discard` removes only a validated generated draft.

Semantic mutation families create, duplicate, move, rename, replace, patch,
insert, or delete Pages and stable Blocks. Nested Markdown is the normal bulk
content format; identity-sensitive structure uses the bounded JSON Block form.
Page deletion always uses the typed lifecycle path. For a nested Page, the
headless CLI resolves and fences the current canonical host Document inside the
same writer transaction; it never emits a generic Document deletion.
Move and View placement consume one exact validator and commit membership,
group value, position, ownership, Documents, projections, and receipt as one
semantic operation.

Every mutation accepts a stable idempotency key. Narrow ETags bind the current
resource and guard kind; they are not capabilities. An exact retry returns the
first immutable result. A stale or mismatched guard fails before mutation and
requires a fresh read.

## Page Files

`nodex page file` provides generic exact-format resource operations under the
selected Project and owner Page:

```text
nodex page file list <page-selector> [--include-deleted]
nodex page file read <page-selector> --file <id-or-path> --output -
nodex page file put <page-selector> --path references/api.md --from ./api.md [--turn-id <turn-id>]
nodex page file rename <page-selector> --file references/api.md --to references/v2.md [--turn-id <turn-id>]
nodex page file delete <page-selector> --file references/v2.md [--turn-id <turn-id>]
nodex page file versions <page-selector> --file <id-or-path>
nodex page file restore <page-selector> --file <id-or-path> --version 2 [--turn-id <turn-id>]
```

`put` creates a File or replaces the current File at the exact logical path. It
streams a regular source file, or accepts bounded stdin with `--from -`, then
commits one semantic Core operation. Repeating the same `put` with the same
idempotency key and bytes returns the first immutable result even after the
first call committed. `read --output -` emits exact bytes;
other outputs are regular local files. File selectors accept a stable File ID
or an exact logical path. Listing and version history are paged;
`--include-deleted` makes retained deleted identities and paths discoverable for
history inspection and restore. No command exposes a Profile path or blob-hash
read capability.

Paths use portable `/`-separated Page-relative syntax. Traversal, symlinks,
special files, invalid portable names, and files larger than 64 MiB are rejected.
Rename and replace preserve File identity. Delete fails while the File is still
placed in its Page body. All mutation results include the resulting manifest
revision and exact created, updated, or deleted File IDs.

## Search leases

`nodex rg` asks Core for a short-lived immutable projection of authorized Page
metadata and canonical content. The CLI validates the lease manifest, paths,
permissions, lengths, and hashes before running the bundled ripgrep with the
supported read-only flags. Physical lease paths are never writable inputs and
are released after success, failure, or interruption.

## Service and diagnostics

`nodex service status|enable|disable` controls optional packaged Core prewarming;
normal commands always retain authenticated on-demand startup. `nodex doctor`
and typed validation reports are the supported storage diagnostics.

The retired JavaScript HTTP launcher, direct-SQL commands, and storage
inspection interfaces are not supported. External automation uses this CLI;
desktop UI uses typed preload/Main Adapters.

## Agent Skill setup

`nodex setup` and `nodex skills status|install|remove|doctor` manage only the
official global Codex and Claude Code Skill targets. They verify the packaged
artifact and create/remove only an exact managed link. Existing foreign files,
directories, and links are reported as compatible or conflict and are never
adopted, overwritten, or force-repaired.

The product-level authority and consent contract is in
[Agent Interface Behavior](product-specs/agent-interface-behavior.md).
