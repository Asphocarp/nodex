# ADR 0023: Rust Core Is the Exclusive Data Authority

## Status

Accepted — 2026-07-21

## Context

Nodex previously carried a TypeScript `better-sqlite3`/Yjs authority alongside
the native Rust Core migration. Keeping both implementations selectable made
schema ownership, recovery, scheduling, and Electron shutdown ambiguous. The
Codex app-server now also provides authoritative task-history search through
`thread/search`, so a Nodex-owned Thread transcript/FTS projection would be a
second search authority.

The final TypeScript release schema is v84. It removes the Nodex Thread search
shadow and is the last format that Core must import. Rust needs an unambiguous
ownership version after that boundary.

## Decision

- One detached Rust Core process exclusively owns each Profile's SQLite file,
  WAL, Yrs/Canvas Documents, semantic transactions, projections, receipts,
  schedules, backups, restore journal, migrations, and event replay.
- Electron remains the Desktop/Codex Host. It owns windows, renderer routing,
  Hono, filesystem/OS presentation, mounted-surface flush/freeze coordination,
  and Codex app-server execution, but never opens `nodex.db` or reconstructs a
  durable Document transaction.
- Startup accepts only an empty Profile, an exact final TypeScript v84 Profile,
  or an exact Rust-owned v85 Profile. A v84 import is physically validated and
  durably backed up before v85 is published. v83, schema drift, ambiguous
  ownership, future versions, and damaged v85 inventories fail closed. v85 is
  not silently repaired at reopen.
- The frozen `crates/nodex-core/schema/v84.sql` artifact is import/conformance
  evidence. It is not an executable TypeScript fallback or a generator target.
- Task-history search delegates only to Codex app-server `thread/search`.
  Nodex stores Workspace metadata used to enrich results but owns no Thread
  transcript units, FTS tables, backfill queue, or search index.
- Automation definitions, revisions, scheduling policy, due leases, runs,
  inbox/read/archive state, occurrences, and reminders are Core-owned.
  Electron submits semantic reschedule policies with an expected definition
  revision; it does not calculate or overwrite an arbitrary next-run timestamp.
- The public `nodex` command is the native protocol Adapter. The npm bin may
  locate and exec that binary, but implements no HTTP commands, SQL inspection,
  or storage fallback.
- IPC and loopback HTTP expose typed product contracts only. Arbitrary SQL and
  private Core lifecycle/Store Administration routes are not public surfaces.

## Consequences

There is no in-process authority selector or downgrade path. A failed Core
launch is a startup failure. Rollback requires stopping the new build and
restoring the labeled v84 pre-cutover backup with an older compatible build;
an older build must never open v85.

Module contracts, migration tests, the production bootstrap dependency audit,
failure matrix, no-Electron-database-handle test, and dual-architecture package
verification are release gates. Host fakes in tests must implement the same
typed ports rather than instantiate a hidden SQLite authority.
