# ADR 0009: Block disclosure preference is per-user local state

- Status: Accepted
- Date: 2026-07-14
- Owners: Nodex maintainers
- Extends: ADR 0002, ADR 0007, and ADR 0008

## Context

An owning `card` shell, a non-owning `cardRef`, a Synced Block reference, a Template reference, and a Database View row can reveal an independently owned Document inline. The first implementation intentionally kept every expansion in renderer memory, but it used one mount-specific key for both disclosure and provider activation and cleared that key during unmount. Switching Cards, tabs, or Projects therefore forgot the user's open/closed choice even though native BlockNote toggles already remembered the same presentation choice by stable Block ID.

Disclosure intent and provider activation have different lifetimes. The user expects a disclosure choice to survive remount and application restart. A live provider must remain tied to a concrete visible mount so duplicate views get independent Yjs clients, activation-budget slots, focus recency, and teardown. Neither state is collaborative content: opening a shell must not change another collaborator's Document, enter undo/history, alter NFM export, or require the target Document to be loaded.

Target eligibility is also transient. A persisted-open Card shell commonly renders before its target query has finished. Treating that loading interval as a collapse would overwrite the preference before the target can become available. Cycle/error/permission states have the same distinction between current capability and stored user intent.

## Decision

Nodex stores disclosure preference in a renderer `BlockDisclosureStateStore` keyed by stable shell Block identity. Production persistence uses the browser profile's local toggle storage contract shared with native BlockNote toggles. Missing or malformed state defaults collapsed. Storage failure degrades to live renderer memory and never blocks the interaction.

Identity rules are:

- an owning `card` shell uses its Card Block ID;
- a `cardRef`, Synced Block reference, or Template reference uses its own occurrence Block ID, never the target owner ID;
- a durable Database View row uses the stable View-reference occurrence plus Card ID;
- Move retains preference because application identity is retained;
- Copy defaults collapsed because it allocates new Block IDs.

Each renderer hydrates a preference once and shares it among duplicate mounts of that identity inside the renderer. The persistence backend is shared by windows, but active renderers do not subscribe to cross-window storage events. A window therefore keeps its current presentation until remount, avoiding remote UI motion and surprise provider admission; a later mount reads the latest stored value.

Every mounted surface separately allocates a mount identity for visibility and `ReferenceSurfaceActivationBudget`. Effective expansion is:

```text
preferredExpanded && currentlyExpandable
```

Loading, error, cycle, permission, visibility, activation-budget eviction, or provider teardown may make a surface ineffective or inactive, but none of them writes a disclosure preference. Unmount releases only the per-mount activation entry.

Disclosure preference never enters Y.Doc, Block props, SQLite content authority, NFM, clipboard/export, Document checkpoints, undo, search, or backup authority. It is disposable local view state.

## Consequences

Embedded Cards and references reopen as the user left them after navigation or restart. Multiple references to the same Card remain independent because reference identity, rather than target identity, owns presentation. Duplicate views in one renderer agree on disclosure intent while still mounting distinct providers when visible and admitted.

The renderer no longer conflates React mount lifetime with Block lifetime. Provider caps and cycle prevention remain unchanged, and a temporarily unavailable target can resume its stored-open presentation without generating a content write.

Browser-local preference may be evicted or cleared without data loss. A user can observe the default collapsed state after storage removal, which is acceptable because the preference is not authority.

## Alternatives Rejected

Adding `expanded` to `card` or `cardRef` Block props was rejected because BlockNote props are Document data. It would broadcast a personal UI action, pollute undo/history, and make separate viewers fight over one presentation value.

Storing disclosure in SQLite was rejected because there is no domain mutation, sharing, backup, or server-query requirement. It would add IPC/HTTP commands and future user-identity ambiguity for disposable synchronous UI state.

Continuing to key disclosure by React `useId()` was rejected because remount necessarily creates a new identity. Keying `cardRef` by `targetBlockId` was rejected because separate occurrences need independent preferences.

Live cross-window synchronization through the browser `storage` event was rejected because it would make one window unexpectedly open or close another window's nested editors and consume its provider budget.

## Acceptance

Expand an owning Card or Card reference, navigate away, and return: the shell reopens after target eligibility resolves. Close and restart Nodex: the same browser profile hydrates the preference. Collapse it and repeat: it remains collapsed.

Create two `cardRef` Blocks targeting the same Card and expand only one: the other remains collapsed. Show one shell in two views inside one renderer: both reflect the same preference, while the activation budget reports two independent mount identities when both are visible.

Load a persisted-open shell through loading, error, or cycle-ineligible states: no state write changes the preference. Once it becomes eligible, it opens. Inspect Yjs updates, NFM export, history, and undo: disclosure actions produce no content operation.

## References

- [BlockNote custom Block properties](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks)
- [ProseMirror plugin and NodeView state](https://prosemirror.net/docs/guide/)
- [Browser storage event semantics](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)
