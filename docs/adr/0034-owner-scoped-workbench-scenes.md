# ADR 0034: Owner-scoped Workbench scenes

## Status

Accepted

ADR 0035 partially supersedes this ADR's fixed-primary-plane and
"Conversation beside a Project" decisions. Owner-scoped Scenes remain the
authority, but a Project root now participates in the full-width surface stack
and Project collaboration is presented through the Session-bound Agent Dock
instead of a Project-owned Conversation surface.

ADR 0038 further supersedes the universal-primary invariant: the window-local
Pages Scene has no protected primary and owns only ordinary Library content
surfaces. Project and Session primary rules remain unchanged.

## Context

The Workbench currently treats one Project Session as both a conversation
domain object and the host for all Window Session-local presentation. A normal
Session therefore has an implicit Conversation primary plus right and bottom
panels, while a newly created Project receives a special `Database View`
Session whose right panel is expanded to full width. Page and Canvas entry
points also create or select a Session merely to obtain a panel host.

That coupling makes unrelated authorities depend on one another. Project,
Database, Page, and Canvas are valid without a Conversation. A Project Session
is a durable Conversation container, not a generic Workbench layout owner.
Window Session state is the authority for surface placement and geometry, and
Core must not contain presentation-only rows that exist only to bootstrap it.

ADR 0026 established that per-window panel state belongs to Window Sessions.
ADR 0032 established one Workbench location algebra, one durable renderer
writer, and one panel controller. This ADR deepens those decisions so the same
Workbench composition can present either a Project or a Session without a
special Project Home route.

## Decision

### One Scene model

A Window Session owns Workbench Scenes keyed by an explicit owner:

    Project owner -> current default Database View primary
    Session owner -> Conversation primary

Each Scene contains exactly one owner-root primary surface plus the existing
right and bottom panel trees. A surface descriptor identifies presentation and
stores only bounded resource or runtime references. It never stores Query
observers, Codex state, Browser handles, PTYs, editor objects, Documents, DOM
nodes, Promises, or other live authority.

The first implementation keeps a fixed primary and the existing right/bottom
placements. Right-panel maximize remains presentation geometry; it does not
move a surface, change its runtime identity, or replace the primary. Arbitrary
grids, floating surfaces, cross-Scene drag, and primary-panel swapping are not
part of this decision.

Surface kinds remain a closed discriminated union. Adding a surface requires
updating the strict codec, clone policy, renderer, capability resolver,
lifecycle cleanup, and tests. A dynamic plugin registry would hide those
compile-time responsibilities without providing a real second implementation.

### Stable caller locations

The selected Workbench location uses direct `project`, `session`, and `empty`
variants. Temporary routes retain one of those Scene locations as `returnTo`.
Project selection no longer selects a first Session or encodes the Project as
an empty Session location. Session selection retains an optional Project
context only for projectless navigation and missing-target recovery.

Project and Session Scene owners are exact identities. Bounded sidebar summary
windows are navigation indexes, not route-existence authority. Restored owner
locations hydrate with exact Project or Session reads; transient failures keep
the location and Scene, while an authoritative missing result may remove only
that owner Scene.

### Window Session layout v5

The canonical layout stores:

- the restorable Workbench location;
- Database search text keyed by Project;
- Scene snapshots keyed by canonical owner key.

The v4-to-v5 migration is pure, deterministic, and idempotent. Every legacy
Session view becomes a Session-owned Scene with a deterministic Conversation
primary. Existing panel descriptors, split trees, MRU order, collapse state,
sizes, and full-width state are preserved. A legacy `empty` location with an
active Project becomes a Project location. Project Scenes materialize lazily;
the migration does not infer one from a database-starter Session.

Main continues to own the revisioned Window Session catalog and renderer
continues to have one Maitai writer. Hydration reads legacy layouts but all
subsequent saves write v5. Profile-scoped sidebar and Database view preferences
remain outside Scene snapshots.

Scene writes use a functional updater against the latest Window Session state.
Callers must not calculate a replacement Scene from a captured render snapshot:
creation, panel placement, preview promotion, and concurrent resource opens must
compose as one atomic transition. The remaining Session-shaped renderer
projection is read-only and derives from `ProjectSession + WorkbenchScene`; it
is never accepted by a mutation API. Legacy Session-view code remains only as a
pure layout algorithm and v1-v4 decode substrate. There is no writable legacy
adapter or dual Scene/Session-view store.

### Navigation and panel responsibility

`WorkbenchWindowState` owns atomic location, Scene map, history, and persistence
transitions. `WorkbenchSceneNavigator` owns cross-route owner selection,
materialization, surface deduplication, and presentation requests.
`WorkbenchPanelController` continues to own arrangement and runtime ordering in
the selected Scene. No catch-all Workbench event bus or second layout store is
introduced.

