# Move durable content into Library-owned Pages and Data Sources

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must remain current
while implementation proceeds. Maintain it in accordance with `docs/PLANS.md`
from the repository root. A contributor with only this file and the working
tree must be able to resume the migration without conversation history.

## Purpose / Big Picture

After this migration, a user's durable Pages and Databases belong to the local
Profile's Library rather than to an execution Project. A Project can be
inactive, archived, replaced, or deleted without deleting content. Each Project
binds one Database for its ordinary work and may receive explicit recursive
read or read-write grants to other Pages or Databases.

A Database becomes a placeable Container. A Data Source inside it owns one
schema and the Pages governed by that schema. A View belongs to a Database and
targets one Data Source. The initial product still presents one default Source
per Database, so the common Board/List/Calendar workflow remains direct while
the authority model no longer conflates placement, schema, data, and
presentation.

The user-visible document object is called Page everywhere. The persisted
`card` Block type, Card contracts, Card routes, Card events, and Card stores are
removed. “Card” remains valid only for a visual representation such as a
Kanban card.

The migration is observable through behavior and tests: creating the first
Project creates the Profile Library, a bound Database, deterministic initial
Data Source, and default View atomically; a Page can be top-level, nested under
another Page, or owned by a Data Source; archiving a Project leaves its content
queryable in Library; a second Project cannot read foreign content until a
resource grant is committed; and a reference never expands authority.

## Progress

- [x] (2026-07-16 17:00+08:00) Audited current domain docs, ADR conflicts,
  SQLite tables, Database Kernel contracts, Project creation, and affected
  product surfaces; verified the Data Source and hierarchical authorization
  design against primary external documentation.
- [x] (2026-07-16 17:15+08:00) Accepted ADR 0017 and marked ADR 0001, ADR 0003,
  ADR 0005 (exclusive Card parent), and ADR 0010 as superseded where their
  ownership and naming decisions conflict.
- [x] (2026-07-16 17:20+08:00) Created this self-contained migration ExecPlan.
- [x] (2026-07-16 17:45+08:00) Milestone 1: rewrote `CONTEXT.md` and
  `ARCHITECTURE.md` around Library/Page/Data Source authority, recorded the
  superseding ADR and complete migration plan, and validated the Markdown diff.
- [x] (2026-07-16 19:40+08:00) Established schema v68's migration foundation:
  one Profile-owned Library, Project lifecycle/binding coordinates,
  Database Containers, deterministic initial Data Sources, Source-owned
  properties/memberships/values, View source targets, Page-named View
  positions, and recursive resource-grant storage. Added an explicitly
  temporary legacy-write projection and proved fresh creation, migration
  idempotency, projection parity, foreign keys, typecheck, and lint.
- [x] (2026-07-16 19:50+08:00) Milestone 2: schema v69 added canonical Page
  records with exclusive `library | page | data_source` parent coordinates and
  Library top-level placements. Project deletion now archives only the
  execution context, Project lifecycle gates new work, and recursive resource
  grants are evaluated over ownership closures with separate content and
  structural capabilities.
- [x] Milestone 2: add the Profile, Library, Project binding/lifecycle, resource
  grant, Page parent, Database Container, Data Source, View, and migration
  schema; prove deterministic migration and integrity.
- [x] (2026-07-16 21:20+08:00) Added schema v70 immutable Database Module
  receipts and the canonical `read`/`apply` implementation. Reads resolve
  Project-default, Container, Source, View, and query targets through recursive
  authorization; applies own Source properties/values, Page transfers, Views,
  Page positions, revision guards, exact retries, projection refresh, and
  change receipts. The FIFO worker and writer now carry the new contract and
  publish one Database invalidation per first commit.
- [x] (2026-07-16 21:45+08:00) Added schema v71 and cut persisted object
  identity from Block type `card` / Document schema `nodex.card` to `page` /
  `nodex.page`. The migration rewrites embedded trigger SQL before row retyping,
  and runtime document codecs now use Page Document names. Visual Kanban card
  components remain intentionally named Card.
