# Make Card outliners edit and navigate like native toggles

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current while implementation proceeds. This plan follows `docs/PLANS.md` and is self-contained so a contributor with only this repository and this file can resume the work.

## Purpose / Big Picture

After this change, an NFM `card` or `cardRef` row behaves like a native outliner header even though its content belongs to another independently synchronized Document. A user can click and edit the authoritative Card title while the row is collapsed. ArrowUp and ArrowDown move through the visible order of the host editor, Card title, disclosed Card body, and surrounding host Blocks without an extra stop on the atomic shell.

The behavior remains scalable and honest. An idle collapsed row still renders a bounded rich-title projection and mounts no provider. Explicit click or keyboard intent activates exactly one target Y.Doc surface on demand, without expanding the body or copying title/body content into the host Y.Doc. The change can be seen by placing paragraph/Card/paragraph in an NFM editor, editing the collapsed title, and traversing the same structure in both directions.

## Progress

- [x] (2026-07-15 06:08Z) Read `ARCHITECTURE.md`, `CONTEXT.md`, `docs/PLANS.md`, `docs/FRONTEND.md`, the product and keyboard specifications, ADR 0007/0008/0009/0011, and current Card outliner, title, activation-budget, NFM key-handler, test, and Storybook implementations.
- [x] (2026-07-15 06:08Z) Retrieved current BlockNote documentation with Context7 and reviewed the vendored BlockNote source plus the official ProseMirror selection, key-handler, and `EditorView.endOfTextblock` contracts.
- [x] (2026-07-15 06:08Z) Recorded the on-demand transclusion-session decision in ADR 0012 before production-code edits.
- [x] (2026-07-15 06:08Z) Created this complete renderer migration ExecPlan before production-code edits.
- [x] (2026-07-15 06:32Z) Added behavioral tests for editor-scoped registration, visible traversal, title geometry, engagement activation, and focused activation priority; the new module and recency-only priority cases failed before their implementations existed.
- [x] (2026-07-15 06:32Z) Replaced the old Block-ID-global inline-summary navigation residue with the editor-scoped embedded-surface bridge while preserving collapsed-toggle browser deferral.
- [x] (2026-07-15 06:32Z) Added mount-local title engagement and priority-aware activation without changing disclosure preference or the provider cap.
- [x] (2026-07-15 06:32Z) Activated one target Card runtime for collapsed title editing, persisted async focus intent, and constructed the body only while disclosed.
- [x] (2026-07-15 06:32Z) Added title/body boundary adapters and symmetric host/title/body ArrowUp/ArrowDown traversal, click editing, and Escape return.
- [x] (2026-07-15 06:32Z) Updated Storybook, architecture, frontend, product, keyboard, context, changelog, ADR 0007, and this living plan.
- [x] (2026-07-15 06:46Z) Ran focused renderer/browser tests, strict typecheck, lint, and every standard `pnpm test` group; restored the gitignored research corpus fixture expected by one unrelated node contract and fixed explicit `act(...)` coverage before all groups passed.
- [x] (2026-07-15 06:47Z) Reviewed the final diff and committed the implementation as `d551e2113` (`feat(editor): transclude Card outliner interactions`) with the behavior, tests, Storybook state, and source-of-truth docs together.

## Surprises & Discoveries

- Observation: The current Card outliner already has the correct one-runtime composition; only its admission condition is too narrow.
  Evidence: `src/renderer/components/kanban/editor/expanded-card-outliner-document.tsx` mounts one `BlockDocumentSurface` whose `surface.title` and `surface.body` feed the row and nested `NfmEditor`, while `CardOutlinerRowSlots` already omits children when `expanded` is false.

- Observation: The existing inline-view arrow registry is not safe for Card shells and appears disconnected from production inline Database rendering.
  Evidence: `src/renderer/components/kanban/editor/inline-view-arrow-nav.ts` stores handles in one module-global `Map<string, ...>` keyed only by Block ID, hard-codes `databaseViewRef` entry candidates, and no production renderer currently registers a handle.

