# ADR 0011: Card references persist identity and refresh from Card target events

- Status: Superseded by ADR 0024 (2026-07-22)
- Date: 2026-07-15
- Owners: Nodex maintainers
- Extends: ADR 0002, ADR 0006, ADR 0007, and ADR 0010

ADR 0024 retains this decision's stable-identity and canonical-reread model, but
replaces the best-effort Page-target event and renderer hub with the durable,
resource-complete projection invalidation stream used by every canonical read.

## Context

Nodex stores a non-owning Card reference as a `cardRef` Block whose stable coordinate is `targetBlockId`. A child `card` Block is a different ownership relationship, but its target identity is likewise the Card Block ID of the shell itself. Both surfaces render through the membership-independent `CardTargetReadModel`, whose exact-head content summary supplies the collapsed rich title without mounting the target Y.Doc.

The current schemas also persist `displayHint` in each `cardRef` and `card` shell. In NFM this produces values such as `<card-ref target-block="..." display-hint="Old title" />`. The hint is copied only when the shell is created or migrated. Renaming or clearing the target Card title does not update every host Document, so the value necessarily becomes stale. It is then observable during loading, failure, deletion, and—because an empty current title falls back to the hint—even after an authoritative target read succeeds.

This denormalization has no stable ownership rule. Updating every referring host Y.Doc would turn one Card edit into unbounded cross-Document writes, create merge noise, and risk making a display snapshot look authoritative. Keeping the hint but treating it as harmless metadata still leaves stale content in canonical NFM, derived reference rows, copied Documents, and agent-facing representations.

The realtime path also has the wrong boundary. Mounted Card target queries currently subscribe to the target Project's `board-changed` stream. Every board event refreshes every distinct target query in that Project. More importantly, a Card Document update emits a board event only after resolving a Database-row `CardSummary`. A valid Card nested in another Document has no active Database membership, so its committed title/body update can produce no event and a collapsed reference can remain stale until focus or remount. Deleted targets also stop subscribing because only the `available` read-model branch contributes a Project ID.

## Decision

### Canonical Card references persist only stable identity

Writable internal `cardRef` Blocks persist `targetBlockId` and no `displayHint`. Writable child `card` shells persist no title-like property; their outer Block identity is the Card identity. NFM exposes the owning identity and uses the existing Card deeplink vocabulary for non-owning mentions:

    <card uuid="019f..." />
    <mention-card url="nodex://cards/019f..." />

`uuid` is an identity pin for the owning shell, not copied presentation data. During exact-head whole-NFM replacement it may preserve or reorder only an existing `card` shell in that same Document. Unknown, duplicate, wrong-type, or differently located identities fail closed; creation, copy, and cross-parent movement remain typed authority operations. Genesis/import paths allocate fresh identities rather than adopting exported Card UUIDs.

`mention-card` remains a childless block-level reference, despite its user-facing mention name. Its URL is decoded and rebuilt through the shared `nodex://cards/<card-id>` deeplink contract, while the durable BlockNote/Yjs node remains `cardRef`: renaming that internal node would require a current-head and historical-schema migration without changing product semantics. The NFM parser may decode historical `<card />` and `<card-ref ... />` inputs for migration or contextual replacement, but canonical materialization emits only the two forms above. `databaseViewRef` and `templateRef` hints are outside this decision because their lookup and offline presentation contracts are separate.

A collapsed Card row reads current rich title only from the exact-head membership-independent `CardContentSummary`. An available Card whose canonical title is empty renders `Untitled`; it never resurrects historical text. Loading, missing, deleted, invalid, and error rows render stable state copy such as `Loading Card…`, `Card unavailable`, or `Deleted Card`. If the product later requires offline last-known Card titles, that is a separate centrally owned cache with explicit freshness metadata, not duplicated authority in every reference.

### Existing CRDT attributes are removed through the Document writer

The SQLite store schema first advances one version and runs a resumable fixed-point migration before normal startup. It scans ready primary block-tree Documents for `cardRef` and `card` XML content elements with a `displayHint` attribute, generates the minimal Yjs deletion update, and commits it through the existing strict Document update path. That path advances the Document head, validates the resulting Block tree, rebuilds exact-head materializations and secondary reference projections, and records an idempotent update receipt.

The migration does not rewrite Yjs history or rotate a Document generation. A partially completed run is safe: already-clean Documents are skipped, committed deletion updates remain valid, and the store's `user_version` advances only after the scan reaches a clean fixed point. New writable schemas stop producing the attribute before the migration runs, so concurrent normal editing cannot recreate it.

Document schema versions remain unchanged. The removed field is a deprecated shared Block presentation property rather than a new Card root or body content model; the store schema version is the migration ledger. Historical snapshots and updates remain replayable because Yjs preserves the old attribute until the committed deletion update is applied, while current materialization intentionally ignores it.

