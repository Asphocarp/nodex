# Frontend Engineering Conventions

This document defines stable, cross-feature construction rules for Nodex's
sandboxed React renderer. It answers three questions:

1. Which frontend owner should hold a piece of state or behavior?
2. Which boundary should a renderer feature use to read or mutate product data?
3. Which shared composition, editor, UI, and Storybook conventions should new
   frontend work follow?

It is an engineering guide and routing layer, not a product specification,
component inventory, visual snapshot, reliability protocol, or regression
ledger. Follow the links below for feature behavior and subsystem contracts.

## Admission rule

A rule belongs here only when all of these are true:

1. It changes how code is constructed across multiple independent frontend
   features.
2. It is expected to survive ordinary product, dependency, and visual changes.
3. It is not already authoritative in a product spec, ADR, reliability document,
   code contract, or test.
4. A type, helper, lint rule, component API, local comment, focused test, or
   Storybook story cannot make the rule sufficiently obvious by itself.

Prefer the narrowest enforceable seam. Route information as follows:

| Information | Source of truth |
| --- | --- |
| User-visible feature behavior, labels, action order, and acceptance rules | [Product specifications](product-specs/index.md) |
| Runtime ownership, dependency direction, and cross-runtime flows | [Architecture](ARCHITECTURE.md) and ADRs |
| Projection delivery, collaborative sync, recovery, and durability | [Reliability](RELIABILITY.md) |
| Detailed renderer state inventory and migration decisions | [Renderer view-state ownership](renderer-view-state-ownership.md) |
| Reusable visual direction for agent-built UI | [General design guidelines](../.agents/skills/general-design-guidelines/SKILL.md) |
| Exact dimensions, classes, timings, layer values, and component states | Shared code, focused tests, and Storybook |
| Test runtime selection and handoff commands | [AGENTS.md](../AGENTS.md) and [Development](development.md) |
| A local dependency or lifecycle caveat | The owning Adapter/component plus its behavioral test |

When a convention changes, replace the old statement. Do not append a historical
layer; git history already preserves it.

## Renderer boundary

The renderer is sandboxed presentation. Durable product operations go through
[`src/renderer/lib/api.ts`](../src/renderer/lib/api.ts), then the typed preload
and Main Adapters. Renderer modules do not open Core sockets, access SQLite,
use arbitrary filesystem paths, or call Electron channels directly.

Keep the dependency direction simple:

```text
feature/component -> renderer facade or feature Module -> typed preload/Main Adapter
pure renderer helper -> transport-neutral shared contract
```

- Put feature workflows and deep feature-owned state under
  `src/renderer/features/`.
- Put reusable surface composition and UI primitives under
  `src/renderer/components/`; common facades belong in `components/ui/`.
- Put pure renderer helpers, query definitions, stores, and transport facades
  under `src/renderer/lib/`.
- Put transport-neutral contracts and validation in `src/shared/`. Shared code
  must not import Electron Main or renderer presentation.
- Keep protocol-facing Codex shapes sourced from
  `packages/codex-app-server-protocol`; derive view models rather than writing a
  parallel raw protocol model.

The environment is the current inventory. Read the relevant directory,
`package.json`, and nearby tests instead of adding dependency versions or file
lists here.

## State ownership

One state has one writable owner. Caches, descriptors, and projections may
mirror an authority for presentation, but they must not become a second place
that decides truth.

| Owner | Use it for |
| --- | --- |
| React component | One mounted interaction: disclosure, hover, menu state, gesture geometry, upload progress, or confirmation UI |
| Maitai App/Thread/Route/Composer atom | Renderer-local presentation shared for that exact semantic scope |
| Maitai persisted atom | Authored drafts or preferences that require restart persistence and have a versioned codec plus synchronization policy |
| TanStack Query | Bounded, low-frequency Main/Core read models and mutation cache coordination |
| Focused feature store or runtime Module | High-frequency, optimistic, streaming, or lifecycle-bearing state such as conversations, Board projections, Browser guests, and Terminals |
| Document or Canvas session | Collaborative content, sync, presence, and mounted surface lifecycle |
| Window Session aggregate | Owner-scoped Scenes, surface descriptors, panel trees, navigation, and settled layout state |

