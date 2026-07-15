# ADR 0012: Card outliners use an on-demand transclusion session

- Status: Accepted
- Date: 2026-07-15
- Owners: Nodex maintainers
- Extends: ADR 0007, ADR 0008, ADR 0009, and ADR 0011

## Context

Nodex renders an owning `card` Block and a non-owning `cardRef` as the same flat Card outliner row. The host Block is an atomic, childless shell in the host Y.Doc. The target Card's rich title and body remain authoritative in the target Card's independent Y.Doc. ADR 0007 correctly rejected copying target content into the host and established one target runtime for the live title and body, but it coupled that runtime to disclosure: only an expanded row could become active.

That coupling makes the row look flatter than it behaves. A normal toggle header remains editable while its children are hidden, and ArrowUp/ArrowDown can enter or leave it as part of the visible outliner. A collapsed Card row instead renders only a read-only title projection. Clicking the title cannot edit it, and vertical movement can select or skip the atomic shell without entering the authoritative title. Navigation out of an already active nested body can appear natural because the browser crosses the nested DOM boundary, but the inverse transition is not a reliable contract.

The title projection cannot become the write surface. It is a bounded exact-head read model used to avoid loading every target Y.Doc in a long collapsed list. Editing that projection through an API call would lose the target surface's Yjs merge, undo, awareness, selection, and write-fence semantics. Permanently mounting a provider for every collapsed row would preserve authority but discard the loading and activation budget that make references scalable.

The host and target editors also cannot rely on event bubbling. The Card NodeView is `contentEditable=false`, while the live title and nested body deliberately stop events before the host ProseMirror view can claim them. Host and target selections live in different EditorViews and different Y.Docs. Crossing that boundary therefore requires a small explicit interaction contract even though the result should feel like one outliner.

## Decision

### Disclosure and editing engagement are orthogonal

Each mounted Card outliner has three separate local concerns:

- disclosure preference says whether the target body should be visible and remains browser-profile state keyed by shell Block identity;
- editing engagement says that this concrete mount is being entered or edited and remains ephemeral per mount;
- runtime activation says that the mount currently owns one admitted target provider under the renderer-wide activation budget.

The effective model is:

    bodyDisclosed = expandable && preferredExpanded
    runtimeEligible = expandable && (titleEngaged || (bodyDisclosed && visible))
    liveTitleMounted = runtimeActive
    bodyMounted = runtimeActive && bodyDisclosed

An idle collapsed row therefore remains projection-only and consumes no target provider. Clicking its projected title, keyboard-entering it from an adjacent host Block, or focusing its already-live title creates editing engagement. That engagement may activate the one target runtime even though disclosure stays collapsed. The runtime renders the authoritative collaborative title in the existing title slot and does not mount the body editor.

Expanding an engaged row reuses that same target runtime and adds the body editor. Collapsing a row hides the body but keeps the runtime while its title remains focused. When focus leaves a collapsed title, or Escape explicitly returns focus to the host shell, engagement is released and the row can return to its cheap projection. Temporary target loading, errors, cycle prevention, and activation eviction never alter disclosure preference.

This refines ADR 0007's statement that collapsed rows never mount a target boundary. The invariant is that **idle** collapsed rows never mount one. Explicit interaction may temporarily activate exactly one authoritative title surface without disclosing the body.

### One target runtime remains the only write surface

`card` and `cardRef` remain `content: "none"` custom Blocks. No title or body content is inserted into the host ProseMirror document, host Y.Doc, Block props, canonical NFM, or a shell-local editor. The projected rich title remains read-only.

When active, one `OwnedBlockDocumentBoundary` and one `BlockDocumentSurface` own the target Y.Doc, provider, client session, awareness, write fence, and readiness state. Its `Y.Text("title")` supplies `CollaborativeCardTitle`. The target `Y.XmlFragment("body")` supplies a nested `NfmEditor` only while disclosed. Title edits, formatting, composition, and undo therefore retain the same authority and concurrency semantics in collapsed and expanded presentation.