- Observation: BlockNote exposes the concrete host editor to a custom Block renderer, but the Card specs currently discard it.
  Evidence: `createReactBlockSpec` invokes `render` with both `block` and `editor`; `createCardBlockSpec` and `createCardRefBlockSpec` destructure only `block`.

- Observation: ProseMirror has the required visual-line boundary primitive, so the host and nested NFM body do not need to infer vertical boundaries from logical text offsets.
  Evidence: `EditorView.endOfTextblock("up" | "down")` reports whether movement would leave the current rendered textblock. The current helper instead compares `parentOffset` with zero or content size.

- Observation: `CollaborativeCardTitle` is a standalone contenteditable with a forwarded DOM ref and event hooks, not a ProseMirror view.
  Evidence: it already forwards `ref`, `onKeyDown`, `onFocus`, and `onBlur`, so title boundary geometry and focus restoration can be added without replacing its Y.Text editing Adapter.

- Observation: The activation budget is a recency-only hard cap of three and can evict any eligible surface.
  Evidence: `ReferenceSurfaceActivationBudget` sorts only by activation sequence. Explicit editing needs priority over visibility-only eligibility so an entered title cannot disappear during interaction.

- Observation: BlockNote's public `setTextCursorPosition` already creates a ProseMirror `NodeSelection` for `content: "none"` Blocks.
  Evidence: the vendored `textCursorPosition.ts` branches on the registered Block content type and selects `blockContent.beforePos` for `"none"`. The bridge can therefore use the public editor API for Card-shell selection and does not need `_tiptapEditor` or a private transaction path.

- Observation: Collapsed title editing must bypass a stale `IntersectionObserver` result, but it does not need a second activation channel.
  Evidence: admitting `titleEngaged || (expanded && visible)` through the same bounded budget activates an explicitly entered mount immediately, while release returns it to ordinary disclosure/visibility eligibility.

## Decision Log

- Decision: Keep `card` and `cardRef` as childless `content: "none"` shells and treat seamlessness as an interaction-layer transclusion, not a document-model embed.
  Rationale: The target Card Y.Doc must remain the only title/body authority; changing the schema or editing the projection would create duplicate content and incompatible undo/sync behavior.
  Date/Author: 2026-07-15 / Codex with user approval of the recommended architecture.

- Decision: Add ephemeral `titleEngaged` state beside persisted disclosure preference.
  Rationale: Editing a title and revealing a body are independent intentions. Idle collapsed rows remain cheap, while explicit editing can use the authoritative runtime.
  Date/Author: 2026-07-15 / Codex.

- Decision: Scope embedded-surface handles by host editor object and shell Block ID using a `WeakMap`-backed registry.
  Rationale: Stable Block identity is not unique per mount. Editor scoping prevents duplicate views, different host Y.Docs, and StrictMode cleanup from stealing one another's focus handles.
  Date/Author: 2026-07-15 / Codex.

- Decision: Use ProseMirror `EditorView.endOfTextblock` for NFM visual boundaries and a title-specific DOM geometry helper for the standalone rich-title contenteditable.
  Rationale: ArrowUp/ArrowDown are visual-line commands. Logical start/end checks incorrectly retain or transfer focus on wrapped text.
  Date/Author: 2026-07-15 / Codex, based on current official ProseMirror documentation and vendored BlockNote source.

- Decision: Resolve cross-surface neighbors from the visible depth-first Block tree, consulting native toggle disclosure only to exclude hidden descendants.
  Rationale: Same-level `prevBlock`/`nextBlock` cannot cross ancestor boundaries, while top-level DOM scans fail for nested Blocks and nested editors. Structural order plus a narrow presentation-state query matches the visible outliner.
  Date/Author: 2026-07-15 / Codex.

- Decision: Give editing engagement priority within the existing hard activation cap.
  Rationale: User intent should outrank passive visibility, but provider count must remain bounded and priority must disappear with focus engagement.
  Date/Author: 2026-07-15 / Codex.

- Decision: Rename the expanded-only target component to describe an active Card outliner runtime.
  Rationale: Once a collapsed title can be live, `ExpandedCardOutlinerDocument` encodes a false lifecycle assumption. The new name should describe activation, while `rowProps.expanded` alone controls body disclosure.
  Date/Author: 2026-07-15 / Codex.

