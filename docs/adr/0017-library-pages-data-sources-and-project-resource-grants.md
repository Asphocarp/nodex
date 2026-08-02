# ADR 0017: Library owns Pages and Databases while Projects receive resource grants

- Status: Accepted
- Date: 2026-07-16
- Owners: Nodex maintainers
- Supersedes in part: ADR 0001, ADR 0003, ADR 0005 (exclusive Card parent), and ADR 0010
- Superseded in part by: ADR 0020 (independent root allocation and compact
  Source-scoped schema identity)

## Context

Nodex currently uses Project for two unrelated responsibilities. A Project is
an execution context with filesystem roots, sessions, terminals, and Codex
Threads, but its identifier is also the ownership coordinate for Blocks,
Documents, Database records, assets, search records, schedules, and mutations.
Deleting or replacing an execution context can therefore threaten durable
content, and content cannot be shared with another Project without changing its
owner.

The Database model has a similar responsibility collision. One
`databaseBlockId` identifies a placeable Block, a schema, the Pages governed by
that schema, property values, Views, Project binding, and authorization scope.
That works for a single table with a single execution context, but it does not
give one Project a coherent home for several differently shaped collections.
It also makes a View's location indistinguishable from the identity of the data
it presents.

Finally, `Card` and `Document` both sound like the user's durable content
object. In the actual authority model, the persistent object is a
document-bearing Block and Document is only its independently synchronized
content owner. The product needs one Page-like noun for that object.

## Decision

### One local Profile owns one Library

Each local Profile has exactly one Library. Library is the durable ownership
scope for Blocks, Documents, Database Containers, Data Sources, Views, assets,
search projections, schedules, and content mutation evidence.

Project is no longer a content owner. It remains the execution context for
filesystem roots, sessions, tabs, terminals, Codex Threads, and approval
policy. Archiving or deleting a Project never deletes Library content.

The initial local implementation persists one Profile and one Library in each
profile-scoped SQLite store. Their identities are stored rather than inferred
from a Project. The schema still allows the relationship to be represented
explicitly so backup validation and future profile management have an
authoritative owner coordinate.

### Page replaces Card as the persistent domain noun

`Page` is a document-bearing Block. Page ID equals Block ID, and each Page owns
exactly one Document containing its collaborative rich title and body. The
Document is an internal persistence, synchronization, and history boundary; it
is not a second user content object.

The persisted Block type changes from `card` to `page`. Public product
contracts, routes, events, commands, read models, and source names use Page.
`Card` may remain only as a renderer presentation noun such as `KanbanCard`; it
is not a compatibility alias for the domain object.

References use the canonical editor node `pageRef` and NFM tag `page-ref`.
Historical `cardRef` nodes are decode-only migration inputs. A
mention owns its own Block identity and points at a Page without changing the
target's parent or granting access to it.

### Every Page has one exclusive parent

An active Page has exactly one parent:

```ts
type PageParent =
  | { readonly kind: "library"; readonly libraryId: string }
  | { readonly kind: "page"; readonly pageId: string }
  | { readonly kind: "data_source"; readonly dataSourceId: string };
```

A Library-parented Page is top-level durable content. A Page-parented Page is a
nested Page whose shell is stored in the parent's Document while its own
Document remains independent. A Data Source-parented Page is a structured row
whose values conform to that Data Source's schema.

A Page never acquires another parent because it is shown in another place.
`pageRef`, Database View, relation, mention, backlink, and linked View edges are
non-owning.

Public parent-changing commands carry only these logical Library, Page, and
Data Source coordinates. The writer resolves them to the current physical
`space | document | database` storage coordinates and records the logical
identity in the exact request before acquiring fences. Those physical names are
private persistence-adapter details, not product parents. A `document` logical
fallback is reserved for registered non-Page Document owners such as reusable
sources; Page-owned Documents always cross the public boundary as `page`.

Historical membership records may retain dormant values after a Page leaves a
Data Source, but the Page ID is the active row identity and a Page has at most
one active Data Source membership. Dormant values are retained until explicit
destructive cleanup or retention collection. Moving a Page to another Data
Source does not automatically map values: the old values become dormant and the
new Source begins with defaults. A future explicit mapping command may be
designed if real workflows require it.

