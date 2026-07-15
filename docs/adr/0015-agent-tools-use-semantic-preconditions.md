# ADR 0015: Agent tools use semantic preconditions

- Status: Accepted
- Date: 2026-07-16
- Owners: Nodex maintainers
- Extends: ADR 0002, ADR 0003, and ADR 0005

## Context

The first `nodex_app` dynamic-tool contract exposes six kinds of opaque revision: Document, Block location, Database schema, Database value, View, and View placement. Read tools mint every revision that a later write might need. A Database query therefore returns location and value proofs for every selected row even when the Agent only reads the result or edits one cell. Because each proof embeds a signed JSON payload containing its kind, Project, store epoch, subject, and internal revision coordinates, the proofs can dominate the result. In a representative thirteen-row query, revision strings account for 15,374 of 18,801 response characters.

The concurrency guarantees are valuable, but the public contract exposes the shape of the storage implementation. An Agent has to understand that a Database value depends on a membership revision and property schema revision, that a placement depends on View and grouping-value revisions, and that a Document write depends on generation and head coordinates. This makes the public interface shallow: internal changes force schema changes, broad reads return low-value data, and Agents spend context carrying values that only a writer Adapter can interpret.

Code Mode changes the efficient interaction pattern. A generated JavaScript program can query broadly, filter inside an isolated V8 runtime, perform narrow fresh reads, feed their results directly into later tools, and emit only a bounded summary to the model. Intermediate rows, NFM, cursors, and validators need not enter the model context. The current Codex dynamic-tool protocol still returns Nodex results as JSON text rather than structured JavaScript objects, and dynamic tools are serialized by the current router, but Code Mode still removes model round trips and supports batching.

Nodex's canonical mutation kernels already separate public intent from internal compare-and-set coordinates. `BlockTransferIntent`, for example, contains stable logical source and target locations, while the SQLite writer compiles current Block locations, membership revisions, and Document heads into a private `BlockTransferRequest`. Agent tools should follow this model instead of adding a second public revision layer above it.

## Decision

### Public concurrency is operation-scoped

`nodex_app@2` removes the six public revision types. A write carries only the smallest precondition that protects the semantic operation from overwriting concurrent work:

- Card creation, NFM insertion, stable-anchor Block movement, and set-like add/remove intent carry no validator. The writer resolves their anchors and schemas against current authority and rejects an invalid semantic target.
- An exact NFM patch uses `oldNfm` plus `expectedMatches` as its compare-and-set condition. It may recompile against a newer Document when unrelated content changed, but fails when the exact source no longer matches.
- Whole-NFM replacement, title replacement, stable Block update or deletion, scalar Database value replacement, View placement, and future schema or View-configuration replacement use a narrow ETag supplied as `ifMatch`.
- Deleting a Block guards the complete target subtree, not only the root fields, so a child added after the Agent's read cannot be removed under an older authorization.
- Moving a bounded root set uses one shared logical `from` location because the transfer kernel requires every root to share one source container. Copy does not require a source validator. The writer remains responsible for exact location, membership, and Document-head compilation.

An ETag is one opaque string type regardless of the internal domain. Its operation position determines the expected guard kind. A short ETag has the form `nxe1.<digest>`, where `digest` is the base64url HMAC-SHA256 of a canonical tuple containing the version, guard kind, Project, current store epoch, subject identity, and current semantic state. The state is not embedded in the token. A write Adapter reads current authority, recomputes the expected digest with a timing-safe comparison, and then compiles internal numeric revisions from that same snapshot.

A malformed ETag is an invalid argument. A well-formed ETag that does not match current authority is a conflict. ETags are compare tokens, not authorization capabilities. Project binding, task authorization, store-epoch binding, and kernel compare-and-set checks remain independent.

Pagination cursors remain self-contained because the server must recover an offset and query snapshot from them. Cursor encoding and ETag encoding are separate modules and formats. A digest-only ETag must never be used as a cursor.

### Reads are data-first and prepare validators on demand

`get_context`, `get_block`, and `query_database` return no ETags by default. A bounded, typed `prepareFor` list requests validators for specific operations and fields. Examples include `title.set`, `document.replace`, `block.update`, `block.delete`, `value.set`, and `view.place`. The server emits ETags only beside the requested title, body, Block, property value, or placement.

Broad discovery should normally omit `prepareFor`. In Code Mode, the Agent first queries and filters, then performs narrow fresh reads only for the selected resources. A direct caller that already has an exact filtered target may request validators in its initial read.

### Authorization protects semantic scope, then the writer recompiles

The first contract freezes one internally compiled command before consent. `nodex_app@2` instead authorizes a semantic operation and records an authorization footprint. The footprint contains the effect class, target authorities, ownership transformations, and protected updated or deleted roots that the user is approving. It does not contain incidental Document heads, numeric revisions, physical rank keys, or the complete resulting NFM.

