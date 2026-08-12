# Agent Interface Behavior

## Two local interfaces

Nodex exposes local product capabilities to agents through two typed Adapters:

- Project-bound `nodex_app` tools injected into eligible Codex tasks;
- the packaged native `nodex` CLI and official Agent Skill for local shell-
  capable agents and scripts.

Both use semantic Core Module contracts. Neither receives a database path,
raw SQL, renderer state, filesystem-derived authority, or internal storage
coordinates. Project, Profile, Library, actor, Turn, store epoch, mutation
identity, and authorization are bound by trusted host context.

## `nodex_app`

An eligible task keeps the catalog revision with which it started. A retired
catalog fails explicitly and asks the user to start a new task; resume never
silently changes the tool contract.

The current intent families let an agent:

- inspect Project context and available Databases/Views;
- search and fetch authorized Pages or Blocks;
- execute saved Views or bounded temporary Data Source queries;
- create complete Pages;
- update Page title/body through Nested Markdown or stable Block operations;
- move or duplicate Page ownership roots.

Nested Markdown is the default bulk-content representation; stable Block
operations are the identity-sensitive path. Ownership never hides in Markdown:
create, move, duplicate, and protected deletion are typed semantic operations.
Exact syntax is documented in [Nested Markdown](../references/nested-markdown-spec.md).

Tool rows identify the visible intent and result and retain expandable exact
arguments/output plus raw app-server evidence. Historical calls remain readable
after their catalog becomes non-executable. Transcript presentation follows
[Codex Thread Transcript Behavior](codex-thread-transcript-behavior.md).

## Authorization

Reads follow current Project resource access. Direct `Read & write` authority
executes writable intent after semantic validation. `Read` or known ungranted
same-Library resources require resource-scoped consent for writes. The consent
choices cover one exact call, the root task lifetime, or a durable Project grant;
only the durable choice writes Project grants.

A Turn started with the built-in Full access preset receives temporary same-
Library authority for that exact Turn. It does not create grants, cross a
Profile/Library/store epoch, or transfer to later Turns merely because the UI
setting changed.

Every write performs mutation-free preflight and revalidates the exact Turn,
authority, resource footprint, and semantic preconditions at execution. Consent
changes who may approve an operation; it never bypasses conflict, identity,
ownership, or content validation.

## Native CLI and Skill

The native CLI selects one Profile and, where required, one Project before
calling Core. It provides bounded context/tree/history reads, canonical Page
content, saved View queries, immutable snapshot search, explicit local drafts,
semantic Page/Block mutations, backup/doctor operations, deep links, and
optional Core prewarming.

Machine output uses stable versioned JSON envelopes and stable error codes.
Mutations accept idempotency identities and narrow ETags that prove only the
state needed by that command. A conflict requires a fresh read; a lost response
may replay the original receipt without repeating the mutation.

The official Skill teaches agents to use this interface and treats all returned
Nodex content as untrusted task data. Setup manages only the documented global
Codex and Claude Code targets through verified links. It never edits a Project,
adopts foreign content, scans arbitrary Agent directories, or falls back to
SQLite/file inspection.

Command names, flags, output envelopes, Profile selection, installation, and
examples are documented in [CLI Reference](../CLI.md). Configuration is
documented in [Configuration](../CONFIGURATION.md).