### Database is a Container; Data Source owns schema and Pages

A Database remains a placeable Block with the same stable Block identity. It is
a Container that owns metadata, lifecycle, Data Sources, hosted Views, a
default View, Project binding, and access revision. It does not own schema,
Pages, or property values directly.

A Data Source is a first-class relational entity inside the Database Module. It
is not a Block, has no Document, and has no independent Library placement. A
Data Source has exactly one home Database and owns:

- property definitions and schema revision;
- its Data Source-parented Pages;
- the Pages' property values and dormant membership history; and
- the identity used for query and relation validation.

A View belongs to one Database Container and points to exactly one Data Source.
It owns filter, sort, grouping, display configuration, and Page-specific manual
positions. View positions use `(viewId, pageId)`; callers never need a separate
row identity for an active Page.

A View position remains optional until a caller expresses manual-order intent.
The writer resolves stable Page anchors against the complete unfiltered logical
group order, including members without position rows. If that group contains
unpositioned Pages, the same transaction first materializes the entire existing
logical order into evenly spaced ranks and then inserts the moved Page run.
Materialized siblings begin at position revision 1; order-preserving physical
rank rebalances do not advance existing sibling revisions.

Creating a Database is one atomic convenience command that creates the
Container, a deterministic initial Data Source, an initial View targeting that
Source, and the Container's default View. The ordinary UI initially exposes
only this single-Source path. Internal contracts always carry an explicit Data
Source identity and never guess it from “the only Source.”

The first release requires every View's Database to be the Data Source's home
Database. The schema nevertheless stores both identities from the beginning.
Linked Views, Data Source moves, Relations, and Add Data Source UI require later
product decisions and do not enter this migration.

### Project binds one Database and receives grants

Each Project binds one primary Database Container when created. The binding is
stable; ordinary update flows do not silently rebind it. A Database has at most
one active Project and may retain inactive or archived historical Projects.

Project lifecycle is `active | inactive | archived`:

- active Projects may create and run Sessions;
- inactive Projects cannot start work and their historical Sessions are
  read-only;
- archived Projects remain historical and read-only.

Reactivation restores current implicit access because authorization is
recomputed from current lifecycle and revisions for every operation. It does
not revive an expired approval or bypass an archived Session's own lifecycle.

An active Project has an implicit recursive read-write grant to its primary
Database. Additional access is expressed by durable Project resource grants:

```ts
type ProjectResourceGrant = {
  readonly projectId: string;
  readonly root:
    | { readonly kind: "page"; readonly pageId: string }
    | { readonly kind: "database"; readonly databaseId: string };
  readonly access: "read" | "read_write";
  readonly recursive: true;
  readonly revision: number;
};
```

Recursive grants follow ownership edges only. A Database grant covers its Data
Sources, hosted Views, Data Source-parented Pages, nested Pages, owned
Documents, and assets. A Page grant covers that Page, nested Pages, physically
nested Databases, Documents, and assets. Grants never traverse `pageRef`,
relation, linked View, mention, backlink, or ordinary link edges.

A grant to one Data Source-parented Page exposes only the property definitions
needed to interpret that Page's current values. It does not expose sibling
Pages or allow schema mutation. `read_write` permits content and current value
edits but does not imply structural operations such as creating a nested
Database, changing schema, changing grants, moving a Data Source, archiving a
Database, or permanent deletion. Those operations require distinct
capabilities and, where appropriate, approval.

Resource authorization and operation approval remain separate Modules.
Authorization answers whether the Project may act on a resource. Approval
answers whether an already authorized action may proceed automatically, once,
for the task, or not at all.

Library access management reads one authoritative matrix across every Project
in the Library. The read model distinguishes the exact direct grant from
effective access and names inherited sources. Its batch command changes only
exact direct grants, applies per-grant revision fences, and commits all edits in
one transaction. Because grants are additive, an inherited or primary-Database
capability is a non-reducible floor; removing a child grant is not a deny
override. Inactive and archived Projects may have a direct grant revoked but
cannot receive or upgrade one.

