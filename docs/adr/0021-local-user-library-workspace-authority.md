# ADR 0021: The local user works with Library authority

- Status: Accepted
- Date: 2026-07-18
- Owners: Nodex maintainers
- Extends: ADR 0017, ADR 0018, and ADR 0019

## Context

Nodex stores durable Pages and Databases in the local Profile's one Library.
Projects are execution contexts bound to one Database; they are not ownership
containers. Requiring a selected Project to open or edit every Library resource
would make archived Projects accidentally hide durable content and would turn a
Project's resource grants into the local user's own permission system.

At the same time, Project sessions and Agents must not gain Library-wide access
merely because the desktop user can browse the Library.

## Decision

Every content boundary receives an explicit access context:

- `{ kind: "library" }` means a trusted local human surface. The boundary derives
  the one Profile and Library from the open store; callers cannot submit a
  `libraryId`. The authority is fenced by Profile identity, Library identity, and
  store epoch.
- `{ kind: "project", projectId }` means a Project-scoped workflow. Existing
  Project binding, recursive grants, lifecycle, consent, and Full Access rules
  remain authoritative.

Library authority may read active or archived resources and mutate active
resources anywhere in its own Library. Deleted resources are absent. Archived
resource restoration remains a typed lifecycle operation rather than an
ordinary content write.

Library UI routes use Library authority. Project sessions, scheduled execution,
and Agent tools use Project authority. Moving or linking a Library resource into
a Project workflow never transfers ownership; it creates or requests an
explicit Project resource grant.

## Consequences

- Library content remains reachable after its former active Project is archived.
- A Project cannot inherit access from the currently visible Library UI.
- The loopback HTTP boundary and Electron app window can expose Library routes
  only after deriving identity from the local store.
- Restoring or replacing the store invalidates captured authorities through the
  store epoch fence.
- New content APIs must accept `ContentAccessContext` instead of treating a
  `projectId` as both navigation state and content authority.
