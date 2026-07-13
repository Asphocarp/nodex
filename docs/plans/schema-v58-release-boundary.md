# Squash unreleased schemas into the v58 release boundary

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `docs/PLANS.md` from the repository root.

## Purpose / Big Picture

Nodex has two shipped SQLite startup inputs, schema v26 and v57, while the working branch accumulated several unshipped transformation checkpoints. The old startup path treated internal checkpoints as persistent compatibility states and mutated the live store through separately committed edges. A real v57 copy could lose its legacy source tables and receive a final marker before a later exact-head asset projection error aborted startup.

After this change, a packaged Nodex build accepts only an empty store, shipped v26 or v57, or current v58. An upgrade reads the source store without changing it, builds a complete v58 SQLite-and-assets store in staging, validates every authority and exact-head projection, and only then installs the result through a crash-recoverable journal. v26 first passes through one semantic normalization Module while retaining `user_version=26`; it does not expose or persist the deleted numeric checkpoint chain. Fresh stores create the canonical v58 shape directly.

The behavior is demonstrated by Electron/Vitest migration tests: representative v26 and v57 stores become healthy v58 stores, an inline image data URL becomes a managed asset, migration faults leave the source unchanged, and fresh and migrated stores expose the same normalized schema.

## Progress

- [x] (2026-07-14 10:30Z) Confirmed the shipped production store is v57, the working development profile has an unshipped shape, and historical backups do not need restore compatibility.
- [x] (2026-07-14 10:45Z) Reproduced the unsafe current release seam on a temporary v57 copy: legacy-table deletion and the old final marker committed before secondary projection repair rejected an inline image data URL.
- [x] (2026-07-14 11:00Z) Reviewed the Block/Owned Document/Database domain model, accepted ADRs, reliability contract, and SQLite backup/WAL documentation.
- [x] (2026-07-14 12:10Z) Implemented the v58 canonical shape and restricted startup to explicit shipped-source inputs rather than internal development checkpoints.
- [x] (2026-07-14 12:35Z) Implemented the read-only v57 staging importer, explicit-root inline-image materialization, full validation gate, and crash-recoverable install journal.
- [x] (2026-07-14 12:50Z) Removed internal-checkpoint startup routing, live partial-finalization branches, per-edge safety backups, and checkpoint-edge tests; retained only semantic transformations required to understand v57 input.
- [x] (2026-07-14 13:35Z) Removed the numeric importer target list and the dead pre-v57 migration chain; staging now remains at v57 throughout conversion and publishes v58 exactly once after final validation.
- [x] (2026-07-14 14:20Z) Corrected the product support surface to include shipped v26, implemented direct semantic v26 normalization without restoring the numeric migration router, and validated a real 537-Card v26 snapshot with managed assets.
- [x] (2026-07-14 13:00Z) Added v57-to-v58 behavior, installed-store rollback atomicity, managed-asset, supported-version, and fresh-schema equivalence tests.
- [x] (2026-07-14 13:15Z) Updated architecture, domain, reliability, product, and engineering-learning documentation.
- [x] (2026-07-14 13:50Z) Ran targeted migration tests, `pnpm run typecheck`, `pnpm run lint`, and `pnpm test`; all checks passed for the initial v57 release boundary.
- [x] (2026-07-14 13:55Z) Committed the initial v57 release-boundary change with a conventional commit subject and explanatory body.
- [x] (2026-07-14 14:35Z) Re-ran the v26/v57 migration suite and all handoff gates after correcting the support boundary; 4,365 tests, typecheck, and lint passed.

## Surprises & Discoveries

- Observation: the old migration publication point was later than its private final-marker commit.
  Evidence: a temporary production copy received the private final marker, had zero legacy tables, and passed SQLite `quick_check`, then `repairDocumentSecondaryProjections()` threw `projection_source_corrupt`. The final-marker startup branch did not rerun that repair.

- Observation: the production projection failure is losslessly recoverable migration input, not permission to weaken the current projection invariant.
  Evidence: the affected v57 Card body is 32,126 characters and contains an `<image>` whose source is an inline `data:image/...;base64,...` value. Current asset projection intentionally bounds sources to 4,096 characters and expects managed `nodex://assets/*` URIs for local bytes.

- Observation: SQLite WAL files are part of the persistent database state and must not be separated from the database while a connection is live.
  Evidence: SQLite's WAL documentation states that committed transactions can remain in the `-wal` file. Nodex already owns a whole-store maintenance and fsynced journal model for swapping a database plus managed assets.

