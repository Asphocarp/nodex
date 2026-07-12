# ADR 0005: Canvas uses a scene-native sync engine

- Status: Accepted
- Date: 2026-07-13
- Owners: Nodex maintainers
- Supersedes: the Canvas/Yjs extension described by ADR 0002

## Context

Nodex models every independently loaded, synchronized, persisted, and history-scoped content owner as an Owned Document. Cards and other BlockNote-backed owners use Yjs because their `block_tree` content benefits directly from fine-grained CRDT text and tree operations.

The first Block-first Canvas implementation extended the same Yjs storage engine to Excalidraw. It stored complete immutable Excalidraw element revisions in Yjs maps, resolved concurrent contenders with Excalidraw's own `version` and `versionNonce` rules, and then persisted a complete JSON scene materialization in SQLite for references, assets, search, backup validation, and reads.

That implementation conflates two independent decisions: Canvas should be an Owned Document, but an Owned Document does not necessarily need Yjs as its content engine. Excalidraw already treats each element as an atomic versioned value and supplies deterministic reconciliation. Wrapping those values in Yjs adds another causal history without improving same-element merge semantics. It also makes high-frequency pointer edits accumulate deleted Yjs structures: a local benchmark of the implemented revision-register model grew one 134-byte effective element into a 52,135-byte full Yjs state after 1,000 edits and 263,841 bytes after 5,000 edits. Re-encoding a compacted full-state snapshot retained that growth.

The prior whole-scene Canvas row was also insufficient because renderers debounced and overwrote complete snapshots. The durable replacement must keep server-side element reconciliation, idempotent mutation receipts, durable acknowledgement, multi-window convergence, gap repair, and reliable close/fence flushing without retaining a second CRDT history.

## Decision

Owned Document is the engine-neutral domain boundary. It owns identity, Project scope, owner Block, schema, generation, monotonically increasing durable head, lifecycle, history identity, subscriptions, write leases, backup/retention participation, and projection coordinates. Content synchronization is selected explicitly by the registered schema:

- `block_tree` schemas use the `yjs` sync engine.
- `scene_graph` Canvas schemas use the `canvas_scene` sync engine.

The common descriptor carries an explicit sync-engine discriminant. Yjs state vectors and binary updates belong only to Yjs-specific heads, transports, stores, providers, checkpoints, and recovery data. Canvas scene snapshots, element candidate batches, and scene receipts belong only to the Canvas engine. Runtime legacy-shadow state remains isolated in the v69-to-v70 migration seam and is not a public authority variant.

Canvas authority is normalized in SQLite:

- one scene row owns generation, head, durable shared app state, and the exact content hash;
- one current row per Excalidraw element stores its complete portable JSON value, element identity, `version`, `versionNonce`, deletion state, and durable order key;
- one current row per managed file stores its immutable metadata and asset URI;
- immutable mutation receipts bind a caller mutation identity to its canonical request and first durable outcome;
- rebuildable reference, asset, search, preview, and summary projections remain separate from authority.

A renderer submits a bounded mutation containing changed element candidates, expected/value app-state field intent, and newly uploaded managed file metadata. Element absence never means deletion; an Excalidraw tombstone is an explicit candidate. The single SQLite writer compares candidates with the current authority using Excalidraw's ordering: greater `version` wins, equal versions use the lower `versionNonce`, and a canonical payload hash breaks malformed ties deterministically. A stale base head may merge; a future head, wrong generation, wrong Project, or wrong store epoch fails closed. The writer validates every resulting managed asset and Card reference, advances the scene head only for an effective change, refreshes projections, appends the change evidence, and records the mutation receipt in one transaction.

Scene subscriptions publish committed canonical deltas with the resulting head. A renderer that observes a gap, reconnects, completes a write lease, or receives an ambiguous event reloads one bounded full canonical scene. The renderer keeps Excalidraw as the immediate local editing and undo authority, coalesces frequent observations before durable mutation, uploads assets before references, and presents remote canonical scenes through Excalidraw reconciliation with `CaptureUpdateAction.NEVER`. Its persistent local outbox contains exact immutable scene mutations, not Yjs checkpoints, and is invalidated by store-epoch or generation changes.

Document history checkpoints use an explicit checkpoint format. Yjs Documents store a Yjs full update plus causal vector metadata. Canvas stores bounded canonical scene JSON. Restore is always forward: Canvas restore compiles newer element versions and explicit tombstones, then commits one ordinary scene mutation after the same mounted-surface flush/freeze lease used by other identity-sensitive Document commands.

The existing process-wide Hub remains the owner of Project-scoped subscription identity, connection lifetime, store reset, resync requests, and write leases, but engine payloads are discriminated. Yjs Awareness remains a Yjs-engine concern. Canvas presence is not persisted and will use a future engine-neutral presence protocol if the product exposes collaborative pointers.

## Consequences

Canvas no longer writes `document_updates`, `document_snapshots`, Yjs state vectors, or Yjs IndexedDB checkpoints. Its durable size follows the current scene plus bounded receipts/checkpoints rather than every pointer-era Yjs structure. BlockNote-backed Documents retain the existing Yjs provider and storage behavior unchanged.

The renderer and main process gain parallel engine-specific providers and transports behind one Owned Document identity boundary. Common types cannot expose a fake universal content object; callers must dispatch on the sync-engine discriminant. Block relocation remains a `block_tree` operation and rejects Canvas statically and at the authority boundary, while common write leases remain available to Canvas restore and owner deletion.

Schema migration materializes every existing Canvas Y.Doc into scene-native authority before deleting that Canvas Document's Yjs tail and operational snapshots. Existing Canvas history checkpoints are converted to canonical scene JSON before their Yjs payload is removed. The migration is atomic and fails readiness without partially changing an owner when any scene, reference, or managed asset is invalid.

## Alternatives considered

Keeping Canvas in Yjs and adding debounce reduces update frequency but retains double reconciliation, engine leakage, and unbounded causal-state growth. Periodically rebuilding a fresh Y.Doc would require generation resets and would invalidate offline causal state, making recovery more complex than a scene-native protocol.

Storing only a debounced whole-scene JSON snapshot is simpler but reintroduces lost updates between windows. It is rejected unless the writer performs element-wise reconciliation and retains immutable retry evidence, at which point normalized element authority is clearer and avoids rewriting unrelated large elements.

Representing every Excalidraw field as nested Yjs shared types could enable finer merging, but Excalidraw itself consumes atomic element objects and owns its editing/undo semantics. Maintaining a parallel field-level scene model would couple Nodex to upstream internals and still require expensive conversion and repair. It is rejected.