## Outcomes & Retrospective

The renderer migration is implemented. `card` and `cardRef` remain atomic childless shells, while each mounted row can temporarily engage its one authoritative target title independently of disclosure. The old process-global inline-summary registry is gone; a generic editor-scoped bridge now resolves visible structural neighbors and crosses host, title, and nested-body boundaries. The provider cap remains hard, with explicit editing priority added inside it.

Focused renderer coverage passes 40 tests across seven files, and the rich-title Chromium coverage passes six tests. Strict typecheck and lint pass. The standard groups pass 1,130 node, 1,244 main-process, 2,821 renderer, and 29 integration tests. The node group initially exposed a missing gitignored research manifest in this worktree; restoring the same generated fixture already present in the main worktree made its five corpus contracts pass without adding it to the change set. Storybook now includes `CollapsedEditing`.

Automated implementation, validation, diff review, and commit are complete in `d551e2113`. Manual visual verification remains intentionally user-run under repository guidance; it is the only outstanding acceptance activity and does not block the renderer migration.

## Context and Orientation

Nodex calls a document-like Block a Card. Every Card owns one independent Yjs Document with `Y.Text("title")` and `Y.XmlFragment("body")`. A `card` Block places that Card as a child of another Document. A `cardRef` points to a Card without changing its parent. Both host shapes are childless BlockNote custom Blocks with `content: "none"`; their body is never a ProseMirror child of the host shell.

`src/shared/block-documents/blocknote-schema-config.ts` defines those DOM-neutral Block configs. This migration must not change them. `src/renderer/components/kanban/editor/card-outliner-block.tsx` resolves both relationships through the membership-independent target query and chooses between the collapsed portable-rich projection and the lazy active target component. Its `createReactBlockSpec` renderers must begin passing the concrete host BlockNote editor into `CardOutlinerBlock` so navigation registration can be scoped correctly.

`src/renderer/components/block-documents/card-outliner-surface.tsx` owns disclosure, visibility, activation admission, the stable frame, disclosure caret, title slot, and optional body slot. Today `useCardOutlinerActivation` admits only `expandable && expanded && visible`. It must gain per-mount title engagement without writing disclosure state. The frame, caret, and wrapper must retain their DOM identity across projected, pending, live, and failure content.

`src/renderer/components/kanban/editor/expanded-card-outliner-document.tsx` is the active target Adapter. It mounts `OwnedBlockDocumentBoundary`, then one `BlockDocumentSurface`, then renders `CollaborativeCardTitle` and `NfmEditor` from that surface. Rename it to `active-card-outliner-document.tsx`. The title must always render when the runtime is active. The nested `NfmEditor` must be constructed only when `rowProps.expanded` is true, even though `CardOutlinerRowSlots` also omits the body DOM. This prevents a collapsed edit session from allocating an invisible body editor.

`src/renderer/components/block-documents/collaborative-card-title.tsx` is an imperative DOM Adapter over the target Y.Text. React owns the root but does not reconcile browser-mutated child content. It already accepts a forwarded `HTMLDivElement` ref and keyboard/focus handlers. Reuse those seams. Add pure/imperative helpers to `src/renderer/lib/rich-title-editor-dom.ts` for focusing a logical edge or pointer position and testing first/last rendered-line boundaries; do not move Y.Text editing logic into the outliner.

`src/renderer/components/kanban/editor/inline-view-arrow-nav.ts` currently combines two unrelated responsibilities: a collapsed-toggle browser deferral that still protects real editor behavior, and a Block-ID-global inline-summary registry with logical boundary checks. Preserve the collapsed-toggle behavior. Replace the registry half with a new generic module such as `embedded-surface-arrow-navigation.ts`. The module should contain small structural helpers, editor-scoped registration, host-entry handling, host-neighbor focus, nested-editor boundary focus, and lightweight interfaces that are testable without mounting the entire application.

