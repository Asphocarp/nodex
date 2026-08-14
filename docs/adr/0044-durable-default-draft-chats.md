# ADR 0044: Durable default-draft Chats

## Status

Accepted

## Context

A Nodex Chat can own useful work before Codex has a Thread.
The composer, Page and Canvas surfaces, Terminal tabs, and other Window Session presentation all need a stable owner while the user is still preparing the first prompt.
Treating the app-server Thread as that owner would either create empty conversations too early or force local runtimes to accept a Session ID disguised as a Thread ID.

At the same time, ordinary threadless Sessions are not interchangeable.
An explicitly opened Page Chat, a recovered fork, or an externally materialized Thread may own a Session without being the destination of the next ordinary `New chat` action.
Renderer-side scans for any threadless Session therefore cannot express the product intent and cannot make cross-window creation atomic.

## Decision

The Project Session is the canonical identity of a Chat and its durable work context.
A Codex Thread is an optional execution conversation linked to that Session when the first send succeeds.
Core never replaces a Session's existing link with a different Thread; concurrent first sends therefore have one winning link, and Main deletes an app-server Thread that loses that race before it can become an orphan Chat.

Core Workspace owns one optional default-draft Session slot for every Project and one separate projectless slot.
`EnsureDefaultDraftSession` atomically returns the existing winner or creates a new active, threadless Session in that scope.
The winner is the sole affected Session in the apply receipt, so Main can hydrate that exact identity without a second scope lookup.
Ordinary Session creation never claims the slot, and renderer code neither reads nor writes the internal role flag.

The role has a narrow lifecycle:

- linking the first Thread or archiving the Session clears it in the same transaction;
- deleting the Session releases it naturally;
- restoring or unlinking never reclaims it;
- rename, pin, unread, fallback-title, and Scene changes leave it unchanged;
- moving it preserves the role when the target scope is empty and returns a conflict when that scope already has a winner.

Existing Stores migrate all Sessions as ordinary Sessions rather than guessing from title, order, Thread absence, or Scene content.
Database uniqueness constraints protect Project and projectless scopes, while Core mutations and startup validation protect the threadless and unarchived role invariants.

Window Sessions continue to own Scene presentation.
Normal `New chat` immediately ensures and selects the durable default Session, preserving its existing composer and surfaces.
The default role does not imply a fixed sidebar position: the Session participates in the normal durable Chat order, and first Thread attachment preserves that order.
The Project Agent Dock may retain a Window-local unbound draft until first send; materialization uses the same Core ensure operation, remains coalesced, and commits its Scene binding only after Thread start succeeds.

Terminal ownership follows the same identity split.
A pre-thread Session Terminal supplies the real Project Session ID and a null conversation ID; after Thread attachment, the same Terminal identity and PTY may acquire the real Thread association without being recreated.

## Consequences

- Repeated `New chat` actions in one scope converge on one visible Chat until send or archive graduates it.
- Resource-backed and recovery Sessions can coexist without being silently reused.
- Cross-window callers share one atomic Core authority instead of racing renderer reads and creates.
- Cross-window first sends cannot replace the winning Session-to-Thread link.
- Composer, Scene, Terminal, and Session identity survive the first-send boundary while Thread identity remains truthful.
- Manual Chat order survives the same boundary because ordering belongs to the Session rather than its optional Thread.
- The internal default role does not become another renderer-visible Session subtype.

## Rejected alternatives

### Use only app-server Thread identity

This would create empty conversations before the user sends or leave pre-send work without a durable owner.

### Keep New Chat only in Window state

This would hide prepared work from the sidebar and make recovery, cross-window convergence, Page ownership, and Terminal ownership depend on one renderer.

### Reuse any threadless Session

Thread absence does not reveal creation intent and would capture Page-backed or recovered Chats.

### Let renderer read then create

Two windows could choose different candidates or create duplicate drafts, so uniqueness and graduation belong in the Core transaction.