- [x] (2026-07-16 22:10+08:00) Published the canonical Database Module over
  worker, IPC, and HTTP transports and moved Page Detail reads to Library Page
  identity with effective Project resource authorization.
- [x] (2026-07-16 22:25+08:00) Migrated Page lifecycle and Page search to
  Library discovery plus recursive grant evaluation. Schema v72 now permits
  Project-owned mutation receipts to target Pages in the same Library without
  treating the actor Project as content ownership.
- [x] (2026-07-16 22:40+08:00) Migrated scheduler, recurrence occurrences,
  reminders, IPC/HTTP commands, and Calendar projections to Page contracts.
  Schema v73 separates reminder-snooze Project context from Page ownership;
  grant tests prove read discovery, read-write schedule updates, and retained
  structural `create_child` authority for sibling-producing operations.
- [x] (2026-07-17 03:30+08:00) Milestone 3: published Page-named lifecycle,
  read, history, search, schedule, occurrence, target, and Document authority
  contracts. Canonical Page Block/NFM/editor literals are `page` and
  `pageRef`; `cardRef` is a decode-only migration input.
- [x] (2026-07-17 03:45+08:00) Milestone 4: the Database Module is the public
  schema/value/membership/View boundary. Properties, memberships, values, and
  queries carry Data Source identity; View positions carry Page identity; all
  reads/applies evaluate current Project resource authorization.
- [x] (2026-07-17 05:55+08:00) Milestone 5: migrated Page Detail, scheduler,
  search, Agent tools, realtime events, HTTP/IPC/preload, CLI, Page history,
  DnD, and BlockTransfer. Public transfers now carry logical
  `library | page | data_source` parents and the writer compiles them to exact
  storage coordinates after validating the target View/Data Source.
- [x] (2026-07-17 04:50+08:00) Milestone 6: migrated Page Stage, Page outliner,
  workbench tabs/navigation, renderer state, drag data, and the single-Source
  default UI. Card remains only in visual Kanban/request-card vocabulary and
  shipped-schema migration code.
- [x] (2026-07-17 06:35+08:00) Milestone 7: completed the final schema and
  terminology audit; passed focused Node, main-process, renderer, CLI,
  Database, transfer, lifecycle, and command-keybinding suites; passed all
  5,422 standard tests, typecheck, lint, and the production build; and prepared
  the completed cutover for one closing commit.

## Surprises & Discoveries

- Observation: the repository already has much of the relational behavior
  needed by Data Source, but `databaseBlockId` is used simultaneously for
  Container placement, schema, memberships, View host, Project primary
  selection, and transport scope.
  Evidence: `database_capabilities`, `database_properties`,
  `database_memberships`, `database_property_values`, and `database_views` in
  `src/main/local-store/schema.ts` all carry `database_block_id` and
  `project_id`; `src/shared/database-kernel.ts` requires `databaseBlockId` for
  schema and value operations.

- Observation: current exclusive parenting is strong but uses storage-shaped
  parent names. `space` means Project, `document` means the owning Card's body,
  and `database` means schema plus Container. The new model keeps exclusivity
  while replacing those variants with user-domain parents.
  Evidence: `blocks.location_kind` currently accepts `space | document |
  database` and stores `containing_document_id` or `containing_database_id`.

- Observation: Card terminology reaches hundreds of source and test files, so
  a compatibility alias would be easy but would defeat the requested one-noun
  model. The rename must be mechanical where possible and semantic at storage,
  transport, and UI seams.
  Evidence: initial repository search found 666 source, package, test, or
  product-spec files containing Card/card identifiers or literals.

- Observation: schedule recurrence, reminders, and run-target state are
  currently intrinsic Block properties even when due/scheduled Database fields
  appear in a View. The migration must preserve the existing ADR distinction:
  Page behavior remains Page-owned; Source-defined due/status values remain
  Data Source-owned.