`src/renderer/components/kanban/editor/nfm-editor.tsx` owns the concrete BlockNote editor and a capture-phase keydown handler. It currently calls the old inline-summary helpers before collapsed-toggle deferral. Update it to call the generic embedded-surface bridge for unmodified arrows. Add an optional embedded-boundary prop and imperative handle so a parent Card runtime can focus the first/last visible body Block and so the nested body can return boundary arrows to its Card title or host neighbor. Entry into a deeper Card inside the body has precedence over exiting the body.

`src/renderer/lib/reference-surface-state.ts` owns the renderer-window provider cap. Extend its eligible record from sequence alone to priority plus sequence. Existing callers default to visibility priority. Card title engagement uses editing priority. Sorting must remain deterministic, hard capacity must never be exceeded, and removing priority must allow the displaced recent surface to resume.

The target behavior is governed by ADR 0012. ADR 0007 must be refined so “collapsed rows do not mount” means idle collapsed rows. ADR 0009 continues to own disclosure persistence. ADR 0008 continues to require stable EditorView and NodeView identity across capability/focus changes.

## Plan of Work

### Milestone 1: Prove the interaction primitives

Create focused tests before changing the production behavior. In the navigation test module, define two fake host editor objects with identical shell IDs and prove registrations are editor-scoped, cleanup is identity-safe, and no handle runs for an unrelated editor. Test visible depth-first ordering across ordinary nested Blocks, expanded toggle descendants, collapsed toggle descendants, consecutive Cards, and ancestor exits. Test that a text cursor enters only when the fake ProseMirror view reports `endOfTextblock`, while a NodeSelection on a registered shell enters directly.

In `src/renderer/lib/reference-surface-state.test.ts`, prove editing priority displaces the least-priority active surface while never exceeding capacity, remains stable across ordinary touches, and releases back to recency ordering. These tests should fail against the current recency-only budget.

Add Chromium coverage for the rich-title rendered-line boundary helper. A wrapped two- or three-line contenteditable should keep ArrowUp/ArrowDown native on interior lines and report only the first/last line as an exit. Logical start/end fallback can be unit tested separately for the no-layout environment.

This milestone is complete when the new behavioral tests precisely describe the intended contract and fail only because the primitives are not implemented.

### Milestone 2: Introduce the editor-scoped navigation bridge

Implement `embedded-surface-arrow-navigation.ts` with an editor-object `WeakMap` whose values are shell-ID maps. `registerEmbeddedSurfaceBoundaryHandle(editor, shellId, handle)` returns a cleanup function that removes the entry only if the same handle is still registered. The handle accepts `"up" | "down"` and returns whether it accepted focus.

Define a minimal host editor interface containing the Block tree, ProseMirror view, `getTextCursorPosition`, `setTextCursorPosition`, `focus`, and `domElement` fields actually used. Do not depend on the application store or Card types. Export a pure `flattenVisibleBlocks` or `findVisibleNeighbor` helper that accepts a disclosure predicate. The DOM Adapter that implements that predicate may inspect only the corresponding host Block's native `.bn-toggle-wrapper[data-show-children]`; it must scope queries to the host ProseMirror root so nested NFM editors are not mistaken for host Blocks.

For host entry, inspect the current selection. If it is the NodeSelection of a registered shell, invoke that shell directly. Otherwise require an empty text selection and `prosemirrorView.endOfTextblock(direction)`, find the next visible structural Block, and invoke its handle only if registered. Return false for all normal movement so BlockNote/browser behavior remains authoritative.

For host exit, find the visible neighbor around the known shell ID. If the neighbor is another registered surface, enter it directly in the same direction. Otherwise set the host cursor to neighbor start/end and focus the host editor. Escape uses a separate helper that selects the shell itself.

Remove the unused global registry and database-only entry helpers from `inline-view-arrow-nav.ts`; leave and rename only the collapsed-toggle browser deferral if a file split improves clarity. Update its existing tests without weakening the hidden-child regressions.

This milestone is complete when editor-scoped and structural navigation tests pass and current collapsed-toggle tests remain green.

### Milestone 3: Separate engagement from disclosure and protect focus

Change `ReferenceSurfaceActivationBudget` to store an eligibility record containing `sequence` and a small numeric or enum priority. `setEligible` must update priority even when eligibility remains true. Sort priority descending, then recency descending. Extend `useReferenceSurfaceActivation` with an optional priority argument whose default preserves every current caller.

