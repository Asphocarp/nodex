# ADR 0018: Full-access Turns receive ephemeral Library authority

- Status: Accepted
- Date: 2026-07-17
- Owners: Nodex maintainers
- Extends: ADR 0017

## Context

Project resource grants and Codex execution permissions answer different
questions. Grants determine which Library resources an ordinary Project task
may use. Codex permission presets determine filesystem, network, and approval
behavior for a Turn. Treating Full access only as a process sandbox setting
left `nodex_app` confined to Project grants, while treating it as a durable
grant would leak authority into later Turns.

Some Library content still carries a Project compatibility owner in the Block
and Document storage kernels. Complete Full-access support therefore also
requires Page create, move, and duplicate operations to cross compatibility
owners without weakening Library ownership or leaving split closures.

## Decision

### Authority is frozen to one exact Turn

Before every Project-bound `turn/start`, main creates an unbound Nodex authority
snapshot containing the verified root Thread, actor Project, Library, Profile,
store epoch, scope, and provenance. The first trusted Turn ID from either the
`turn/started` notification or `turn/start` response binds and persists the
snapshot. A second observation is accepted only when byte-equivalent.

Only Nodex's built-in `Full access` selection publishes Library scope with the
`:danger-full-access` permission profile provenance. Custom configuration is
Project scope even when its raw sandbox and approval values are equivalent.
Main persists the user's preset selection separately from raw Codex config and
accepts it only while the effective sandbox/reviewer semantics still match;
renderer-provided Turn fields are never preset provenance.
Missing historical provenance safely falls back to Project scope. A recorded
snapshot that is stale or inconsistent fails closed rather than falling back.

An app-server background subagent's initial Turn may inherit the exact parent
Turn's Library authority. A later child Turn resolves its own preset. An
independent `codex_app create_thread` task does not inherit its caller's Nodex
authority.

### Library authority is an overlay, not a grant

The unified resource authorizer delegates Project scope to normal binding and
recursive Page/Database grant evaluation. Library scope re-resolves the actor
Project, resource, Library, Profile, and store epoch and grants temporary
`read_write` access only inside the same Library. It never inserts, expands, or
updates `project_resource_grants`.

The frozen scope is transported internally with the dynamic call. Renderer
fields and public tool arguments cannot select or upgrade it. Resource
lifecycle, Project lifecycle, schema revision, ETag/CAS guards, and domain
validation remain live checks at prepare and commit time.

### Full access removes Nodex prompts, not mutation safety

Library-scope writes auto-approve both write and destructive effects without a
renderer authorization card. They still perform mutation-free prepare,
revalidate the exact Turn authority, prepare again, compare canonical effects,
resources, deletions, and ownership transformations, and commit through the
existing atomic kernels. Project-scope operations first resolve direct
binding/grant authority, then use the authorization broker only for
consent-eligible resource gaps. Main routes a consent occurrence to the
most recently activated renderer presenting the direct task, or its root task
for a background child. That presentation route is independent of canonical
conversation-state ownership: the renderer overlays the card locally without
publishing it into owner/follower state. Existing task grants remain bound to
the root task, Project, Library, app session, store epoch, and canonical
resource roots; changing or releasing a renderer or state owner does not revoke
them.

Agent call receipts bind exact Turn ID, authority fingerprint, and provenance
version. Historical committed receipts may replay their existing result;
historical prepared receipts without provenance cannot execute.

### Compatibility-owner transitions are typed and atomic

Library-scope Page creation uses the destination content's compatibility owner;
Library-top-level creation uses the actor Project. Cross-owner Page moves stage
the root at the source Library boundary, rehome the complete owned
Block/Document closure with stable IDs, and place it under the target owner in
one `IMMEDIATE` transaction. Duplicate allocates fresh identities and rehomes
the copied closure before target placement in that same transaction.

Deferred foreign-key checking is enabled only for the transaction. Derived
search, asset, read, schedule, membership, and View projections are rebuilt or
updated before `foreign_key_check` and ownership-closure validation. An
immutable Library relocation ledger records actor, source owner, final owner,
store epoch, operation hash, and every Block/Document member. Faults at any
transition boundary roll back content, projections, ledger, and Agent receipt.

## Consequences

- Ordinary Project tasks use their primary Database and `read_write` grants
  directly; read-only or missing same-Library authority enters the separate
  resource-consent policy recorded by ADR 0019.
- A built-in Full-access Turn can use every capability already exposed by
  `nodex_app@5` across its current Library, without adding tools or changing
  public schemas.
- Switching permission mode affects only later Turns; already captured calls
  retain their exact Turn authority.
- Restoring the store changes its epoch and invalidates all earlier Turn
  authority and approval evidence.
- Compatibility `project_id` remains an internal storage coordinate, but its
  cross-owner transition now has one typed, audited transaction boundary.