After consent, the writer reads current authority again, revalidates operation-specific guards, and recompiles the semantic intent into a new exact kernel command. If unrelated concurrent work changed only internal coordinates and the authorization footprint did not expand, execution can continue. If the effect class, protected deletion set, ownership closure, destination authority, or other user-visible mutation scope changes, the old consent is discarded and the call returns a retryable conflict; a fresh invocation produces the new preview instead of trapping the user in an internal consent loop. A guard mismatch likewise returns a conflict rather than silently rebasing an overwrite.

The existing internal protections remain mandatory: Document generation/head checks and write fences, Database value/position/schema revisions, Block location and membership revisions, store epoch, immutable mutation receipts, and exact retry identity. Public ETags do not replace kernel compare-and-set coordinates.

Committed dynamic-call replay is checked before current-state guard validation. An exact retry returns the committed sparse result even if the affected resource has changed again since that commit.

### Mutation results are sparse by default

Writes return the identities and bounded effect counts needed to understand the outcome. They do not expose receipt duplication flags, unchanged validators, full internal receipts, or complete resulting NFM by default. A bounded `return` selector may request complete NFM, detailed Block ID mappings, or fresh ETags when the next operation needs them. Durable receipts retain the evidence required for exact retry without using the model-facing result as an observability channel.

The transcript and model output are separate projections. Transcript items retain canonical arguments, result content, success, duration, and exact raw protocol data. NFM previews continue to derive from the mutation arguments. Debug detail is not added to Agent output merely to make the transcript inspectable.

### Code Mode guidance is namespace-scoped

The namespace description states once that current dynamic-tool results are JSON text. Code Mode should parse them once, keep intermediate NFM, rows, cursors, and ETags inside JavaScript, prefer bounded bulk operations over write loops, serialize dependent writes, treat an in-band `error` as failure, and emit only a bounded summary with `text()`.

The current dynamic-tool protocol has no `outputSchema`, `structuredContent`, or parallel-safety declaration. Nodex does not add unused generated fields and pretend that the pinned Codex binary supports them. A future Codex upgrade may add those protocol fields and a dedicated dynamic-tool output whose Code Mode result is the structured JSON value. Read-only tools may advertise parallel safety only after the router supports it. Until then, `Promise.all` may reduce model round trips but must not be described as concurrent I/O.

### The intent-oriented catalog remains small

The eight tools remain `get_context`, `get_block`, `search`, `query_database`, `create`, `edit_document`, `transfer_blocks`, and `edit_database`. They align with discovery, Document, ownership, and Database authority boundaries. Collapsing them into `find`, `read`, and one giant `change` union would enlarge deferred schemas, weaken authorization classification, and reduce transcript locality without reducing the underlying concepts.

`nodex_app@2` replaces the unreleased experimental v1 contract for newly started tasks. Nodex does not maintain a permanent v1 implementation solely for development tasks with no user data. A task pinned to the retired v1 catalog receives `tool_catalog_stale` and must start a new task. The historical v1 ExecPlan and transcript data remain truthful records; stored catalog bindings are not rewritten to claim that an old rollout used v2.

## Consequences

Typical reads become close to the size of the actual Project data. A thirteen-row query that previously spent more than eighty percent of its response on revisions returns zero validators unless requested. A prepared write normally carries one approximately 48-character ETag per overwritten semantic unit rather than a signed copy of internal state.

Agents no longer depend on the storage topology. Internal kernels remain strict and can evolve their exact revision sets without changing the public schema. Conflicts are local to the operation and observed resource rather than caused by unrelated schema, title, row, or Document changes.

The main-process Agent Adapter becomes deeper. It must own semantic-state hashing, on-demand guard planning, final re-resolution, authorization-footprint comparison, replay-before-guard ordering, and sparse result projection. Tests must distinguish public semantic guards from internal kernel CAS and prove that removing public revisions does not weaken atomicity or exact retry.

The contract is optimized for both direct models and Code Mode. Direct models can request exactly the validators they need. Code Mode can keep large intermediate values outside model context and use one narrow read plus one bulk mutation after filtering.

Old experimental tasks become explicitly stale instead of silently receiving a schema they did not start with. This is a deliberate development-stage break and preserves the app-server invariant that a resumed task's rollout and host catalog agree.

## Alternatives considered

Keeping every revision but shortening each token reduces bytes while preserving the shallow public topology and unnecessary validator count. It is insufficient.

Returning full revisions only when `includeRevisions` is true makes the caller choose storage concepts. Typed `prepareFor` expresses the intended operation and lets the server select guards.

Using server-side preparation handles can make results tiny, but introduces durable handle storage, garbage collection, expiry, restart recovery, and another authority lifetime. Code Mode plus stateless short ETags provides the needed context efficiency without that stateful protocol.

Removing optimistic concurrency entirely would allow whole-body, title, scalar value, Block deletion, and placement overwrites to discard concurrent work. It is rejected.

Maintaining v1 and v2 indefinitely would preserve old development tasks at the cost of duplicate services, schemas, tests, and security review. Because the feature is unreleased and the product has no real user data, explicit retirement is simpler and more truthful.
