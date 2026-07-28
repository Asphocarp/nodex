# ADR 0032: Workbench window state and routing

## Status

Accepted

## Context

The current Workbench presents one selected Project Session with Window
Session-local right and bottom panel trees. Core owns Project Session and
Thread data. Main owns the revisioned Window Session snapshot. TanStack Query
owns renderer server-state caching. Browser, Terminal, Codex conversation, and
Block Document Modules own their live runtimes.

The renderer does not currently reflect those authorities cleanly.
`useWorkbenchState`, `App`, and `WorkbenchShell` each own part of the selected
Project, selected Session, route, navigation, and panel presentation:

- `App` and `WorkbenchShell` hold separate active Session values and synchronize
  them through a callback and Effect.
- `useWorkbenchState` and `WorkbenchShell` hold separate active Project values.
- Settings, Library, Automations, and pending-worktree routes are represented by
  independent nullable fields whose callers must clear one another manually.
- durable Window Session tabs and renderer-local preview or auxiliary tabs are
  reconstructed from several independent writable collections.
- the persisted Workbench layout still carries the retired stage rail, sliding
  window, dock, and legacy Pages/Threads/Files tab model.

As a result, the top-level shell has a shallow Interface with many setters,
request ticks, and compatibility fields. State transitions have poor Locality:
understanding one panel close, Session switch, or route change requires
following code through `App`, `useWorkbenchState`, `WorkbenchShell`, runtime
Modules, and persistence.

ADRs 0022, 0026, and 0027 already establish the required authorities:

- one Maitai store and one Workbench App aggregate per renderer;
- Window Session ownership of panel and tab arrangement;
- Window Session lifetime independent from BrowserWindow lifetime.

This ADR deepens those decisions into the Workbench Module structure.

## Decision

### One durable window-state writer

One Maitai App aggregate is the only renderer writer for durable Window Session
layout. A deep `WorkbenchWindowState` Module owns:

- the current `WorkbenchLocation`;
- Window Session-local Database search text keyed by Project;
- `WorkbenchSessionViewSnapshot` values keyed by Project Session ID;
- renderer-local Workbench Back/Forward history;
- snapshot and replacement operations used by the Window Session persistence
  Adapter.

Read-only `scopedDerivedAtom` selectors expose focused slices. Commands perform
multi-field transitions atomically. Callers do not receive raw atom setters.
Separate writable atoms must not mirror fields in the aggregate.

Profile-scoped sidebar and Database view preferences continue to use focused
Maitai persistence Adapters. They may be projected alongside window state for a
view, but they are not copied into Window Session state merely because the
Workbench consumes them.

### One location algebra

The selected Workbench route is a discriminated `WorkbenchLocation`, not a set
of nullable flags. Its variants cover:

- a selected Project or projectless Session;
- a Library target;
- Settings;
- Automations;
- a pending worktree request;
- an empty workspace.

Temporary routes retain an explicit return location. A pending worktree request
is not cold-restored; the Window Session persistence Adapter serializes its
return location instead.

Project context and Session selection are separate coordinates inside a Session
location. Selecting a projectless Session preserves the current Project
context; selecting a Project-owned Session updates both coordinates atomically.
`App` and the shell do not own synchronized copies.

Only the selected route mounts. Route switching synchronously releases the old
Route scope and publishes the new selected Route owner. Hidden retained route
trees are not a compatibility mechanism.

### Explicit Session domain and view values

TanStack Query remains the owner of Project Session server state. A deep
`WorkbenchSessionCatalog` Module owns bounded summary windows, selected detail
hydration, fallback selection, prefetch, and Session lifecycle commands behind
one focused Interface.

A renderer presentation keeps authorities explicit:

    interface WorkbenchSessionPresentation {
      domain: ProjectSession;
      view: WorkbenchSessionViewSnapshot;
    }

The renderer must not spread the two values into an intersection-like writable
Session. Domain mutations go through the typed renderer transport and Query
invalidation. View mutations go through `WorkbenchWindowState`.

### Durable and ephemeral panel placement

`src/shared/workbench-session-view.ts` and
`src/shared/workbench-panel-layout.ts` remain the pure canonical Implementation
for durable panel mutations.

A deep `WorkbenchPanelController` Module adapts that Implementation to the
selected Window Session and owns panel intent:

- open, activate, close, reorder, move, and split;
- panel collapse, full-width mode, and settled resize;
- same-leaf MRU replacement;
- preview replacement and promotion;
- focused-leaf keyboard routing;
- runtime prepare, veto, release, and cleanup ordering.

Durable placement exists only in `WorkbenchSessionViewSnapshot`. Renderer-local
preview and auxiliary placement exists only in one discriminated ephemeral
surface registry owned by the panel controller. A surface identity cannot be
owned by both. Promotion is one atomic ownership transfer.

The registry stores stable identities and presentation descriptors only. It
does not store Query observers, Codex snapshots, Browser handles, Terminal
PTYs or buffers, editor objects, DOM nodes, refs, Promises, or native handles.

