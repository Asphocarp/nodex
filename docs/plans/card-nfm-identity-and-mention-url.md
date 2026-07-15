# Expose owning Card identity and Card mention URLs in NFM

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while implementation proceeds. It follows `docs/PLANS.md` and is self-contained for resumption.

## Purpose / Big Picture

After this change, raw/exported NFM identifies every nested owning Card as `<card uuid="..." />` and represents a non-owning Card mention as `<mention-card url="nodex://cards/..." />`. Two otherwise identical nested Cards are distinguishable, agents can preserve or reorder the exact shell during a compare-and-swap NFM replacement, and mentions reuse Nodex's existing resource URL instead of exposing an internal storage field.

The identity annotation is safe rather than imperative. NFM may preserve an owning Card already in the same Document, but it cannot create, copy, or move that Card by naming an arbitrary UUID. Those operations still require the typed ownership workflow that prepares the Card's independent Document and commits exclusive parentage atomically.

## Progress

- [x] (2026-07-15 06:05Z) Traced NFM codecs, Yjs/BlockNote identity, whole-NFM replacement, Card deeplinks, materialization persistence, renderer copies, and relevant tests with three read-only explorers.
- [x] (2026-07-15 06:10Z) Confirmed the user-selected syntax and the recommended block-level/external-only/identity-pin semantics.
- [x] (2026-07-15 06:20Z) Revised ADR 0011 and created this ExecPlan before production-code edits.
- [x] (2026-07-15 08:05Z) Added canonical NFM AST/parser/serializer/Adapter support for Card UUIDs and Card mention URLs while retaining decode-only legacy tags.
- [x] (2026-07-15 08:20Z) Made explicit Card UUIDs exact identity pins in contextual whole-NFM replacement; unsafe, malformed, duplicate, wrong-type, unknown, and cross-parent identities fail closed.
- [x] (2026-07-15 08:32Z) Added the v60-to-v61 same-head NFM rematerialization, secondary/Card-read projection rebuild, and deleted-owner restore catch-up.
- [x] (2026-07-15 08:35Z) Updated clipboard/read-only surfaces, Storybook coverage, runtime probes, product/architecture/reliability docs, and release notes.
- [x] (2026-07-15 08:48Z) Passed focused tests, three independent read-only reviews, typecheck, lint, and all standard test tiers; prepared the atomic commit.

## Surprises & Discoveries

- Observation: The owning Card identity already exists in every Yjs current head.
  Evidence: the outer `blockContainer` has `id=<Card Block ID>` while the inner childless content element is `card`; only `bnBlockToNfm` discards the outer ID and the serializer prints `<card />`.

- Observation: Whole-NFM replacement currently states that NFM carries no Block IDs and therefore uses conservative semantic/position matching.
  Evidence: `legacy-nfm-shadow-translator.ts` deliberately removes target IDs before identity inference. Identical childless Card shells are the least distinguishable input.

- Observation: NFM cannot safely create an owning Card even when supplied an ID.
  Evidence: `reconcileDocumentBlocks` rejects new `card` Blocks outside typed creation because an owning Card also needs a separately prepared owned Document and exclusive parent.

- Observation: Renaming the durable `cardRef` node would be a historical schema change, not a vocabulary cleanup.
  Evidence: the Yjs content element node name is the Block type. Historical snapshots would retain `cardRef`, requiring a permanent legacy schema or destructive replay conversion.

- Observation: Existing materialized NFM is persisted independently of Yjs heads.
  Evidence: changing the serializer updates future writes only. Existing `document_materializations.nfm` must be rebuilt from current authority if the new syntax should be immediately observable after upgrade.

- Observation: An exact exported NFM round trip can contain duplicate parent Blocks that have no textual identity of their own.
  Evidence: Card UUIDs disambiguate the shells, but conservative parent matching cannot prove which of two identical parents is unchanged. Exact current canonical NFM therefore short-circuits as a no-op; edited ambiguous parentage fails closed rather than authorizing a cross-parent move.