The exhaustive inventory lives in
[Renderer view-state ownership](renderer-view-state-ownership.md). Apply these
rules when choosing among the owners:

- Keep disposable interaction state component-local. Promote it only when its
  semantic lifetime outlives that mounted subtree or another independent
  surface must consume it.
- Store intent when the rendered value can be derived from current inputs. Do
  not synchronize derivable highlights, selections, filtered options, or
  presentation mirrors through Effects.
- Keep live objects with their runtime Module. Atoms and Window Session
  snapshots may retain stable identities and serializable descriptors, not DOM
  nodes, refs, editors, Y.Docs, Promises, Query observers, Browser guests, PTYs,
  or native handles.
- Keep continuous pointer, resize, scroll, and observer samples outside broad
  React owners. Project only guarded semantic changes such as a breakpoint,
  settled size, or selected target into application state.
- Treat component lifetime as presentation lifetime. Browser guests, Terminals,
  conversation streams, Document sessions, and other resources follow their
  explicit owner lifecycle rather than assuming React unmount is a durable
  close operation.

An ordinary dialog stays with its mounted interaction. A modal that must
survive its trigger row or route subtree uses the renderer-window application
modal registry and root host. The registry stores component/props presentation
descriptors rather than domain or runtime authority; the feature still owns the
action and product semantics.

## Data, projections, and mutations

- Query and mutation functions call the renderer API facade. Centralize query
  keys, query options, and IPC subscriptions in `src/renderer/lib/` so features
  do not invent transport or invalidation paths in components.
- Treat Main/Core reads as bounded projections. Preserve pagination and group
  scope; do not hydrate complete Documents or unbounded collections to render a
  list, picker, sidebar, Board, or search result.
- A successful durable mutation response is authoritative. Admit its committed
  effect through the shared projection path immediately; the later event stream
  is recovery and fanout, not a second completion condition. Exact sequencing
  and repair rules live in [Reliability](RELIABILITY.md).
- An acknowledged optimistic transform may remain composed over canonical base
  until the affected projection actually materializes it. Promise fulfillment
  or an unrelated cursor floor alone is not proof that a bounded view contains
  the result.
- Update a narrow Query cache when a mutation returns its complete next value;
  otherwise invalidate the exact affected projection. Preserve unaffected
  sibling/detail caches and let each projection owner decide canonical repair.
- Use typed mutation outcomes for expected domain branches such as conflict,
  missing identity, or validation failure. Reserve thrown exceptions for
  transport and programming failures.
- Validate external data at transport, persistence, and protocol boundaries.
  Keep normalized renderer state strongly typed rather than repeatedly parsing
  it inside leaf components.
- Search and picker acceptance must be query-fresh at the action seam. Rendering
  a stale batch while a new request loads is acceptable; executing an item that
  is no longer valid is not. Never implement product search by scraping rendered
  DOM text.

## Projection and component composition

Start from semantics, not JSX.

- Derive renderer-facing models in pure projectors, normalizers, bucketizers,
  or controllers before rendering. These models own ordering, grouping,
  visibility, stable identity, and action eligibility.
- Keep leaf renderers declarative. They consume already-derived labels, states,
  lane membership, and actions instead of rescanning protocol or domain data.
- Give each semantic role one canonical projection and one render lane. Avoid
  rendering the same request, final content, diff, activity, or pending action
  through several condition trees.
- Use discriminated unions for closed surface, request, activity, and policy
  families. Make unsupported variants explicit instead of falling through to a
  generic UI that accidentally acquires new semantics.
- Keep genuinely distinct transcript or system concepts in dedicated leaf
  components. Reuse shared chrome around them without erasing their domain
  identity.
- Use stable semantic keys. Presentation state such as “currently trailing,”
  “selected,” or “action target” may join the key only when that state change
  intentionally resets the mounted interaction.