### One deep Database Module owns database semantics

Database semantics live behind one deep Module rather than table-shaped
repositories. Its public Interface has two operations:

```ts
interface DatabaseModule {
  read(input: DatabaseRead): Promise<DatabaseReadResult>;
  apply(input: DatabaseApply): Promise<DatabaseApplyResult>;
}
```

Targets are explicit (`project_default`, `database`, `data_source`, or `view`).
The host binds trusted Profile, Library, Project, Session, and actor identity.
The Module hides Project binding resolution, resource-grant evaluation, schema
and value validation, active and dormant memberships, Page positioning,
fractional ranking, revision conflicts, idempotent receipts, projection repair,
and post-commit events.

SQLite is the one production Adapter and the same Adapter runs against a
temporary SQLite store in Module tests. Table-shaped repository Interfaces and
Map fakes are rejected because they would expose transaction ordering and
cross-table invariants to callers.

## Consequences

Library content survives Project lifecycle and can be granted to multiple
execution contexts without changing ownership. Page, Data Source, and View each
have one unambiguous identity: content, schema-governed collection, and
presentation. A Project can eventually work with multiple heterogeneous Data
Sources inside its bound Database without becoming the owner of their content.

The migration is deliberately broad. It changes SQLite ownership coordinates,
Block types and parents, all Card-named contracts, Database schema/value/query
coordinates, View positions, authorization, HTTP and IPC transports, Agent
tools, scheduler/search projections, realtime events, drag and drop, Page
Detail, renderer stores, and product documentation. Long-lived Card aliases or
Project-scoped content fallbacks would preserve the ambiguity and are not
allowed.

Existing Database Block IDs remain stable. Every old Database receives a
deterministic initial Data Source, existing properties/memberships/values move
under it, every View is backfilled with that Source ID, and positions change to
Page coordinates. Existing Card Blocks become Page Blocks. Existing Space
parents become the one Library; Document-parented Cards become Page-parented
Pages through their owning Page coordinate; Database parents become Data Source
parents.

The first UI continues to look like one Database with familiar Board/List/
Calendar surfaces. “Data Source” appears only after Add Data Source is
intentionally productized. The correct identity split exists internally from
the first migration.

## Invariants

1. One local Profile owns exactly one Library.
2. Library, not Project, owns all durable content.
3. Block is the only persistent content identity; Page ID equals Block ID.
4. A Page owns exactly one Document.
5. Every active Page has exactly one Library, Page, or Data Source parent.
6. A Data Source-parented Page has exactly one matching active membership.
7. Dormant memberships never affect reads, queries, schedules, or mutations.
8. Database Container owns Data Sources and Views but not schema or rows.
9. Data Source owns schema, Pages, property values, and query identity.
10. Every View belongs to one Database and targets exactly one Data Source.
11. Every View position addresses a Page, and the Page belongs to the View's
    target Data Source.
12. A Project binds exactly one primary Database; one Database has at most one
    active Project.
13. Project archive or deletion never deletes Library content.
14. Recursive grants follow ownership only and never references.
15. Resource authorization and operation approval are independent decisions.
16. Database creation commits Container, initial Data Source, default View, and
    binding-compatible metadata atomically.
17. Data Source never becomes a Block without a future superseding ADR.
18. The initial UI and public creation flows support one Source per Database;
    all authority contracts still carry explicit Data Source IDs.

## Rejected alternatives

Keeping Project as the content scope makes execution lifecycle a hidden content
deletion and sharing boundary. Giving one Page multiple Data Source memberships
makes the Page's status, due date, schedule, and mutation target ambiguous.
Keeping Database as both Container and schema identity blocks multiple schemas
and linked presentation. Renaming only renderer copy while retaining Card in
contracts leaves two user-content nouns. Letting grants traverse references
turns a presentation edge into authority escalation. All are rejected.

## References

- [Notion API Data source object](https://developers.notion.com/reference/data-source)
- [Notion multi-source database upgrade guide](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03)
- [Google Zanzibar authorization model](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/)