- Observation: Deleted owners deliberately cannot enter the live Document loader because their recursively indexed Blocks are tombstoned.
  Evidence: weakening that invariant for a projection migration would create a second validation mode. The restore command already reactivates the full indexed closure atomically, so it performs the same projection catch-up before rebuilding the restored Card read model.

## Decision Log

- Decision: Canonical NFM uses `<card uuid="..." />` for owning shells and `<mention-card url="nodex://cards/..." />` for non-owning Card mentions.
  Rationale: The first exposes the shell's own stable identity; the second identifies a target resource through the existing public deeplink vocabulary.
  Date/Author: 2026-07-15 / user and Codex.

- Decision: Keep durable BlockNote/Yjs types `card` and `cardRef`; use `mentionCard` only in the NFM AST and textual grammar.
  Rationale: Internal `cardRef` accurately describes the stored relationship. Renaming it adds migration and historical compatibility cost without changing behavior.
  Date/Author: 2026-07-15 / user-approved recommendation.

- Decision: Treat `card.uuid` as an exact contextual identity pin, never an implicit ownership command.
  Rationale: Current-Document preservation is safe and removes heuristic ambiguity. Creating, copying, or moving a Card requires owned-Document and exclusive-parent invariants that NFM text alone cannot satisfy.
  Date/Author: 2026-07-15 / user-approved recommendation.

- Decision: Reuse the shared Card deeplink parser/builder and canonicalize accepted mention URLs on output.
  Rationale: URI parsing, percent encoding, and the `nodex://cards` resource contract should have one implementation.
  Date/Author: 2026-07-15 / user-approved recommendation.

- Decision: Upgrade stored projections without a Yjs update.
  Rationale: Authority already contains both coordinates. A serializer vocabulary change should not advance causal heads or pollute collaboration history.
  Date/Author: 2026-07-15 / Codex.

- Decision: Normalize both sides of legacy import parity with traversal-stable synthetic Block IDs.
  Rationale: Legacy `<card />` has no owning identity, while current materialization must allocate one. Content parity must remain exact without treating a migration-assigned identity as source content.
  Date/Author: 2026-07-15 / Codex.

## Plan of Work

Introduce `NfmMentionCard` with `type: "mentionCard"` and semantic `targetBlockId`, plus a Card UUID on `NfmCard`. Retain a narrow legacy Card-reference AST variant only for `<card-ref project/card>` migration input. Parse and validate canonical `<mention-card url>` at the grammar boundary, and decode historical canonical `<card-ref target-block>` into the same semantic node. The serializer emits only the new canonical forms for current nodes, rebuilds the deeplink through the shared URL helper, and rejects an owning Card whose UUID is absent. The Adapter maps `mentionCard.targetBlockId` to internal `cardRef.props.targetBlockId`, maps an internal canonical `cardRef` back to the semantic NFM node, and derives `card.uuid` from the BlockNote Block ID rather than storing it in props.

Preserve fresh-ID safety for genesis/import: `nfmToBlockNoteWithIds` continues overwriting every supplied ID. In contextual whole-NFM replacement, inspect explicit target Card IDs before heuristics. Each must be exact, unique, present in the current source forest, and type `card`; seed that source/target match and exclude it from heuristic claims. Its child pair remains eligible for normal matching. A missing UUID retains decode-only legacy behavior and may match an existing shell conservatively, but canonical serialization never produces it. Unknown or duplicate UUIDs fail before candidate construction.

Advance the store schema from 60 to 61. Query every readable ready primary Yjs block-tree Document, load its exact head, materialize it through the registered schema Adapter, persist the resulting NFM/block tree/reference payload at the same generation/head, and rebuild secondary plus Card read projections. Verify coordinates again inside one writer-owned transaction. Deleted owners remain behind the live-loader lifecycle fence; their existing restore transaction invokes the same projection finalizer after reactivating the indexed closure and before rebuilding the visible read model. The fixed point performs no Yjs writes and is safe to rerun. Extend migration chains, shipped-store recognition, restore-journal version acceptance, and schema tests.