Renderer-local panel slots use the canonical Scene owner key. Maps whose values
are genuinely Session-domain state, such as Thread or Conversation runtime
records, continue to use the Session ID explicitly. This distinction prevents a
Project Scene from fabricating a Session identity while preserving true
Conversation lifecycle boundaries.

Project navigation and disclosure are separate controls. Selecting the Project
opens its Scene; the chevron only expands or collapses its Session children.
The first viewport is the existing flat Database surface, not a Home dashboard,
overview card collection, or dedicated collaboration rail.

### Conversation beside a Project

`Ask agent` creates an ordinary Project Session and presents that Session's
Conversation as a durable right-panel surface. Closing the surface removes only
Window Session presentation; it does not archive or delete the Session or
Thread. Repeated activation reuses an already-present Conversation surface in
the current Scene. It never searches for an arbitrary threadless Session.

Conversation creation is an explicit cross-authority Adapter: Core owns the
Session and Window Session state owns placement. Creation failure leaves the
Scene unchanged. Placement failure preserves the successfully created Session
and exposes a retry path rather than attempting a false cross-store rollback.

### Resource surfaces do not require Sessions

Database, Page, Canvas, Files, and Browser presentation use Scene and surface
identity. They do not create a Session merely to obtain a host. Features that
actually require Conversation or Thread context carry an explicit Session or
Thread target and may report an unavailable capability when none exists.

Browser transfer and Codex fork payloads carry an explicit source Scene context,
not a Session-view alias. Forking preserves resource identity according to the
existing Browser runtime policy while the destination Window Session owns the
new Scene placement and presentation identities.

### Core schema v99

Fresh Project creation no longer creates a database-starter Session. Core v99
removes the current `database_starter` column and protocol field. During the
v98-to-v99 rebuild, an unthreaded marked starter is deleted; a marked starter
with a Thread link is preserved as an ordinary Session, as are all unmarked
Sessions. Historical v93 migration helpers remain so every supported older
schema can still traverse the reviewed upgrade path.

## Authority boundaries

- Core owns Projects, Sessions, Thread links, and Library resources.
- Window Session owns Scene descriptors, placement, geometry, and history.
- TanStack Query owns server-state caching and exact hydration.
- Codex conversation Modules own live Conversation and Turn state.
- Main Browser and Terminal Modules own guest and PTY runtimes.
- Document and Canvas Modules own collaborative models and editor lifecycles.
- Maitai owns renderer presentation state through one App aggregate.

Scene and surface identity are presentation coordinates. They never grant
Project resource access and never replace a Project, Session, Thread, View,
Page, Canvas, Document, Browser, or Terminal domain identity.

## Consequences

- Project and Session use one Workbench composition with different owner-root
  primary surfaces.
- A fresh Project can contain zero Sessions and still open its Database.
- Users can edit a Database while an ordinary Conversation is visible in the
  existing right panel.
- Per-window layouts stay independent while shared domain mutations continue to
  converge through their existing authorities.
- Layout migration and runtime relocation become explicit, testable policies.
- Removing starter and resource-host Sessions simplifies Core and sidebar
  behavior but requires a coordinated Renderer, Main, protocol, and migration
  change.

This ADR supersedes ADR 0026 and ADR 0032 only where they name a Project Session
as the universal view owner, describe `sessionViewsBySessionId` as the current
layout, or encode Project selection as an empty Session location. Their Window
Session ownership, one-writer, runtime, routing, and panel-controller decisions
remain in force.

## Rejected alternatives

### Protect the special Database View Session

Preventing close, rename, archive, or Thread attachment would make one Session
increasingly unlike every other Session while leaving Project navigation and
resource-host coupling intact.

### Add a Project Home route

A fixed Home child, main page, or collaboration rail would duplicate Project
navigation, Database presentation, panel geometry, and responsive behavior.
The default Project surface already has durable authority: its current default
Database View.

### Keep an implicit Conversation primary

Adding only a Project-specific renderer would leave two Workbench composition
models and force every panel/runtime integration to understand both. An
explicit owner-root surface keeps one composition.

### Infer Project presentation from the first Session

Sidebar summaries are bounded and ordered domain projections. Using their first
row as route authority makes navigation depend on pagination and ordering and
cannot represent a Project with zero Sessions.

### Move Scene state into Core

Scene placement is per-window presentation. Persisting it in Core would make
windows overwrite one another and recreate the authority violation resolved by
ADR 0026.

### Introduce primary-panel swapping now

Conversation, Page, Canvas, Browser, and Terminal runtimes do not yet share one
proven relocation contract. Side-by-side panels and panel maximize meet the
current product need without expanding this change into a general window
manager.