- Observation: a bootstrap window exists while database initialization runs, although all data-producing runtimes remain stopped.
  Evidence: `runMainAppStartup()` starts `initializeDesktopApp()`, creates the blocking bootstrap window, and then awaits initialization. HTTP, the FIFO writer, schedulers, and `databaseReady` are all later than the migration boundary.

- Observation: every staging call path must carry the staging asset root, including conversions that rebuild projections internally.
  Evidence: the first real production-copy run found that the Canvas scene conversion called `initializeCanvasSceneAuthority()` with the live global asset resolver. Passing `assetsRootPath` through Canvas initialization and projection replacement fixed the failure; the same 430 MB production snapshot then completed and validated in 27 seconds.

## Decision Log

- Decision: make v58 the next and current product schema.
  Rationale: unshipped transformation checkpoints are implementation history, not product schema versions. The shipped startup edges are v26 to v58 and v57 to v58.
  Date/Author: 2026-07-14 / Codex

- Decision: support v26 and v57 as startup sources, while preserving no old-schema backup-restore path.
  Rationale: v26 is a shipped live-profile input. Backup restore remains current-v58-only as requested; migration-journal validation understands v26/v57 solely so an interrupted startup import can restore its live source.
  Date/Author: 2026-07-14 / Codex

- Decision: publish migration output by staging and journaled replacement, not by one enormous in-place transaction.
  Rationale: a source store can be roughly 430 MB and include tens of thousands of legacy description revisions that are not current authority. Staging keeps the source intact on conversion or validation failure and avoids an oversized live WAL while still giving one observable release boundary.
  Date/Author: 2026-07-14 / Codex

- Decision: materialize v57 inline image data URLs into deterministic managed assets during import.
  Rationale: the image bytes are valid legacy authority and can be preserved exactly. Relaxing the projection source limit would let large inline payloads leak into current exact-head projections and backups.
  Date/Author: 2026-07-14 / Codex

- Decision: keep historical checkpoint format names such as `yjs_update_v1`.
  Rationale: those literals version durable evidence formats; they are not SQLite schema compatibility states.
  Date/Author: 2026-07-14 / Codex

- Decision: reuse the whole-store restore journal with schema-dispatched validation.
  Rationale: DB/WAL/SHM/assets swap and recovery have one owner. A narrow v26/v57 migration-rollback validator proves rollback input, while the existing full validator proves staged and installed v58 stores. Backup restore still validates only current v58. Startup import does not rotate `storeEpoch`; the staged Block foundation already owns a new epoch and no live client exists yet.
  Date/Author: 2026-07-14 / Codex

- Decision: retain the required transformations as semantic steps in one direct v57 importer, without numbered targets or intermediate marker writes.
  Rationale: Card shadow conversion, foreign-reference recovery, Canvas authority conversion, exclusive-parent enforcement, membership stabilization, and rich-title projection are the tested semantics required to understand v57. They are implementation steps inside one release edge, not schemas or externally addressable states.
  Date/Author: 2026-07-14 / Codex

## Outcomes & Retrospective

The product schema boundary is now v58. Startup accepts an empty store, shipped v26 or v57, or current v58; any other marker is unknown. A shipped source is never opened writable: SQLite backup captures its WAL-consistent state, all normalization, Card/Canvas conversion, and asset materialization happens in staging, and only a fully validated candidate is journal-installed. Fault tests prove that an exception after staged v58 has replaced the live files restores the original source database byte-for-byte; retry then succeeds.

Fresh and migrated stores have equal normalized `sqlite_schema`, contain no Card-first tables, and pass `quick_check`, `foreign_key_check`, exact-head projection, ownership, Canvas, and managed-asset validation. The real v57 production snapshot completed the same path in 27 seconds and preserved the formerly failing inline image as a managed asset; a real v26 snapshot with 537 Cards and 30 legacy Card-bound Threads completed in about 21 seconds. The shipped-schema reader is a direct semantic pipeline: `user_version` remains at its source value during conversion and becomes 58 only at publication.

## Context and Orientation

`src/main/local-store/schema.ts` previously combined three responsibilities: creation of fresh stores, a router across internal checkpoints, and builders for both current and temporary shapes. `getSchemaMigrationTargets()` treated development checkpoints as supported inputs, while `resetDatabaseToLatestSchema()` created a pre-finalization shape and immediately dropped its legacy tables before adding later features.