In `useCardOutlinerActivation`, add local `titleEngaged` state plus `engageTitle` and `releaseTitle` actions. Compute eligibility as `expandable && (titleEngaged || (expanded && visible))`. Explicit engagement should not be blocked by a stale IntersectionObserver result because a click or adjacent Arrow proves that mount is interactable. Pass editing priority while engaged. Clear engagement if the target becomes non-expandable. Releasing engagement while expanded removes priority but leaves the runtime eligible through disclosure.

Update `card-outliner-surface.test.tsx` to prove idle collapsed inactivity, explicit collapsed engagement, body slot absence, focused-title retention through collapse, release back to projection eligibility, and unchanged duplicate-mount disclosure semantics.

This milestone is complete when activation remains bounded, idle collapsed rows are inactive, and explicit collapsed editing is active without changing disclosure.

### Milestone 4: Mount the authoritative collapsed title and preserve focus intent

Pass the BlockNote `editor` from each Card custom-Block renderer to `CardOutlinerBlock`. Register one embedded-surface handle for that editor/shell pair. Store a monotonically identified focus intent in the Card NodeView component. Downward entry requests title start. Upward entry requests body end when disclosed and title end when collapsed. Projected-title pointer activation records the pointer coordinates; keyboard activation records a logical edge. Every request engages the title before lazy loading begins.

Render the portable projection inside a cursor-like accessible edit trigger only for an available editable target. Clicking or pressing Enter on that trigger requests authoritative editing without toggling disclosure. Loading/error/unavailable projection remains non-editable and never creates recursive activation.

Rename the active target component and pass the focus intent plus one-shot consume callback. Give `CollaborativeCardTitle` its existing DOM ref. In a layout effect after the surface is ready, focus the requested title edge or pointer position. For a body intent, wait until the disclosed `NfmEditor` exposes its boundary handle. Do not consume an intent while only a projection, skeleton, descriptor-loading state, or provider-loading fallback is rendered.

Render the nested body `NfmEditor` conditionally inside the expanded branch rather than constructing it and relying only on `CardOutlinerRowSlots` to hide children. On live title focus, engage/touch the surface. On blur outside the title wrapper, release engagement; if disclosure remains expanded, only editing priority changes. Escape focuses the host NodeSelection and releases engagement without changing disclosure.

Extend `card-outliner-block.test.tsx` with active-target mocks that expose delayed readiness and focus consumption. Prove click/Arrow engagement while collapsed, stable frame identity, intent survival, one target runtime reused after expansion, and no body construction while collapsed. Update Storybook with `CollapsedEditing`, using a real Y.Text-backed title inside an active Card row and no body.

This milestone is complete when a collapsed projected title can become the live authoritative title on demand, no duplicate provider/body exists, and async entry never loses its target.

### Milestone 5: Complete symmetric title/body traversal

Add an optional embedded-boundary contract to `NfmEditorProps` and pass it through `NfmEditorInstance`. Expose `focusBoundary(direction)` through a React ref or callback handle. It finds the first/last visible body Block, enters a registered nested Card directly when that edge is a Card shell, or uses `setTextCursorPosition` with start/end placement for ordinary content.

In the NFM capture key handler, keep deeper embedded-surface entry before parent-body exit. If no deeper surface handles the Arrow, and the editor is at its first/last visible Block plus `EditorView.endOfTextblock`, call the parent boundary callback. Consume and prevent the event only when a callback actually moves focus. Preserve the collapsed-toggle deferral order needed to avoid hidden descendants.

In the live Card title handler, ignore modifiers, range selections, and IME composition. At the first rendered line, ArrowUp moves to the previous visible host boundary. At the last rendered line, ArrowDown focuses the body start when disclosed and otherwise the next host boundary. The nested body's first ArrowUp focuses title end; its last ArrowDown focuses the next host boundary. Host entry from below chooses body end only when the body is mounted and disclosed. Consecutive Cards should chain through their registered handles without leaving an intermediate NodeSelection.