- Observation: Notion's current public model independently identifies Database
  Container and Data Source, creates Pages with a Data Source parent, and lets
  Views identify both host Database and target Source. This validates the
  identity split but does not decide Nodex authorization or Project semantics.

- Observation: hierarchical authorization systems model direct grants and
  object-parent relationships separately. Nodex must therefore define exactly
  which ownership edges are traversed and explicitly exclude references,
  relations, mentions, and linked Views from permission closure.

- Observation: reminder snoozes encoded `project_id` as both the requesting
  execution context and the scheduled Card owner, so a legitimately granted
  Project could read an occurrence but could not persist a snooze for it.
  Evidence: the v72 `reminder_snoozes` composite foreign key and trigger both
  required `(card_id, project_id)` to match `blocks(id, project_id)`. Schema v73
  now references Project and Page independently, guards same-Library identity,
  and leaves effective grant evaluation at the application boundary.

## Decision Log

- Decision: implement the target as one cutover with verifiable milestones,
  not a permanent compatibility layer.
  Rationale: the product has no real user data, repository policy prioritizes
  long-term model correctness, and parallel Card/Project authority would leave
  every caller with two coordinate systems.
  Date/Author: 2026-07-16 / Codex and maintainer.

- Decision: one persisted local Profile owns exactly one Library.
  Rationale: the process and database are already profile-scoped; an explicit
  relation gives backup validation and content ownership one stable coordinate
  without pretending Project owns the profile.
  Date/Author: 2026-07-16 / Codex and maintainer.

- Decision: Page replaces Card in the domain and persisted Block type; Card is
  permitted only as presentation vocabulary such as `KanbanCard`.
  Rationale: Page is the long-lived object users open, nest, reference, and
  grant. Document is its storage/sync owner, not a competing product noun.
  Date/Author: 2026-07-16 / Codex and maintainer.

- Decision: active Page parents are `library | page | data_source`.
  Rationale: these are the ownership concepts users understand. Document is an
  implementation coordinate and Database Container is not the schema owner.
  Date/Author: 2026-07-16 / Codex and maintainer.

- Decision: Page ID is the active row identity; membership is retained only as
  typed historical placement/value evidence.
  Rationale: one exclusive Data Source parent removes active row ambiguity while
  dormant records preserve reversible moves without making membership a public
  identity.
  Date/Author: 2026-07-16 / Codex and maintainer.

- Decision: dormant Source values remain until explicit cleanup or retention
  collection; moving between Sources performs no automatic value mapping.
  Rationale: retaining values avoids hidden data loss, while implicit mapping
  invents semantics across unrelated schemas. A future explicit map operation
  can be designed from real workflows.
  Date/Author: 2026-07-16 / Codex.

- Decision: Data Source is relational and never a Block in this architecture.
  Rationale: it has no independent Library placement, Document, or Block
  behavior. Making it a Block would expose a shallow noun without leverage.
  Date/Author: 2026-07-16 / Codex and maintainer.

- Decision: Database owns one default View, not a second default Source field.
  Rationale: the default View already targets a Source; duplicating both creates
  an avoidable consistency problem.
  Date/Author: 2026-07-16 / Codex.

- Decision: View stores both host `databaseId` and target `dataSourceId`, but
  the first release requires the target Source to be owned by the same
  Database.
  Rationale: this makes the identity model future-ready without introducing
  linked-View permission and UI complexity before a validated need.
  Date/Author: 2026-07-16 / Codex and maintainer.

- Decision: Project lifecycle has active, inactive, and archived states, and a
  Database has at most one active Project.
  Rationale: inactive is a reversible execution stop, while archived is a
  historical state. Both leave Library content intact.
  Date/Author: 2026-07-16 / Codex.