- Keep high-frequency updates behind focused subscriptions and selectors. A
  broad shell, Context provider, or route owner should not rerender for every
  stream delta, pointer sample, terminal chunk, or editor transaction.

Forms with structural validation, coercion, or multi-field constraints use
TanStack Form with a colocated Zod schema. A simple single-field interaction
uses local state and a submit-time guard.

## Commands, overlays, and gestures

- Register application keyboard actions once at the active window in bubble
  phase. Editors, inputs, dialogs, menus, terminals, and other local scopes get
  first ownership of the event.
- Resolve the active surface capability before executing an app action. Call
  `preventDefault()` only after the command accepts the event, and respect
  composition, repeat, editable ownership, and local keyboard scopes.
- A contextual surface registers one narrow capability/execution port for its
  mounted lifetime and updates the reactive target behind that port. It does not
  install a second global shortcut listener.
- Treat imperative focus as a one-shot interaction intent. Roving active or
  selected state may determine the next tab stop, but data/projection refreshes
  must not replay an already handled focus request. Async focus that waits for
  mounting, virtualization, or a portal target carries request identity and is
  consumed only after the target receives focus.
- Model drag and drop with one semantic target policy and one owning controller
  per gesture family. Nested providers or parallel native/synthetic paths must
  not split registration and dispatch authority.
- Portalled interactive surfaces keep their normal body portal unless a real
  local clipping or ownership boundary requires otherwise. Fix pointer/focus
  ownership at the responsible DOM layer; do not mask it with arbitrary z-index
  escalation or full-surface pointer overlays.
- Use the named layer constants in `src/renderer/lib/app-shell-layers.ts` and
  shared portal primitives. Exact layer values are executable code, not prose.

## Editors and collaborative surfaces

- A mounted primary Page/Card/Canvas surface renders from its owned Document
  session. Metadata summaries and read-model caches never seed or overwrite the
  collaborative title, body, or scene authority.
- Keep each editor source explicit and discriminated. Legacy serialized content,
  collaborative Documents, templates, and read-only projections have different
  hydration, replacement, and save rules.
- Keep schemas, extensions, parsing, and serialization composed in focused
  editor modules. Preserve NFM round trips when changing any parser, serializer,
  clipboard, mention, or adapter path.
- Treat ProseMirror/Tiptap view objects as mounted APIs. Attach browser-managed
  editable DOM behavior through the owning editor lifecycle, and keep callback
  refs stable when they write registration state.
- Separate content authority from surface-local interaction. Editors that share
  one Document may still own independent selection, undo, caret, camera, tool,
  and presence contributions.
- Flush a mounted Document through its typed mutation barrier before a
  structural command consumes collaborative shape. The durability contract is
  defined in [Reliability](RELIABILITY.md), not reconstructed in renderer code.
- Large text or diff sources use bounded or virtualized viewers. CSS clipping
  and scroll containers do not reduce mounted DOM, parsing, or accessibility
  work.

Feature-specific editor behavior belongs in the focused specifications listed
in [Product specifications](product-specs/index.md). Rich-editor performance
work follows [Card Stage rich-editor performance](card-stage-rich-editor-performance.md).

## Shared UI system

- Prefer Tailwind utilities and existing semantic token families. Keep global
  CSS for theme sources, reset/base behavior, third-party integration, and
  selectors that utilities cannot express.
- Consume shared buttons, inputs, dialogs, dropdowns, popovers, tooltips,
  toasts, floating surfaces, settings rows, and related controls through
  `src/renderer/components/ui/`. Extend the facade or add a shared preset when a
  shape recurs; do not grow feature-local clones.
- Keep app-owned icons in the shared icon modules. Choose icons by product
  meaning and normalize geometry at that boundary instead of scattering inline
  SVG paths or compensating classes through features.
- Let shared primitives own ordinary radius, padding, focus treatment,
  collision behavior, motion, and overlay chrome. A feature should provide
  content and semantic variants, not a second visual system.