`src/main/local-store/database.ts` owns startup initialization. It previously special-cased a partially finalized store to run the asynchronous Card-shadow and foreign-reference fixed point, reopened it for more transformations, and only afterward repaired secondary projections. This ordering allowed the final marker and source-table deletion to commit before readiness.

A Block is Nodex's only content identity. A Card is a document-bearing Block and owns one independently persisted Document. Yjs is authority for Block-tree Documents; normalized relational scene rows are authority for Canvas Documents. Database membership is the Card's typed Database placement. Search rows, asset references, scheduled indexes, and Card read models are rebuildable projections and are valid only at exact authority coordinates.

Both shipped inputs contain the former wide `cards` snapshot table, legacy history and description-revision tables, and project Canvas JSON. v26 additionally uses legacy Project identifiers/workspace paths and Card-bound Codex Threads; its normalization Module remaps Project identity/source/order, imports those Threads into current sessions, adds Card read columns, and seeds Database View sessions. The importer discards old history and description revisions after importing each Card's current title/body and metadata while retaining the original source store as rollback evidence until publication completes.

`src/main/local-store/store-restore-journal.ts` and `src/main/local-store/backups.ts` implement recoverable whole-store replacement after runtime writers have been fenced. During startup, a blocking bootstrap window may already exist, but the HTTP server, writer worker, schedulers, and database-ready boundary have not started. The schema migrator therefore reuses the pure filesystem journal without depending on renderer or Hub state.

## Plan of Work

First, separate product schema numbering from the import implementation. Change the current schema to v58. Fresh/current startup accepts only 0, 26, 57, and 58. Express conversion as semantic functions invoked directly against a staging copy, keep its source marker throughout conversion, and delete helpers that exist only to route or resume historical migration edges.

Create one canonical current-schema builder. It must create the final Block, Owned Document, Database, Canvas scene, projection, evidence, Project/session, Codex, scheduler, and backup-related tables without leaving `cards`, legacy `history`, description revision, shadow job, foreign-reference ledger, old Canvas, transfer-fence, or Canvas-Yjs materialization tables. Fresh schema creation and the shipped-schema importer must use this same builder so their normalized `sqlite_schema` output is equal.

Add a startup migration Module under `src/main/local-store/` whose Interface accepts the local store directory and a progress callback. It opens v26/v57 read-only, creates a SQLite-consistent source snapshot, copies managed assets into staging, normalizes v26 when needed, builds current authority, materializes any inline image data URL into a deterministic hash-named file, converts legacy Card bodies/references/inline Views and Canvas data, and refreshes projections before validation. The Module must not expose intermediate schema versions to callers.

Add a migration install journal separate from the interactive backup-restore journal unless a clean generic whole-store replacement Module can be extracted without coupling startup migration to runtime maintenance. The journal records the staged directory, rollback directory, source version, target version, and phase. Recovery runs before normal schema inspection. Every pre-commit phase restores the original source DB, WAL/SHM if present, and assets. A committed phase retains v58 and removes staging/rollback files. All renamed files and parent directories are fsynced.

The publication gate opens the staged store read-only and requires v58, `quick_check`, `foreign_key_check`, one Block store epoch, valid Card-owned Documents, registered Document schemas and sync engines, exact-head materializations, exact-head secondary projections, normalized Canvas authority, safe managed asset entries, and the existence/hash of every managed asset referenced by current authority. Only a passing staged store can enter the install journal.

Restrict and simplify runtime Modules after the importer works. Move the live `getOwnedDocumentDescriptor()` reader out of `block-document-cutover.ts`; delete migration-only cutover operations. Remove the Card shadow outbox/finalizer and legacy Canvas-Yjs cutover once their needed transformations live inside the shipped-schema importer. Remove schema-version branches from normal Canvas bootstrap. Apply the deletion test to each legacy file: retain a codec only when deleting it would force shipped-source knowledge into several callers; otherwise keep the knowledge local to the importer.

Replace schema tests that manufacture internal checkpoint stores. The new test seam is the importer Interface. Build exact v26 and representative v57 fixtures covering Projects, Cards, metadata, recurrence/reminder records, sessions/threads, a foreign Card body, an inline Database View, Canvas JSON, and an inline image data URL. Tests assert final user behavior and domain invariants rather than SQL source strings.