- Decision: reactivated Projects regain current implicit access, but every
  operation recomputes lifecycle and revisions.
  Rationale: access follows current Project state; stale Session or approval
  tokens must not carry authority across lifecycle changes.
  Date/Author: 2026-07-16 / Codex.

- Decision: recursive grants traverse ownership only. A Page-only grant exposes
  a read-only schema slice sufficient to interpret that Page's current values
  but not siblings or schema management.
  Rationale: callers need typed values without gaining collection-wide access;
  presentation and reference edges must never escalate authority.
  Date/Author: 2026-07-16 / Codex and maintainer.

- Decision: the Database Module exposes `read` and `apply` as its public
  Interface and uses real SQLite in tests.
  Rationale: the Module gains depth by hiding target resolution,
  authorization, validation, transaction ordering, ranking, receipts, and
  events. Table-shaped repositories and Map fakes would leak those invariants.
  Date/Author: 2026-07-16 / Codex.

## Outcomes & Retrospective

The accepted architecture now exists through schema v78. Profile/Library
ownership, deterministic initial Data Sources, exclusive Page parents, Project
bindings/lifecycle, recursive grants, Page occurrence authorization, the deep
Database Module, Page Detail/search/history, Page-first Agent tools, realtime
events, CLI, BlockTransfer/DnD, and the single-Source renderer all use the
canonical identities. Public moves carry `library | page | data_source`; the
writer alone resolves physical storage coordinates. Canonical editor/NFM
references are `pageRef`; old `cardRef` forms remain only as
decode/import inputs. All planned cutover milestones are complete. Adding a
second Source in the UI, linked Views, Data Source moves, and Relations remain
deliberate future product work rather than compatibility debt or unfinished
parts of this migration.

Post-cutover startup validation found two migration-order gaps in retained
evidence. The v70→v71 noun cutover now renames retained Document-version schema
keys while its immutable UPDATE guard is transactionally suspended, and v78
validates and republishes normalized Canvas aggregate hashes/checkpoint JSON
after the Page-reference projection rename. Neither repair weakens runtime
immutability or accepts an unknown integrity hash.

## Context and Orientation

Nodex is an Electron app. The main process owns a SQLite database, an embedded
HTTP server, IPC handlers, an asynchronous Block mutation writer, and the Codex
app-server runtime. The renderer reaches main through the transport-agnostic
adapter in `src/renderer/lib/api.ts`. The CLI reaches the same host behavior
through loopback HTTP.

`src/main/local-store/schema.ts` creates the shipped schema and applies release
migrations. The schema at the start of this plan was v67. Its content
foundation stores `project_id` on Blocks, Documents, top-level placements,
Database records, search and schedule projections, mutations, assets, and
history. `ensureBlockFoundationForProject` creates one primary Database and
View per Project.

`src/shared/database-module.ts` contains the canonical Database read/apply
algebra. `src/main/local-store/database-module.ts` resolves Project binding and
recursive grants, validates Data Source values and Page positions, writes
idempotent receipts, and publishes resource-addressed change evidence. The
older Database Kernel remains only behind compatibility consumers that have
not yet moved to the Module.

`src/shared/types.ts` now exposes Page/Board/Project read models.
`src/shared/page-detail.ts` and `src/main/local-store/page-detail.ts` implement
the membership-independent Page Detail read. Scheduling is split across
`src/main/local-store/scheduled-page-store.ts`, recurrence/reminder Modules,
and renderer Calendar surfaces. Search uses `block_search_units` plus
Page-named projections. Agent tools live in `src/shared/nodex-agent-tools/` and
`src/main/agent-tools/`. Database Board drag compiles through
`src/shared/database-page-drag.ts` from one Project-default Module query. The
renderer commits `set_value(s)` and `position_page(s)` in one apply;
cross-parent gestures continue through the Block transfer command.

The canonical target terms are:

- Profile: the local app profile whose filesystem and SQLite store are already
  process-scoped.