- Keep hidden action chrome keyboard-reachable only when its controls are
  revealed by hover, focus-within, open state, or another explicit accessible
  state. Visual opacity alone must not leave concealed controls in sequential
  focus order.
- Honor reduced motion at the shared motion boundary. Animate semantic presence,
  disclosure, and geometry continuity; avoid animation that creates a second
  state owner or delays authoritative text updates.
- Treat rendered CSS and browser behavior as the evidence. Put reusable numeric
  or state rules in helpers with boundary tests, and preserve visual contracts
  with focused stories instead of long class-string assertions.

For new or substantially redesigned surfaces, also follow the
[general design guidelines](../.agents/skills/general-design-guidelines/SKILL.md).

## Feature routing

Load the narrow contract only for the branch being changed:

| Feature branch | Read first |
| --- | --- |
| Workbench Scenes, sidebar, panels, tabs, navigation, and shell presentation | [Workbench shell](product-specs/workbench-shell.md) and the Scene ADRs |
| Database Views, Page creation, Page Stage, and Properties | [Database, Pages, and Views](product-specs/database-pages-and-views-behavior.md) |
| Canvas inline and Stage presentation | [Canvas](product-specs/canvas-behavior.md) |
| Chat lifecycle, workspaces, worktrees, forks, and runtime integrations | [Codex workspace](product-specs/codex-workspace-behavior.md) |
| Renderer scope and persistence ownership | [Renderer view-state ownership](renderer-view-state-ownership.md) |
| Codex transcript, requests, tools, composer, and turn/activity projection | [Codex transcript behavior](product-specs/codex-thread-transcript-behavior.md) |
| Codex owner/follower publication and recovery | [Owner/follower streaming](product-specs/codex-thread-owner-follower-streaming.md) |
| Thread Summary sections, rows, artifacts, Git actions, Browser, and PiP | [Thread Summary panel](product-specs/thread-summary-panel-behavior.md) |
| Scheduled task/template route and editor | [Scheduled route](product-specs/scheduled-route-behavior.md) |
| Settings navigation, catalog, search, page composition, and deep links | [Settings route](product-specs/settings-route-behavior.md) |
| Review and Git diff presentation | [Review right panel](product-specs/review-right-panel-behavior.md) |
| Command palette ranking and execution | [Command palette](product-specs/command-palette-behavior.md) |
| Board and cross-surface drag behavior | [Board drag and drop](product-specs/board-drag-and-drop-behavior.md) |
| NFM editor interactions | The matching `nfm-*` document in [Product specifications](product-specs/index.md) |

These documents own feature behavior. Keep this file limited to conventions
that remain useful when those features change.

## Storybook and frontend tests

Testing commands, runtime selection, and handoff gates are authoritative in
[AGENTS.md](../AGENTS.md) and [Development](development.md). Frontend work adds
evidence at the seam that owns the behavior:

- User-visible UI changes update or add focused Storybook coverage. Stories use
  production projectors and components with injected runtime boundaries rather
  than parallel fake view models or live Electron fallbacks.
- Keep stories canvas-first. Use variants, args, and focused harnesses; render
  menu-driven states open by default and split unrelated feature families into
  separate stories.
- Assert visible structure, accessibility, and behavior. Raw class checks,
  serialized markup, test IDs, and source inspection are fallback tools only
  when those representations are the real contract.
- Keep pure renderer logic in ordinary `.test.ts` files so it runs in Node.
  Name non-TSX tests that require browser globals `.jsdom.test.ts`; ordinary
  `.test.tsx` remains the React/jsdom path, while pure TSX uses
  `.node.test.tsx` explicitly.
- Renderer DOM tests and their testkits import the owning
  `shared/block-documents/*` module directly. Importing its aggregate entry
  point pulls unrelated schemas and editors into every isolated test file.

Before adding prose here, confirm that every affected feature branch needs the
same convention and that the nearest executable seam cannot carry it. That is
the completion condition for keeping this document compact.