The permanent Card frame, disclosure wrapper, and caret do not remount while projection, loading, or live target slots change. Asynchronous activation records a focus intent before loading starts. When the target surface is ready, that intent focuses the title or body boundary and is consumed exactly once. A pointer-originated intent restores the caret near the click when Chromium can resolve the point inside the live title, with a deterministic title-end fallback.

### Vertical navigation is an editor-scoped bridge

Nodex adds a generic embedded-surface navigation registry scoped by the concrete host BlockNote editor and shell Block ID. The editor object is the first key and the shell ID is the second. A module-global map keyed only by Block ID is invalid because duplicate mounts and different host editors may legitimately render the same stable shell identity. Registration cleanup removes only the handle it registered, so StrictMode cleanup or an older NodeView cannot unregister a newer handle.

The host NFM key handler consults the bridge only for unmodified, non-composing ArrowUp/ArrowDown gestures. A text cursor may enter a registered embedded surface only when ProseMirror's `EditorView.endOfTextblock("up" | "down")` reports that native movement would leave the current visual textblock. A NodeSelection on the registered childless shell may enter directly. Normal wrapped-line movement, range selections, modifier shortcuts, IME composition, ordinary custom Blocks, and unavailable or cycle-ineligible Cards remain native.

The visible traversal order is:

    previous host Block
      <-> live Card title
      <-> first ... last target body Block, only when disclosed
      <-> next host Block

ArrowDown enters the title at its start. ArrowUp entering a collapsed Card enters the title at its end; entering an expanded Card from below enters the last visible body boundary. ArrowDown from the title enters the first visible body boundary when disclosed and otherwise enters the next visible host Block. ArrowUp from the first visible body Block enters the title. ArrowDown from the last visible body Block enters the next host Block. Reverse transitions are symmetric, including consecutive Card shells and nested Card outliners.

Host neighbor resolution uses the Block tree's visible depth-first order and respects collapsed native toggle children. ProseMirror owns visual textblock boundary detection inside NFM editors. `CollaborativeCardTitle` is a standalone contenteditable rather than a ProseMirror view, so it uses a DOM-selection geometry helper to decide whether the caret is on the first or last rendered title line, with logical start/end as the non-layout test fallback. These boundary adapters are renderer behavior; they do not enter shared document contracts.

Escape from the live title returns focus to a NodeSelection on the host shell without changing disclosure. Clicking the disclosure caret remains disclosure-only. Enter on a selected shell may request title editing, but it does not implicitly expand the body.

### Focused editing has activation priority

The renderer-wide referenced-surface budget remains a hard cap. Eligibility gains a small priority dimension: a surface with an active editing engagement ranks above visibility-only expanded surfaces, then recency orders peers. At most one DOM focus owner normally has this priority. This prevents an explicit Arrow/click entry from being immediately evicted by an unrelated visibility observation while preserving bounded provider count and normal LRU resumption after focus leaves.

The priority is per mount and disposable. It is not an edit lock, presence authority, or persisted preference.

## Consequences

Collapsed Cards behave like ordinary outliner headers without making every collapsed reference expensive. A user can click-edit a title before revealing the body, and ArrowUp/ArrowDown traverses host Blocks, the authoritative Card title, and disclosed body Blocks in visual order. The shell remains atomic to ProseMirror and identity-only to NFM, while the interaction feels transcluded.

The renderer gains an explicit cross-EditorView focus protocol and a mount-local engagement state. That is additional interaction code, but it replaces accidental DOM/browser focus escape, removes Block-ID-global registry ambiguity, and makes async loading behavior testable. The same generic bridge can later serve another childless embedded surface, but this decision does not require Database View rows or body-only reference shells to adopt title semantics.

Provider count remains bounded. Idle collapsed lists retain summary-only rendering. A briefly activated collapsed title may show the same sparse loading/failure state as an expanded target, but the body area remains absent and disclosure does not move.

No persisted-data migration, schema version change, or NFM migration is required. The migration is entirely in renderer state, focus routing, tests, and product documentation.

## Invariants