- Library: the one durable content ownership scope of that Profile.
- Block: the only persistent application content identity.
- Page: a document-bearing Block with a collaborative title/body Document.
- Database: a placeable Block and Container for Data Sources and Views.
- Data Source: a relational schema plus its Page rows and property values.
- View: one saved presentation belonging to a Database and targeting one Data
  Source.
- Project: an execution context bound to one Database.
- Resource grant: a durable capability from a Project to a Page or Database
  root, recursively following ownership edges only.
- Document: an independently synchronized content owner for a
  document-bearing Block. It is an implementation identity, not a Page parent
  noun.

The accepted decision is in
`docs/adr/0017-library-pages-data-sources-and-project-resource-grants.md`.
Earlier ADRs remain useful for Block identity, Yjs ownership, relocation,
references, history, and reliability, but ADR 0017 supersedes their
Project-as-Space, Card alias, Database-as-schema, and storage-shaped parent
decisions.

## Plan of Work

### Milestone 1: make the domain documentation authoritative

Rewrite `CONTEXT.md` so Library, Page, Data Source, Database Container, View,
Project binding, and grants are the canonical nouns and invariants. Remove
Space and Card as domain terms, explain that nested Page shells still live in
the parent's Document, and preserve the existing exact Document, projection,
history, mutation, relocation, backup, and reference rules under Page names.

Update `ARCHITECTURE.md` so the codemap describes the target deep Database
Module and Library content authority. Name execution-only Project state
separately from Library content. Record the access evaluation flow and the
single-Source renderer behavior. Validate the Markdown diff and commit the ADR,
plan, CONTEXT, and architecture checkpoint before production code.

### Milestone 2: establish schema authority and deterministic migration

Add a new release schema version in `src/main/local-store/schema.ts`. Create
`profiles` and `libraries` with one Library per Profile. Add Library ownership
to durable content tables and remove Project as their authoritative foreign
key. Execution tables keep Project IDs. Every existing store receives one
Profile and Library; all existing content is adopted into that Library.

Rebuild the Blocks parent coordinate as an explicit algebra. The relational
row must distinguish `library`, `page`, and `data_source`; a Page parent stores
the parent Page ID and Data Source parent stores the Source ID. The Document
index remains the materialized proof that a nested Page shell is present in the
parent Page's Document, but callers no longer expose Document as the parent.

Retain every existing Database Block ID. Convert `database_capabilities` into
`database_containers` or an equivalently named definitive table. Create a
deterministic initial Data Source ID from each Database Block ID. Move property
definitions, memberships, and values to Data Source coordinates. Add
`data_source_id` to every View and change positions to `(view_id, page_id)`.
Backfill each View with its Database's initial Source. Preserve dormant
membership/value history and enforce one active membership per Page plus one
historical membership per Page/Source pair.

Add stable Project→Database binding and lifecycle columns or tables. Migrate
the previous primary Database into the binding. Enforce at most one active
Project per Database. Add Project resource grants with root kind, access,
recursive flag, revision, and lifecycle. Seed no unnecessary explicit grant:
the primary Database grant is derived from the active binding.

Write focused migration tests in the nearest main/store suites. Tests must
exercise fresh creation, a representative v67 store, stable Database/Page IDs,
deterministic Source IDs, property/value/View preservation, top-level and
nested parent conversion, Project archive content survival, malformed state
failure, and `PRAGMA foreign_key_check`/integrity validation.

### Milestone 3: rename and rescope content contracts

Change persisted Block literals from `card` to `page`, owned Document schema
keys where they are product-domain identifiers, and semantic NFM/BlockNote
shells from `card`/`cardRef` to `page`/`pageRef`. Do not rename third-party
protocol fields or CSS concepts that genuinely mean a visual card.

Rename domain files, types, functions, routes, IPC channels, CLI commands,
events, test fixtures, and copy from Card to Page. Use filesystem renames for
history where practical and mechanical identifier rewrites only after
classifying semantic exceptions such as request cards, UI cards, and credit
cards. Remove aliases after all call sites migrate.