Add focused workflow coverage for collapsed and expanded traversal in both directions. Use Chromium for the wrapped-line assertion and keep renderer unit tests for structural order, callback precedence, modifier/composition guards, and async focus.

This milestone is complete when the observable order is previous host ↔ title ↔ optional visible body ↔ next host in both directions, including nested/consecutive Cards.

### Milestone 6: Update contracts and finish validation

Refine ADR 0007's expanded-only language and acceptance. Update `ARCHITECTURE.md` to name the editor-scoped navigation bridge and the engagement/disclosure split. Update `CONTEXT.md`, `docs/FRONTEND.md`, `docs/product-specs/nodex-product-spec.md`, and `docs/KEYBOARD_SHORTCUTS.md` with idle-collapsed projection behavior, collapsed title editing, and exact Arrow traversal. Amend the existing Unreleased Card-outliner changelog bullet rather than adding a second Changed/Fixed entry for the same unreleased feature.

Keep this plan current after every milestone. Record unexpected library or test behavior in `Surprises & Discoveries`, final interface choices in `Decision Log`, exact commands/output in `Artifacts and Notes`, and the final behavior/gaps in `Outcomes & Retrospective`.

Run targeted renderer and browser tests while iterating. Once the edit set is stable, run strict typecheck, lint, and the full standard test suite. Treat React `act(...)` warnings as failures. Review `git diff --check`, repository status, and the scoped diff, then commit with a conventional subject and explanatory body.

## Concrete Steps

All commands run from `/Users/asc/.codex/worktrees/3e03/nodex`.

Start with the focused renderer contracts. Adjust exact filenames if the navigation module is renamed, and record the actual commands below:

    pnpm exec vitest run --config vitest.renderer.config.ts \
      src/renderer/components/kanban/editor/embedded-surface-arrow-navigation.test.ts \
      src/renderer/components/kanban/editor/inline-view-arrow-nav.test.ts \
      src/renderer/components/block-documents/card-outliner-surface.test.tsx \
      src/renderer/components/kanban/editor/card-outliner-block.test.tsx \
      src/renderer/lib/reference-surface-state.test.ts

Run the focused Chromium contract with the repository's browser config:

    pnpm exec vitest run --config vitest.browser.config.ts \
      src/renderer/components/kanban/editor/card-outliner-arrow-navigation.browser.test.tsx

If browser test discovery is script-owned rather than accepting the direct config invocation, use `pnpm run test:browser -- <path>` and record that actual command. No main-process or integration test is required unless implementation crosses the renderer-only boundary described here.

After the final edit set stabilizes, run the independent handoff gates, preferably concurrently:

    pnpm run typecheck
    pnpm run lint
    pnpm test

Then inspect the final state:

    git diff --check
    git status --short
    git diff --stat
    git diff

Commit the implementation only after all required checks pass:

    git add <scoped files>
    git commit -m "feat(editor): transclude Card outliner interactions" \
      -m "Activate the authoritative Card title on demand while collapsed and bridge visual-boundary navigation across host, title, and body editors. Keep idle projections/provider limits intact and document the interaction contract."

## Validation and Acceptance

Automated acceptance requires all of the following behavior:

1. An idle collapsed `card` or `cardRef` renders its exact-head portable rich-title projection and is ineligible for a target provider.
2. Clicking the projected title or Arrow-entering from an adjacent host Block engages the concrete mount, activates one target runtime, focuses `Y.Text("title")`, and leaves disclosure/body collapsed.
3. Editing, formatting, composition, and undo in that title mutate only the target Y.Doc. The host shell remains `content: "none"`, and host NFM/Y.Doc receive no foreign title or body.
4. Expanding an engaged Card reuses the same target runtime and mounts one body editor. Collapsing hides/unmounts the body but preserves a focused live title.
5. The traversal order is previous visible host Block ↔ title ↔ first through last visible body Block when disclosed ↔ next visible host Block, with exact reverse behavior for ArrowUp.
7. Wrapped host, title, and body text keeps native vertical motion until `endOfTextblock` or the title geometry helper reports the first/last rendered line.
8. Modified arrows, range selections, IME composition, hidden collapsed-toggle descendants, ordinary custom Blocks, unavailable/deleted/archived targets, and self/cycle targets are not incorrectly intercepted or activated.
9. Async lazy import, descriptor preparation, and provider sync preserve one pending focus intent and consume it exactly once when the requested live boundary exists.
10. Duplicate shell IDs in different host editors keep independent handles. Stale cleanup cannot unregister a newer handle in the same editor.
11. Editing engagement outranks visibility-only eligibility while total live referenced surfaces never exceed the configured capacity; release restores normal recency behavior.
12. Storybook contains a deterministic active-but-collapsed title state with no body, alongside existing collapsed/expanded/loading/error/cycle states.