Update the independent clipboard text serializer and static/read-only renderers so user-facing vocabulary says Card mention and copied NFM uses the new tags. Keep the editable NodeView and query/event model unchanged because the internal Block type and target read contract do not change. Update runtime probes and focused codec, translator, store, renderer, and CLI/export tests. Update the narrow product, architecture, reliability, changelog, ADR, and this plan.

## Validation and Acceptance

Automated acceptance requires:

1. Materializing an owning Card shell with Block ID `X` emits `<card uuid="X" />`; the XML content element still has no `uuid` prop.
2. A canonical internal `cardRef` targeting `X` emits `<mention-card url="nodex://cards/X" />`; its occurrence Block ID remains separate and is not encoded in the tag.
3. Mention URL characters are percent-encoded by the shared builder and accepted legacy/alternate URL forms canonicalize on serialization.
4. Historical `<card-ref target-block="X" />` decodes to the new mention; historical project/card references remain available only to the foreign-reference migration.
5. Two identical existing nested Cards can reorder through whole-NFM CAS by UUID without exchanging identities.
6. Duplicate, unknown, wrong-type, or non-current-Document Card UUIDs fail closed. Genesis/import never adopts an exported owning UUID.
7. v60-to-v61 preserves Document generation, head sequence, state vector/hash, updates, snapshots, and Block registry identities while replacing persisted current-head NFM and derived references; restoring a skipped deleted owner catches it up before exposure.
8. Existing realtime Card target behavior and Database View reference behavior remain unchanged.

Run focused shared/main/renderer tests during implementation, then the required gates from the repository root:

    pnpm run typecheck
    pnpm run lint
    pnpm test

Review `git diff --check`, the full diff, and `git status --short`. Commit with a conventional subject and explanatory body.

## Idempotence and Recovery

The v61 projection migration is a deterministic rebuild from immutable current coordinates. It does not append Yjs updates, rotate generations, or alter Document heads. A failure leaves `user_version` at 60; rerunning overwrites disposable projections from the same authority and then advances to 61 only after every readable eligible Document succeeds. Secondary and Card read projections are rebuilt only from the just-persisted exact-head materialization. A retained deleted owner is caught up idempotently in its later restore transaction after the normal live-loader invariants become true.

Explicit NFM replacement remains compare-and-swap gated. UUID validation and candidate construction occur on detached state. Any invalid identity returns an error without touching authority. Lost-response retries retain existing mutation receipt semantics.

## Outcomes & Retrospective

The implementation now emits the selected external vocabulary while retaining `cardRef` as the durable BlockNote/Yjs node. The NFM AST keeps the semantic target identity rather than an unvalidated URL; parsing validates the deeplink once and serialization rebuilds its canonical form. Contextual replacement preserves and reorders exact same-parent owning shells, uses pinned Cards to disambiguate compatible duplicate parent subtrees, rejects unsafe identity claims before mutation, and treats an exact exported duplicate-parent document as a no-op. Import allocates fresh identities. v61 rematerializes disposable projections at the same Yjs coordinates, keeps Card read projections consistent, and catches retained deleted owners up during restore.

Validation passed with `pnpm run typecheck`, `pnpm run lint`, and `pnpm test`: 1,141 unit, 1,247 main-process, 2,812 renderer, and 29 integration tests. Three read-only reviewers rechecked simplicity/DRY, functional correctness, and architecture/migration consistency after fixes and reported no remaining substantive findings. The deliberate limitation is that `mention-card` identifies only its target resource; occurrence identity for duplicate mentions remains outside NFM and continues to use conservative contextual matching.

Revision note, 2026-07-15: Initial plan created after the user approved the canonical syntax and the external-only/identity-pin architecture, before production-code edits.