Change Block, Document, asset, search, history, mutation, and owned-Document
Interfaces to carry `libraryId` as content scope. A Project route resolves to a
trusted Library and effective Project access before it calls content Modules;
callers cannot supply a Library belonging to another Profile. Keep Project IDs
only where the data is execution/session/audit evidence rather than content
ownership.

Replace Card Project transfer with Library-preserving Page movement. Moving
between Projects is no longer content relocation; granting access or moving a
Project's Database binding are separate commands. Page move/copy remains one
versioned ownership operation over Library/Page/Data Source parents.

### Milestone 4: deepen the Database Module and authorization

Define the new contracts in a shared `database-module.ts` or a coherent rename
of `database-kernel.ts`. The public Interface consists of `read` and `apply`.
Reads explicitly target project default, Database, Data Source, or View.
Intents explicitly identify the Source for schema/value/Page operations and
both Database and Source for View creation. Database creation atomically
creates Container, deterministic initial Source, initial View, and default View
selection.

Implement the SQLite Adapter in main. Keep one bounded, versioned,
idempotent command with stable typed errors, exact retries, revision
preconditions, canonical payload hashing, immutable receipts, one SQLite
transaction, and post-commit notifications. Position operations address Page
IDs. Public calls cannot mutate dormant membership or infer a Source.

Create an authorization Module whose Interface accepts trusted Profile,
Library, Project, optional Session/Thread evidence, resource, and action. It
resolves active Project binding plus grants and returns a decision with the
revisions used. Database closure traverses owned Sources/Views/Pages and nested
Page ownership. Page closure traverses nested Pages and physically nested
Databases. Reference, relation, mention, backlink, and linked-View edges are
never traversed. Page-only Data Source access yields a schema slice, not a
Source-wide query capability.

Bind trusted access in HTTP, IPC, CLI, and Agent-tool adapters. Do not accept
caller-authored actor, Profile, Library, Project, or grant evidence. Include
Project lifecycle, binding revision, grant revision, access revision, and store
epoch in freshness evaluation. Keep Codex approval policy independent.

Test through the Database Module Interface using temporary real SQLite. Cover
implicit primary access, foreign denial, read and read-write grants, recursive
ownership, non-traversal of references, Page schema slice, lifecycle
invalidation, exact retries, stale revision conflicts, and atomic rollback.

### Milestone 5: migrate all consumers

Replace Card Detail with Page Detail. It always reads Page/Document authority
and has either no Data Source context or the exact Source/property context
implied by its exclusive parent. Opening never creates membership. Page Detail
is keyed by Library and Page; Project is access context, not identity.

Update scheduler coordinates and terminology. Intrinsic recurrence/reminder/run
configuration remains Page-owned. Source-defined status, due, and scheduled
values read through the Page's single active Source, eliminating multi-Source
ambiguity. Search results identify Library/Page and carry Data Source evidence
only when a matching property contributes. Search must enforce Project grants
before returning content.

Migrate Agent read/edit/query tools and authorization previews to explicit
Page/Database/Data Source targets. Keep the task-pinned versioning and semantic
precondition decisions in ADR 0015/0016. Update tool budgets and guides where
renamed fields affect the common path.

Migrate realtime events to Library/Page/Source coordinates and filter delivery
by Project effective scope. Project Board invalidation becomes View/Source
invalidation plus access-aware adapters. Move DnD compilation to Page IDs and
explicit target Data Sources. Update history, retention, backup validation,
asset ownership, references, Canvas Page references, deep links, HTTP, IPC,
preload, CLI, and tests together with each Interface.

### Milestone 6: deliver the single-Source renderer

Keep the default workbench experience simple: the Project opens its bound
Database's default View. Board/List/Calendar render the View's one explicit
Source, while the UI does not show a Source selector or Add Data Source action.
Database settings edit the initial Source schema through an explicit Source ID.