Manual acceptance belongs to the user under repository guidance. Run `pnpm run dev`, create paragraph/Card/paragraph, and test click editing plus both Arrow directions while collapsed and expanded. Use a long wrapped paragraph and long wrapped Card title. Repeat with two consecutive Cards and a Card nested inside another Card body. Confirm the title changes on another mounted Card surface, the collapsed body never appears during title-only editing, and disclosure stays as chosen. No automated Playwright visual review is required.

## Idempotence and Recovery

This is a renderer-only migration. It does not change SQLite schema, Y.Doc roots, Block configs, canonical NFM, or persisted Card/reference identity. Re-running tests or remounting surfaces is safe. Engagement, focus intent, registry entries, and activation priority are disposable and must clean up on unmount.

If activation fails or the target becomes unavailable, retain the permanent row/caret and projected title, show the existing sparse error/retry state when appropriate, and do not change disclosure preference. A failed pending focus intent may be discarded only when the target becomes ineligible or the mount disappears; it must not redirect typing into the host projection.

If a focus movement cannot find a visible neighbor or registered boundary, return false and leave the browser/BlockNote native handler in control. Never invent a Block ID, insert a paragraph, expand a toggle, or mutate content to repair navigation.

If the priority-aware budget causes unrelated reference regressions, preserve the public default priority and prove existing recency tests before adjusting the Card-only priority. Do not remove the hard capacity or special-case capacity overflow.

## Artifacts and Notes

The current lifecycle before migration is:

    collapsed + idle -> projected title, no target runtime
    expanded + visible -> one target runtime -> live title + body editor

The target lifecycle is:

    collapsed + idle -> projected title, no target runtime
    collapsed + edit intent -> one target runtime -> live title only
    expanded + visible -> same target runtime -> live title + body editor

The current problematic navigation helper uses a global shell-ID map and logical boundaries. The target bridge is:

    host BlockNote editor object
      -> shell Block ID
      -> mounted focus handle
      -> async title/body boundary intent

The official ProseMirror contract used by the implementation is that `EditorView.endOfTextblock(direction)` reports whether movement in that direction would leave the current textblock. `Selection.findFrom` can locate a valid cursor or leaf selection, but this plan chooses the visible Block tree for cross-Block order because native toggle disclosure can hide descendants without removing them from the ProseMirror document.

Focused validation completed during implementation:

    pnpm exec vitest run --config vitest.renderer.config.ts \
      src/renderer/components/kanban/editor/embedded-surface-arrow-navigation.test.ts \
      src/renderer/components/kanban/editor/inline-view-arrow-nav.test.ts \
      src/renderer/lib/reference-surface-state.test.ts \
      src/renderer/components/block-documents/card-outliner-surface.test.tsx \
      src/renderer/lib/rich-title-editor-dom.test.ts \
      src/renderer/components/kanban/editor/card-outliner-block.test.tsx \
      src/renderer/components/kanban/editor/active-card-outliner-document.test.tsx

Result: seven files and 40 tests passed. The focused Chromium run for `collaborative-card-title.browser.test.tsx` passed six tests, including the wrapped visual-line boundary regression. The final handoff gates produced:

    pnpm run typecheck    passed
    pnpm run lint         passed
    pnpm run test:unit    189 files, 1,130 tests passed
    pnpm run test:main    168 files, 1,244 tests passed
    pnpm run test:renderer
                          380 files, 2,821 tests passed
    pnpm run test:integration
                          2 files, 29 tests passed