Update `ARCHITECTURE.md`, `CONTEXT.md`, `docs/RELIABILITY.md`, `docs/product-specs/nodex-product-spec.md`, and `docs/ENGINEERING_LEARNINGS.md`. Historical plans remain historical. Do not add a new changelog bullet because the migration sequence belongs to the same unreleased Block-first capability; edit existing unreleased wording only if it inaccurately describes the final product behavior.

## Concrete Steps

Run all commands from `/Users/asc/repo/nodex2`.

Inspect targeted implementation and test references while editing:

    rg -n "CURRENT_SCHEMA_VERSION|getSchemaMigrationTargets|legacy_shadow|block-first-finalization|migrateSchema" src/main src/shared

Run the focused Electron-owned schema tests after each migration milestone:

    pnpm exec vitest run --config vitest.config.main.ts src/main/local-store/schema.test.ts

Run any new migration-journal test directly with the same main-process configuration.

After the final edit set stabilizes, run these independent handoff checks:

    pnpm run typecheck
    pnpm run lint
    pnpm test

The expected result is zero TypeScript errors, zero lint errors, and no failing test. Renderer tests must emit no `act(...)` warnings.

## Validation and Acceptance

A fresh empty profile initializes directly to user version 58 and contains no legacy tables. Representative v26 and v57 profiles initialize to the same normalized schema and preserve Project, Card title/body, Database placement/properties, schedule behavior, sessions/threads, references, and Canvas scene semantics. Inline image data URLs appear as `nodex://assets/*` references whose regular file bytes match the original payload.

Injecting a failure while normalizing v26, translating a Card, building a projection, validating an asset, writing the install journal, or swapping files must never expose an intermediate schema. Before the journal's committed phase, restart recovery restores the complete source store. After committed, restart keeps the complete v58 store. Retrying a pre-publication import may rebuild staging but cannot duplicate a published recovered Card, View, Block, or asset.

The supported-version test expects only these results: v58 has no work, v26 and v57 request the single v58 release migration, and an unknown marker is rejected. Version zero is handled only as fresh creation.

## Idempotence and Recovery

The importer never writes to the source v57 authority. Staging directory names are unique and incomplete staging directories are safe to remove. Deterministic managed asset names use a content hash so retrying materialization neither duplicates bytes nor changes a published URI.

The install journal is the only authority during filesystem replacement. Recovery must be callable repeatedly. If its phase is before committed, it restores the rollback DB/assets and removes any partially installed target. If its phase is committed, it keeps the target and removes rollback/staging artifacts. Journal writes use a temporary file plus rename and fsync, matching the existing restore discipline.

An existing profile produced by an unshipped development branch is not a product input. Before switching local development to this branch, recreate that profile; do not turn branch-local checkpoints into compatibility edges.

## Artifacts and Notes

The unsafe baseline reproduction on a temporary production copy produced this concise evidence:

    elapsed_seconds=68
    final_marker_written|yes
    legacy_tables|0
    quick_check|ok
    DocumentSecondaryProjectionError: ... contains an invalid asset reference

The source production database remained untouched because the reproduction used a temporary copy. The same source reports `quick_check=ok` and `user_version=57`.

SQLite documentation used during design: the online backup interface creates a consistent destination database, WAL is part of persistent state until safely checkpointed/closed, and `PRAGMA user_version` is application-owned metadata rather than an SQLite compatibility mechanism.

## Interfaces and Dependencies

Use `better-sqlite3`, Node's `fs`, `path`, and `crypto`, and the repository's existing Block Document/NFM/Canvas codecs. Do not add a new dependency.

The startup migration Module must expose one asynchronous operation because Card/reference conversion is content-aware. Its caller in `database.ts` invokes recovery first, performs migration before opening the long-lived main connection, and then runs ordinary current-store readiness checks.

The canonical schema Module must expose current schema creation and current schema validation without exposing migration-only table builders. The validation Interface is shared by the staging publisher and backup validation so current readiness has one seam.

The install-journal Module owns filesystem phases and recovery. Callers provide paths and do not rename DB/WAL/assets themselves. This concentration provides locality for crash handling and gives tests one fault-injection surface.

Plan revision note (2026-07-14): Initial plan created after reproducing the current partial-publication failure and selecting the staged v58 release migration. Revised after confirming v26 is also a shipped startup source; v26 support is implemented as semantic normalization rather than restoration of the deleted numeric migration chain.
