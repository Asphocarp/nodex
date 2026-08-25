# ADR 0014: Page history is backed by semantic Document revisions

- Status: Accepted
- Date: 2026-07-16
- Owners: Nodex maintainers
- Extends: ADR 0002 and ADR 0005

## Context

Nodex already stores immutable `document_versions` and restores them by compiling a new forward mutation. That foundation has the right collaboration semantics, but it is not yet the history users expect from a Page editor.

Normal human editor updates do not create Document versions. Strict Agent and API mutations create change-ledger evidence but usually do not create a content checkpoint. The Page history projection therefore shows many “edited content” events without the title and body that resulted from the edit, while only separately created checkpoints can be previewed and restored. Operational Yjs updates are also compacted, so they are not a durable substitute for revision history.

The existing Yjs checkpoint format stores a complete causal state. Its size grows with editing history, even when the effective Page content remains small. NFM is compact and useful for display, but it is a derived projection and cannot become restoration authority without violating the stable Block identity and rich-title contracts.

## Decision

### Revision authority

`document_versions` becomes the immutable Document Revision ledger. A revision records one exact, restorable Document state plus why it was retained. The main-process writer is the only component allowed to append revisions. Renderer code may request a named revision or flush pending edits, but it never takes a post-save snapshot itself.

New BlockNote-backed revisions use `block_tree_snapshot_v2`. The canonical payload is the minimal validated semantic state: schema kind, rich Page title where applicable, and stable-ID BlockTree. Schema key/version remain immutable row metadata. Reading a revision reconstructs a disposable registered Document and derives NFM, plain text, previews, references, and assets through the current schema adapter. Restoration uses only rich title and BlockTree semantic fields and compiles them into forward operations. NFM remains a read-only preview projection and never rebuilds a live Y.Doc.

Retained BlockTree and Yjs revisions use the same current Document schema as
live authority. A Store schema migration re-encodes retained revisions before
the current-only restore path opens them. Canvas continues to use
`canvas_scene_json_v1`, because its portable scene is already its semantic
checkpoint format.

Every revision carries a `revision_kind`, optional source mutation/change identity, and a pinned bit:

- `manual`: an immediate user-named or explicit checkpoint; pinned.
- `operation`: the result of a successful Agent, CLI, API, or strict NFM command; linked to its mutation evidence.
- `restore`: the state immediately before and after a restore; pinned and linked to the restore mutation.
- `automatic`: a human-edit checkpoint produced at an active or idle boundary.
- `safety`: the current state captured before the first edit of a new burst when no existing revision covers that head.

Revision identity includes immutable source metadata as well as the checkpoint hash. Exact retries return the existing revision; a collision with different bytes or metadata fails closed.

### Capture policy

Human Yjs updates update a durable revision-session row in the same SQLite transaction as the Document head:

- Before the first accepted update of a new edit burst, preserve the current head as a `safety` revision if no revision already covers it.
- While editing remains active, preserve the latest state at least every ten minutes.
- When no update has arrived for two minutes, preserve the latest dirty head as an `automatic` revision.
- Application shutdown forces all dirty sessions to finalize after renderer providers have completed their bounded flush.
- A dirty session survives a crash. Startup maintenance finalizes it once the idle boundary has elapsed.

The safety revision closes the crash window before the first automatic post-edit revision. The durable dirty session closes the crash/restart window after the edit. Duplicate, rejected, no-op, migration-only, and legacy-shadow updates do not create user history.

Every successful strict semantic command creates an immediate `operation` revision after its ledger row is committed in the same outer transaction. Restore creates a pinned `restore` revision before applying and another after applying. Manual checkpoints remain immediate and pinned.

### History projection and restore

Page history is a projection over Document revisions plus non-content activity. When a revision references a mutation/change row, the projection emits one content-revision entry instead of a duplicate checkpoint row and mutation row. Property, database, lifecycle, and relocation events remain independent activity entries.

The default Page History view is revision-first. It adds a synthetic non-restorable “Current” item, groups revisions by date, and loads the selected revision detail only. BlockNote-backed detail uses the existing read-only NFM editor. An optional activity filter exposes non-content evidence without weakening the revision timeline.

Restore always means “apply this revision as a new forward change.” Before applying, Nodex saves the current state. The action restores Page title and body and never rewinds Yjs, deletes later evidence, or changes immutable history.

### Retention

Pinned manual and restore revisions are exempt from automatic pruning. Unpinned automatic, safety, and operation revisions use a deterministic tiered policy:

- retain every revision from the most recent 7 days;
- from 7 through 30 days, retain the newest revision in each UTC hour;
- from 30 through 90 days, retain the newest revision in each UTC day;
- remove unpinned revisions older than 90 days;
- after tiering, cap unpinned revisions at 500 per Document by removing the oldest non-selected rows.

Pruning deletes only immutable historical revisions. It never changes the current Document, current projections, mutation evidence, or pinned revisions.

## Consequences

- Page history becomes useful without promoting operational update rows or NFM to authority.
- Human edits acquire durable, bounded restore points without creating one full checkpoint per keystroke.
- Agent/API edit evidence and exact resulting content share one user-facing entry.
- A crash can delay an idle checkpoint, but cannot lose the edit itself or the durable knowledge that the head still needs finalization.
- `document_versions` must be rebuilt in schema v67 to support the new format and metadata, while retaining legacy checkpoint readers.
- Automatic checkpointing adds bounded write and storage cost at edit-burst, ten-minute, and idle boundaries. Tiered retention bounds long-term growth.
- The History overlay becomes revision-first and information-dense; raw hashes and schema coordinates move out of the primary presentation.