1. A `card` or `cardRef` host remains a childless `content: "none"` Block containing no foreign title or body.
2. An idle collapsed Card row mounts no target provider; explicit editing engagement may mount exactly one target runtime.
3. The projected rich title is never editable and never becomes a write authority.
4. One active target runtime supplies both the live title and, when disclosed, the body.
5. Disclosure preference and editing engagement have different identities and lifetimes.
6. Host and target navigation crosses through an explicit editor-scoped handle, never event bubbling or a Block-ID-global map.
7. Arrow interception occurs only at visual boundaries and never consumes modified, composing, or range-selection movement.
8. A pending async focus intent survives lazy loading and provider synchronization and is applied at most once.
9. A focused editing engagement outranks visibility-only surfaces without exceeding the provider budget.
10. Missing, deleted, archived, self-referential, and cyclic targets never activate recursive editing.

## Alternatives Rejected

Making the portable rich-title projection contenteditable was rejected because it would create a second write path without the target surface's Yjs selection, undo, awareness, readiness, or write fence.

Mounting every collapsed target runtime was rejected because long outliners would allocate providers and Y.Docs for titles already available through a bounded exact-head projection.

Expanding the Card automatically whenever its title is edited was rejected because title editing and body disclosure are independent user intents. Native toggle headers do not reveal children merely because their header receives focus.

Changing `card` or `cardRef` to inline-content Blocks was rejected because the host Y.Doc would acquire a competing copy of target title content and the shell would stop being an honest foreign-document reference.

Letting the browser discover nested editors through DOM focus escape was rejected because the NodeView and nested event-isolation boundaries intentionally prevent a shared selection model, and browser behavior is not symmetric across entry and exit.

Keeping the existing global inline-summary map was rejected because a stable Block ID is not a unique mounted interaction identity. Separate host editors and StrictMode remounts can otherwise steal or delete one another's handles.

Using only logical `parentOffset === 0/content.size` checks was rejected because ArrowUp/ArrowDown are visual-line commands. A wrapped paragraph or title can be at its first or last rendered line without being at its logical string boundary.

## Acceptance

Create a paragraph, a `card` or `cardRef`, and another paragraph in one NFM editor. Leave the Card collapsed. The row initially uses its portable rich-title projection and no target provider. Press ArrowDown at the previous paragraph's last visual line: after any target-loading interval, the authoritative title receives focus at its start and the body remains hidden. Edit and undo the title; another mounted Card surface converges, while the host Y.Doc and canonical NFM remain unchanged. Move focus away and observe the idle row return to projection eligibility.

Click a collapsed projected title and edit it without expanding. The caret lands near the click when layout permits. Select formatting, use IME composition, and press Escape; title operations remain local to the target surface and Escape returns selection to the host shell without changing disclosure.

Expand the Card and traverse downward: previous host, title, first through last visible body Block, next host. Traverse upward and observe the exact reverse order. Wrapped host/title/body lines keep ordinary within-line vertical movement until their first or last visual line. Collapsed native toggle descendants are skipped. Consecutive and nested Card shells use the same order without selecting hidden content or requiring a second Arrow press on the Card shell.

Render the same shell identity in two host editors and mount/unmount both under StrictMode. Each Arrow gesture enters only its own Card instance, and an older cleanup cannot remove the other handle. Fill the activation budget with expanded references, then Arrow-enter a collapsed title; the focused title remains active, provider count stays within capacity, and the displaced visibility-only surface resumes after engagement ends.

Storybook includes an active-but-collapsed title state with no body. Browser coverage proves wrapped visual-line boundary behavior; renderer tests prove registry scoping, async focus intent, projection/provider lifecycle, and the full traversal contract. Final visual verification remains manual in the development app.

## References

- [BlockNote custom Blocks](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks)
- [BlockNote extensions](https://www.blocknotejs.org/docs/features/extensions)
- [ProseMirror `EditorView.endOfTextblock`](https://prosemirror.net/docs/ref/#view.EditorView.endOfTextblock)
- [ProseMirror selections](https://prosemirror.net/docs/ref/#state.Selection)