A following store-schema migration rematerializes every readable ready current block-tree head without changing Yjs state, generation, or head sequence. This projection-only fixed point upgrades persisted NFM from `<card />` / `<card-ref ... />` to the identity-bearing/Card-deeplink vocabulary and rebuilds secondary references plus Card read projections from the same authority. Retained deleted owners stay unreadable under the normal live-Document invariant; restoring one first reactivates its indexed closure and then performs the same rematerialization in the restore transaction before the Card becomes observable. Projection syntax changes do not manufacture causal Document updates.

### Card target freshness has its own identity-keyed event

Nodex adds a project-scoped `card-target-changed` event with this semantic contract:

- `projectId` scopes transport and authorization;
- `targetBlockId` is the invalidation identity;
- `changeKind` is `content`, `lifecycle`, `location`, or target-visible `metadata`;
- committed Document coordinates are included for content changes when available.

The event means that a previously read `CardTargetReadModel` for the identity may be stale. It is not a replacement Card summary and it carries no Database property or View position. The main process emits it after every committed Card Document head change independently of Database membership, and after lifecycle, location, or metadata mutations that can change the target read model. Project transfers publish on both the prior and new Project streams so existing subscribers can follow the identity across scope changes.

`board-changed` remains the Database-row/board projection event. A Card Document update may still publish it when an active Database-row summary exists, but absence of that optional projection is normal and must not suppress `card-target-changed` or log a false corruption error.

Browser SSE and Electron IPC expose the same typed event. The browser continues to multiplex one physical Project stream; the renderer hub dispatches only to consumers registered for the matching `targetBlockId`. A mounted query invalidates its exact TanStack Query key, allowing normal active-query refetch and request deduplication. Deleted targets retain their Project subscription so restore/lifecycle changes can refresh them. Database View references keep their existing board-driven refresh until they receive a domain event of their own.

## Consequences

Card titles have one authority: the target Card Document and its exact-head summary projection. Renames, formatting changes, and an intentional empty title cannot conflict with text copied into a host. Canonical NFM is stable under target title changes, exposes owning Card identity, and represents references as portable Nodex resource URLs.

Realtime cost becomes proportional to affected identities rather than every referenced Card in a Project. Nested zero-membership Cards refresh correctly because notification no longer depends on a Database row. The event contract also fixes deleted-to-restored targets and makes future Card target consumers share one invalidation boundary.

The migration adds one bounded startup pass and one Yjs update to each affected Document. This is preferable to retaining an indefinite compatibility field or performing fanout writes on every title change. Historical data remains auditable, while the current head and every regenerated projection are hint-free.

## Rejected alternatives

- Update `displayHint` in every host whenever a Card title changes. This creates unbounded cross-Document writes, conflicts with offline collaboration, and duplicates authority.
- Read the target Y.Doc for every collapsed reference. This replaces a stale snapshot problem with unbounded provider/Y.Doc loading even though an exact-head bounded projection already exists.
- Keep `displayHint` only as an error fallback. A copied title still has no freshness contract, leaks into canonical representations, and makes missing/deleted state ambiguous.
- Serialize owning Card shells as bare `<card />`. The underlying Block ID is available but the projection would erase the shell's only distinguishing semantic coordinate, leaving identical nested Cards ambiguous during agent inspection and whole-NFM replacement.
- Persist `uuid` or `url` as new Yjs props, or rename the durable `cardRef` node to `mentionCard`. Both duplicate already-authoritative outer/target identity and impose current-head plus historical-schema migrations for a presentation vocabulary change.
- Treat an arbitrary `<card uuid="..." />` as create, copy, or move. Owning Cards require an independently prepared Document and exclusive-parent transaction; text import cannot safely perform those authority operations implicitly.
- Reuse `board-changed` and filter by `cardId`. This cannot represent Cards outside Database membership and keeps Card content freshness coupled to board semantics.
- Put the full current title in `card-target-changed` and update caches directly. The event would become another projection transport with versioning and ordering responsibilities. An identity invalidation event is smaller and lets the validated reader remain the source of truth.
- Add a global unscoped Card event stream. Project scoping is the existing authorization and transport boundary; cross-Project moves can be handled by publishing on both affected scopes.

## Acceptance

A newly inserted internal `cardRef` persists only `targetBlockId`, and a child `card` shell persists no title or copied identity prop. Canonical NFM emits `<mention-card url="nodex://cards/..." />` and `<card uuid="..." />`, deriving both from authoritative coordinates. Historical Card tags are decode-only. The store migrations remove old XML attributes through durable Yjs updates, then rematerialize the new syntax at the same current head without changing Block IDs, Document IDs, generations, or causal state.

Renaming and clearing a Database-member or Document-parented Card refreshes only mounted queries for that Card identity in other windows/browser clients. A zero-membership Card emits `card-target-changed` even when no board summary exists. Deleted targets remain subscribed and refresh after restoration. Database board consumers continue to receive their existing summaries when a Database projection exists.
