# ADR 0046: Current Store migration baseline

## Status

Accepted — 2026-08-20

This decision supersedes the Store acceptance, TypeScript import, and v84/v85
cutover portions of [ADR 0023](0023-rust-core-exclusive-data-authority.md).
ADR 0023's Rust Core exclusive-authority decision remains in force.

## Context

The original Rust Core cutover retained every published Store migration and a
packaged JavaScript importer so early development Profiles could still reach
the current schema. All Nodex data in scope is now at the v130 Rust-owned
schema. Keeping the closed import path made fresh Store construction replay
historical migrations, preserved a second SQLite implementation in release
artifacts, and coupled startup, security, CI, and packaging to obsolete data
shapes.

Nodex still needs a migration facility. A Store revision remains a durable
format boundary, and a future schema change must be able to upgrade an
explicitly supported predecessor without weakening exact schema validation or
recovery.

## Decision

- The current Store is v131. Startup accepts an empty Store, an exact v131
  Store, or an exact v130 Store. v129 and earlier revisions, future revisions,
  non-empty revision-zero databases, schema drift, and corrupt Stores fail
  before backup or mutation.
- `crates/nodex-core/schema/current.sql` is the complete physical schema
  authority for fresh Stores. Fresh creation installs that snapshot and seeds
  Profile-specific secrets in one transaction, validates the current Store,
  and records no migration history. A failed first-open transaction leaves an
  empty database that can be retried.
- The Store format catalog publishes exact lineage, revision, and normalized
  schema fingerprint identities. It contains v130 as the minimum migratable
  baseline and v131 as readable/current. `PRAGMA user_version` remains the only
  revision authority inside SQLite.
- Core retains one small forward-only migration registry. Its only current
  step is v130 to v131. The step removes closed import metadata, installs the
  general migration-history table, and converges on the exact same inventory
  as a fresh v131 Store.
- A supported migration validates the source identity and semantic preconditions,
  including exact Document reconstruction, before it reports migration or
  publishes a content-addressed SQLite Online Backup. It then applies its
  complete change and validates exact current physical and semantic invariants
  in one `BEGIN IMMEDIATE` transaction. SQLite rollback leaves the source
  revision intact when the step or target validation fails.
- `core_store_migration_history` records the source and target revisions and
  fingerprints, backup basename, and completion time in the migration
  transaction. It is diagnostic/recovery evidence, not a second revision
  authority. Reopening a current Store neither migrates again nor creates
  another backup or history row.
- Rust Core remains the only SQLite and Document authority. Electron no longer
  renames `kanban.db`, launches a JavaScript importer, injects migrator
  coordinates, or packages a migration sidecar. Existing unrecognized files
  and old backups are left untouched; they are not adopted as Store authority.
- Every future Store bump must explicitly declare its accepted source window.
  Before changing the current schema, maintainers freeze a representative
  database produced by the exact current Core. Tests must prove that migrating
  that fixture and installing the new current snapshot converge to the same
  catalog fingerprint, and must cover backup, rollback, reopen, drift, and
  unsupported-source behavior. Historical steps and fixtures outside the
  declared window do not remain merely because Git once published them.

## Consequences

Fresh Profile creation and ordinary current-Store startup have no dependency on
historical migration code. The packaged runtime contains only native Store
preparation and the resources required by the current product.

A Profile older than v130 is intentionally unsupported by this release. Nodex
does not guess, partially import, or silently repair it. Recovery from a failed
v130-to-v131 deployment uses the verified pre-migration backup and a build that
can open v130; no down migration is provided.

The migration module stays small without becoming disposable. Adding a future
revision means changing the current snapshot, catalog, one or more explicit
forward steps, the frozen predecessor fixture, generated Host requirements,
and their behavioral evidence together.

## Rejected alternatives

### Keep the full migration chain as archival code

Git already retains that history. Executable archival code expands the startup
and release trust boundary and makes current construction depend on paths that
no supported Store can enter.

### Change v130 in place

Changing physical schema while retaining its published revision and
fingerprint would make runtime compatibility ambiguous. v131 gives the cleanup
an exact, externally testable identity.

### Replace the live database with a migrated staging file

The native migration runs trusted Rust code after a verified backup. SQLite's
transaction boundary provides atomicity without adding WAL publication,
filesystem replacement, Store-epoch rotation, or replacement-journal states to
ordinary forward migration.

### Remove migration infrastructure entirely

That would make the next schema revision a bespoke startup rewrite. Retaining a
small registry and stable preparation interface preserves the safety contract
without preserving obsolete transformations.

## Acceptance

Fresh v131 creation and v130 migration produce the same exact inventory and
current fingerprint. v130 migration creates one regular content-addressed
backup and one exact history row, and reopening is idempotent. Unsupported or
drifted inputs produce no migration event, backup, or write. Package and CI
inventories contain no JavaScript migrator or early-Store fixture path, while
the packaged CLI proves the supported predecessor migration.
