# ADR-0039: Data Source Relation Properties and typed Property semantics

- Status: Accepted
- Date: 2026-08-04
- Owner: Database Module

## Context

Data Source Properties previously stored every value as `value_type + value_json` and exposed schema and mutation behavior as strings plus generic JSON. That is sufficient for scalar and option-backed values, but not for Page-reference sets: JSON arrays cannot enforce target identity, support indexed reverse lookup, provide closure-aware retention evidence, or project authorization-safe summaries without repeated Page reads.

## Decision

The Database Module owns a first-class `relation` Property schema bound to one target Data Source in the same Library. Its value is an unordered unique set of stable Page IDs. Relation is a non-owning, non-authorizing, one-way edge; it never changes Page parent, membership, Document ownership, or grants. Self-relations are valid, and names such as `Blocked By` do not imply DAG validation.

Store v100 normalizes authority into `data_source_relation_properties` and `data_source_relation_edges`. `data_source_property_values` retains only the value revision header with a JSON `null` sentinel. Target Page IDs exist only in the edge table. Deferred `NO ACTION` foreign keys, validation triggers, reverse indexes, readiness checks, retention analysis, copy behavior, and projection-impact expansion make that authority fail closed.

Database contract v6 uses tagged Property schema, Core-derived capabilities, and typed replace/patch-set edits. Relation replacement uses revision CAS; add/remove is idempotent and does not bump revisions on no-op. Patch removal and every non-empty replacement reauthorize all supplied Page IDs so guessed IDs cannot become membership probes; an explicit revision-fenced empty replacement remains the way to clear a value containing restricted targets. Full values use a bounded keyset window whose signed cursor stores only an ordinal and a constant marker, never a target Page ID. Row and Page Detail reads expose the first three visible targets, exact total/restricted counts, and `has_more`; restricted targets expose no Page ID or title.

Source-defined Page metadata writes use those same Database intents. Intrinsic Page metadata remains owned by the Library Block Property kernel. When one Page Detail action changes both scopes—for example scheduled timestamps plus all-day/timezone—the Library v9 `apply_page_metadata_properties` command composes only Database value edits for exactly the same non-empty Page set as the intrinsic fields, inside one SQLite transaction and one outer idempotency boundary. It rejects a pre-existing independent Database receipt for the operation ID and folds Database revision/resource evidence into the Library receipt. It does not reintroduce Source-defined semantics into Block Property Mutation.

Relation supports `contains`, `not_contains`, `is_empty`, and `is_not_empty`. It is not sortable or groupable. Database View authoring consumes Core capabilities. Relation filter Page operands are reauthorized whenever a View descriptor, window, context, or group summary is read, so a saved config cannot retain a Page-ID disclosure after grants change. Complete target reads and source-scoped candidate search are separate authorized, bounded Database reads; the renderer never derives a complete candidate set from the current View or hydrates candidates Page by Page. The Database manager obtains target Sources from the Project's paged authorized Database catalog.

## Consequences

- Reverse lookup, target integrity, lifecycle recovery, copy, retention, and future reciprocal/rollup work reuse one canonical edge authority.
- A new Property kind changes one exhaustive Core semantics layer, generated protocol, and presentation instead of parallel mutation interfaces.
- v99 → v100 and Database v5 → v6 are intentional breaking migrations; Nodex has no production user data requiring compatibility paths.
- Mixed Page metadata saves gain an upper Library transaction while each lower kernel remains the sole owner of its semantics.
- CLI Page metadata carries a bounded Relation summary instead of requiring a complete authorized target list, so hidden or long values do not make an otherwise readable Page fail.
- Reciprocal fields, rollups, formulas, and DAG/cycle constraints remain separate future decisions.

## Rejected alternatives

- Page ID arrays in `value_json`: no target FK, reverse index, bounded complete read, or reliable retention evidence.
- A separate Relation/Reference Graph Module: Relation writes share Data Source schema, membership, revision, receipt, and authorization transactions.
- Paired forward/inverse edge values: creates two authorities and recovery ambiguity.
- Inferring graph rules from display names: names are mutable presentation, not schema semantics.