The first chained `pnpm test` attempt stopped after 1,129 node tests passed and one corpus test could not open its gitignored generated manifest. The manifest was restored from the main worktree's same-version `.generated/research` artifact; the failed five-test file and then the complete 1,130-test node group passed. Main, renderer, and integration groups had already passed independently, so every command in the standard chain has clean evidence without rerunning unaffected groups.

The implementation commit is `d551e2113` (`feat(editor): transclude Card outliner interactions`).

## Interfaces and Dependencies

The final names may change to match adjacent style, but the implemented contracts must be equivalent to the following.

In `src/renderer/components/kanban/editor/embedded-surface-arrow-navigation.ts`:

    export type VerticalArrowDirection = "up" | "down";

    export interface EmbeddedSurfaceBoundaryHandle {
      focusBoundary(direction: VerticalArrowDirection): boolean;
    }

    export function registerEmbeddedSurfaceBoundaryHandle(
      editor: object,
      shellBlockId: string,
      handle: EmbeddedSurfaceBoundaryHandle,
    ): () => void;

    export function handleArrowIntoEmbeddedSurface(
      editor: EmbeddedSurfaceHostEditor,
      direction: VerticalArrowDirection,
    ): boolean;

    export function moveFromEmbeddedSurfaceToHostNeighbor(
      editor: EmbeddedSurfaceHostEditor,
      shellBlockId: string,
      direction: VerticalArrowDirection,
    ): boolean;

    export function focusEmbeddedEditorBoundary(
      editor: EmbeddedSurfaceHostEditor,
      direction: VerticalArrowDirection,
    ): boolean;

The host editor Interface should contain only the current Block tree, `prosemirrorView.endOfTextblock` and selection, `setTextCursorPosition`, `focus`, and DOM root needed for disclosure queries. Use BlockNote's public `prosemirrorView`, `document`, cursor, and focus APIs; do not reach through `_tiptapEditor`.

In `src/renderer/components/block-documents/card-outliner-surface.tsx`, `CardOutlinerActivation` must expose `titleEngaged`, `engageTitle`, and `releaseTitle` beside existing disclosure/visibility/activation fields. `setExpanded` remains the only disclosure writer.

In `src/renderer/lib/reference-surface-state.ts`, eligibility must accept a defaulted priority without changing existing callers' behavior. An enum such as `visibility = 0` and `editing = 1` is preferable to unrelated magic numbers if it stays small.

In `src/renderer/components/kanban/editor/nfm-editor.tsx`, the optional embedded contract must be equivalent to:

    export interface NfmEditorBoundaryHandle {
      focusBoundary(direction: VerticalArrowDirection): boolean;
    }

    interface NfmEditorEmbeddedBoundary {
      navigationRef: Ref<NfmEditorBoundaryHandle>;
      onBoundaryArrow(direction: VerticalArrowDirection): boolean;
    }

In the active Card runtime, a focus intent must have a stable monotonically increasing identity and a target such as title start/end, title pointer coordinates, or body start/end. The consume callback must include that identity so an earlier layout effect cannot clear a newer request.

Dependencies remain React 19, the vendored BlockNote packages, ProseMirror through BlockNote's public view, Yjs, Vitest, and the existing renderer activation/disclosure stores. Add no new package.

Revision note, 2026-07-15: Initial self-contained plan created after codebase, vendored-source, Context7, and official ProseMirror research, and after ADR 0012, but before any production-code edit. It resolves the state model, navigation order, registry scope, visual-boundary strategy, activation priority, tests, documentation, and recovery behavior up front.

Revision note, 2026-07-15 06:32Z: Updated after the renderer migration and focused validation. The implementation follows the planned authority, activation, registry, and visual-boundary contracts; final repository-wide gates and commit remain.

Revision note, 2026-07-15 06:46Z: Recorded clean focused, browser, type, lint, and all standard test-group evidence. Only final diff review, commit, and user-run visual verification remain.

Revision note, 2026-07-15 06:47Z: Closed the migration after final diff review and implementation commit `d551e2113`; only repository-prescribed user-run visual acceptance remains.
