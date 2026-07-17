# ADR 0020: Database identities follow ownership scope

- Status: Accepted
- Date: 2026-07-18
- Owners: Nodex maintainers
- Extends: ADR 0003 and ADR 0017
- Supersedes in part: ADR 0017's deterministic initial Source allocation

## Context

The first Database model gave Properties globally unique IDs by embedding their
Project and primary Database path, for example
`database:<project>:primary:property:status`. The string was verbose in every
schema, row, filter, receipt, and history record, and it falsely implied that a
stable Property identity should change when its owner moved. The same model
derived the initial Data Source and View identities from their parent and kept
a second Project-shaped Database authority beside the Library-owned relational
model.

The relational ownership graph already supplies the missing scope: a Database
owns Data Sources and hosted Views, a Data Source owns Properties, and a
Property owns its options. Public operations can therefore name the owner
explicitly instead of encoding ancestry inside every child ID.

## Decision

Database, Data Source, and View IDs are globally stable opaque identities. New
roots are independently preallocated canonical UUID-v7 values. Existing root
IDs remain unchanged and opaque during migration, even if an older value looks
derived; callers must never parse ownership from it.

Property identity is local to one Data Source. The complete unbound address is
`{ dataSourceId, propertyId }`. Built-in capabilities reserve semantic IDs:
`status`, `priority`, `estimate`, `tags`, `due_date`, `scheduled_start`,
`scheduled_end`, and `assignee`. A custom Property uses `p_` followed by eight
base64url characters. The persisted and public Property record has no second
machine `key`; its display name may change without changing identity.

Option identity is local to one Property. Its complete address is
`{ dataSourceId, propertyId, optionId }`. Built-in select contracts may reserve
semantic option IDs; custom options use `o_` followed by eight base64url
characters. Forty-eight random bits are sufficient at the Source-local product
bound, and the scoped unique constraint plus typed retry handles the remaining
collision case.

A View stores local Property and option IDs because it targets exactly one Data
Source. Every unbound read or write carries the Source coordinate. Database
Module v2, Block Property mutation v2, Page Lifecycle v2, trusted transports,
renderer workflows, CLI, and `nodex_app@5` use those coordinates. High-level
Page tag input remains canonical display names; its compiler resolves existing
options and preallocates missing option IDs before enqueue so an exact retry
reuses the identical request.

Schema v81 makes `database_containers`, `data_sources`,
`data_source_properties`, `data_source_page_memberships`,
`data_source_property_values`, `database_views`, and
`database_view_page_positions` the only live Database authority. It removes the
parallel `database_capabilities`, `database_properties`,
`database_memberships`, `database_property_values`, and
`database_view_positions` tables. No alias column or permanent shadow write is
retained.

The v80-to-v81 migration deterministically maps legacy Property/option IDs,
rewrites View configuration and positions, and treats each committed mutation
plus its linked `change_log` row as one evidence aggregate. It rewrites request
hashes, field paths, before/after values, and committed revisions atomically,
reinstalls immutability guards, verifies Page History evidence, clears obsolete
Database Module and Agent-call retry caches, and rotates the store epoch. Agent
results may contain signed revision tokens whose old coordinates cannot be
rekeyed honestly; their durable mutation/history ledgers remain, while the
pre-cutover replay cache becomes stale with the old epoch and tool revision.
Version 1 contracts remain only as named historical decoders and migration
input, never executable ingress.

## Consequences

- Query payloads expose compact schema keys such as `status`, `priority`, and
  `p_Q7m2cK9x` instead of repeated parent paths.
- Renaming or moving an owner never requires rekeying a stable child identity.
- Two Data Sources may safely use the same local Property ID, and two
  Properties may safely use the same local option ID.
- A local ID without its required owner is incomplete and must fail at an
  unbound boundary.
- Database creation and Project binding are separate concerns; a Project ID is
  never an allocator input for Database, Data Source, or View identity.
- Historical root IDs and v1 evidence remain readable without preserving a
  second runtime authority.