Rename Card Stage, Card Detail stores, dialogs, breadcrumbs, search results,
commands, accessibility labels, and user copy to Page. Preserve “card” only in
visual implementation names where it genuinely describes a Kanban card or
generic request-card component. Update Storybook stories for all changed
user-visible surfaces and rely on maintainer manual review for visual parity as
required by repository policy.

Do not implement Add Data Source, linked Views, Data Source move, or Relations.
The production schema and contracts must make those future changes additive,
but no speculative UI or permission path is shipped.

### Milestone 7: remove residue and validate

Search production source, schemas, docs, routes, and literals for obsolete
Project-as-content, Space, Card-domain, `database_block_id` schema-owner, View
without Source, and `document` parent assumptions. Classify every remaining
match as legacy migration input, third-party protocol, generic visual card, or
bug. Remove compatibility aliases and fallback Source guessing.

Run focused suites while iterating. At handoff run `pnpm run typecheck`,
`pnpm run lint`, all relevant main/store, renderer, shared, integration, and E2E
tests, and `pnpm test` because the refactor crosses every runtime. Run
`pnpm run build` because entrypoint transports, preload, and bundling-facing
imports change. If the full gate is stable and time permits, run
`pnpm test:all`; otherwise record why focused plus standard validation is
stronger evidence for this migration.

Update the product specification, CHANGELOG `Unreleased` section, CONTEXT,
ARCHITECTURE, reliability/security docs if their contracts changed, and this
plan's outcomes. Commit an atomic final checkpoint with a conventional subject
and explanatory body.

## Concrete Steps

Work from `/Users/asc/repo/nodex2`.

Inspect status before every milestone:

    git status --short --branch

Run focused shared tests with:

    pnpm exec vitest run --config vitest.node.config.ts <test-file>

Run focused main/store tests with:

    pnpm test:main <test-file>

Run focused renderer tests with:

    pnpm exec vitest run --config vitest.renderer.config.ts <test-file>

Run final static checks with:

    pnpm run typecheck
    pnpm run lint

Run broad behavior/build checks with:

    pnpm test
    pnpm run build

Never run main or integration Vitest configs directly under host Node because
native addons use Electron's ABI. Use repository scripts.

After each stable milestone, inspect the diff, update this living plan, and
commit with a conventional subject plus body. Do not combine unrelated user
changes. Do not reset or overwrite a dirty worktree.

## Validation and Acceptance

The schema migration is accepted when a fresh store and a representative v67
store both open at the new schema version, `PRAGMA integrity_check` returns
`ok`, `PRAGMA foreign_key_check` is empty, Database and Page IDs are stable,
every Database has one deterministic initial Source, every View targets that
Source, and every active Page has one valid parent.

Library ownership is accepted when two Projects in one Profile resolve the
same Library, archiving/deleting a Project leaves its Pages, Documents,
Databases, Sources, Views, assets, schedules, search records, and history
present, and no content Module uses Project as its owner coordinate.

Authorization is accepted when the active bound Project can read/write its
primary Database closure; a foreign Project receives not-found/denied without
a grant; read and read-write grants differ correctly; recursive closure follows
only ownership; references do not grant their targets; Page-only access sees no
siblings; Project lifecycle and revision changes invalidate stale operations;
and approval behavior remains unchanged for actions already authorized.

Database behavior is accepted when Database creation atomically produces
Container, Source, default View, and Page-ready schema; Source schema and values
use Source IDs; View query uses its stored Source ID; Page positions use Page
IDs; dormant membership values are excluded and preserved; and all failed or
stale batches roll back without partial events.

The rename is accepted when product source, contracts, routes, commands, copy,
and persisted active literals use Page/page/pageRef; remaining Card/card
matches are only generic visual card concepts or isolated legacy import code.