The selected surface renderer is a separate view Module. It connects a focused
descriptor to the existing Browser, Terminal, Files, Review, Database, Page,
conversation, and editor runtime Modules. Panel lifecycle does not depend on
the leaf view Implementation.

### Focused sidebar and chrome Modules

A deep `WorkbenchSidebar` Module composes Project and Session catalog
projections, selection intents, pagination, reorder and lifecycle commands,
disclosure, and mounted drag or context-menu interactions. Inline and floating
presentations render one shared sidebar body; they do not duplicate a prop
assembly Interface.

Sidebar collapsed state, width, and disclosure remain profile preferences. A
dedicated preference Adapter owns their persistence; Window Session cold
restore does not overwrite them.

A deep `WorkbenchChromeLayout` Module owns MotionValues, ResizeObserver
measurements, sidebar motion, titlebar reservation, right and bottom panel
geometry, full-width presentation, composer-overlay geometry, and pointer
resize gestures. Pointer samples remain in refs or MotionValues. Settled panel
sizes are persisted through panel commands; settled sidebar size is persisted
through its profile preference Adapter.

The existing selected Route header value and plural header-action registry
remain separate deep Modules.

### External command ingress is an Adapter

Native menu commands, typed Electron notifications, reminders, and deep links
enter through one `WorkbenchCommandIngress` Adapter. It subscribes and
unsubscribes external sources, then invokes location, panel, sidebar, search, or
modal commands.

External events are not converted into request-tick state and forwarded through
the Workbench tree. React Effects synchronize the external source only; user
and command transitions remain in command or reducer Implementations.

### Window Session layout v4

The canonical Window Session layout becomes version 4. It retains only fields
with a live owner:

- a restorable location;
- Database search text keyed by Project;
- Session view snapshots keyed by Project Session ID.

Versions 1 through 3 are decode-only inputs. Migration extracts their active
Project and Session coordinates, Database search text, and Session view map.
Retired stage rail, dock, sliding window, recent Page-stage, global Database
view choice, and legacy Pages/Threads/Files tab fields are discarded.

Sidebar and Database view preferences are seeded from a legacy layout only when
their dedicated profile keys do not exist. A profile key wins over a legacy
layout value, and repeated hydration is idempotent.

Once the renderer cuts over, it writes only version 4. There is no v3/v4 dual
writer.

## Interface discipline

The Workbench is deepened around the preceding Modules. Their Interfaces expose
read projections and user or system intents, not collections of raw setters.
Pure helpers may form internal seams for their owning Module's tests, but they
do not become a generic helper package.

A Module must pass the deletion test. Deleting `WorkbenchPanelController`
should force panel transition and lifecycle complexity back into several
callers. Deleting a view wrapper that merely forwards the same callbacks does
not demonstrate Depth.

One concrete Implementation does not require a hypothetical polymorphic seam.
Plain typed Modules are preferred until a second Adapter or a real testing
variation makes the seam useful.

A catch-all Workbench Context, event bus, service locator, or second
application store is not an acceptable replacement for the current shell. It
would hide the shallow Interface without increasing Leverage or Locality.

## Consequences

- `App` becomes responsible for renderer bootstrap, stable providers, Window
  Session persistence, notification bridges, and root hosts rather than
  Workbench presentation details.
- `WorkbenchShell` becomes a thin composition root for chrome, sidebar, the
  selected route, panels, search, commands, and application modal surfaces.
- Session, panel, sidebar, route, and geometry behavior can be tested through
  the same focused Interfaces used by production callers.
- Window Session layout receives a breaking version migration, while Core
  Project Session data and runtime authorities remain unchanged.
- renderer-local auxiliary tabs still do not survive restart.
- static source splitting improves development transform and Fast Refresh
  Locality but does not by itself promise a smaller production bundle.
- behavior-preserving implementation does not require a changelog entry.
  Deliberate shortcut or user-visible navigation changes do.

## Rejected alternatives

### Extract only leaf views

Moving sidebar and panel bodies removes the immediate Babel size warning but
leaves selection, routing, panel lifecycle, and runtime cleanup in one large
closure. It is useful preparation, not the target architecture.

### Put the existing shell values in one Context

A broad Context would retain the same writable owners and callback inventory
while obscuring dependency flow. It would be a shallow Module.

### Create one store per concern

Independent writable stores for route, Session selection, durable panel layout,
and sidebar would make atomic Window Session transitions and persistence harder
and would contradict ADR 0022.

### Move runtime state into Workbench atoms

Browser, Terminal, conversation, Query, and editor Modules already have deeper
lifecycles. Mirroring their snapshots or handles would create competing
authorities and weaker cleanup guarantees.

### Keep v3 fields as compatibility state

The retired stage model is not part of the current Workbench product. Keeping
its fields and commands would preserve the current `App`-to-shell shallow
Interface indefinitely.