The UI is accepted when creating/opening/moving/editing/searching/scheduling a
Page works in Board/List/Calendar/Page Detail, the default Project opens the
bound Database's default View, no Source selector is shown for the single
Source, and Storybook covers changed surfaces. The maintainer performs visual
review; automation verifies behavior and contracts, not Tailwind strings.

## Idempotence and Recovery

Release migration steps run in transactions and must either publish the new
schema completely or leave the old store valid. Deterministic Profile, Library,
Database, Source, default View, membership, and binding identities make reruns
detect existing state rather than duplicate it. Migration tests must copy
fixtures before mutation.

Database and transfer commands retain caller-owned operation IDs, canonical
intent hashes, exact retries, and immutable receipts. A retry after response
loss returns the first result. Reusing an operation ID for different intent is
a typed collision.

If an implementation milestone fails static or behavioral checks, keep the
worktree, record the failure and evidence in `Surprises & Discoveries`, fix the
narrow cause, and rerun the failed plus neighboring tests. Never use destructive
Git reset or checkout. Each committed milestone is a safe resumption point, not
a compatibility path kept in production.

## Artifacts and Notes

Primary architecture record:

    docs/adr/0017-library-pages-data-sources-and-project-resource-grants.md

Prior discussion record, intentionally ignored by Git:

    .generated/library-database-datasource-page-project-model-2026-07-16.md

External design evidence used to validate, not define, the decision:

- Notion's current Data Source object states that a Data Source is an
  individual table under a Database, owns property schema, and has Pages as
  children.
- Notion's migration guide separates Database IDs from Data Source IDs and
  requires Page creation and schema operations to target a Source.
- Zanzibar models authorization as explicit object relations and composes
  indirect access through configured parent relations; Nodex adopts the
  explicit-relation principle while using a local bounded evaluator.

## Interfaces and Dependencies

The final shared shape must communicate concepts, not tables:

    type PageParent =
      | { kind: "library"; libraryId: string }
      | { kind: "page"; pageId: string }
      | { kind: "data_source"; dataSourceId: string };

    type DatabaseReadTarget =
      | { kind: "project_default"; projectId: string }
      | { kind: "database"; databaseId: string }
      | { kind: "data_source"; dataSourceId: string }
      | { kind: "view"; viewId: string };

    interface TrustedDatabaseAccess {
      profileId: string;
      libraryId: string;
      projectId: string | null;
      sessionId: string | null;
      rootThreadId: string | null;
      storeEpoch: string;
    }

    interface DatabaseModule {
      read(input: {
        access: TrustedDatabaseAccess;
        target: DatabaseReadTarget;
        page?: { cursor?: string; limit?: number };
      }): Promise<DatabaseReadResult>;

      apply(input: {
        access: TrustedDatabaseAccess;
        operationId: string;
        basis: OpaqueReadBasis;
        intents: readonly DatabaseIntent[];
      }): Promise<DatabaseApplyResult>;
    }

The exact result unions and stable error codes belong in the shared Module
contract. They must include not found, access denied, inactive Project,
store-epoch mismatch, operation-ID collision, Database/Source/View/Page not
found or inactive, schema/value/position conflict, invalid Source/View pairing,
active Project conflict, and unknown internal failure. Untrusted transports may
map existence-sensitive access denial to not found; trusted desktop UI may show
a recoverable access action.

The production Adapter uses `better-sqlite3` and the existing one-writer
discipline. It publishes through the existing notifier only after commit. Yjs
and scene Documents remain behind the registered owned-Document Interfaces.
The renderer remains transport-agnostic through `src/renderer/lib/api.ts`.

Revision note (2026-07-16): created the initial self-contained ExecPlan after
domain, schema, transport, and external-primary-source research. It records the
maintainer-approved target, closes remaining model choices, and leaves the
documentation checkpoint as the next executable milestone.

Revision note (2026-07-16 17:45+08:00): completed the accepted ADR, CONTEXT,
ARCHITECTURE, and migration-plan checkpoint. The next executable work is the
Profile/Library/Data Source schema and v67 migration.
