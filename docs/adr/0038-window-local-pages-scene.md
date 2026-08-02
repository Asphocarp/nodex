# ADR 0038: Window-local Pages Scene

## Status

Accepted

## Context

ADR 0037 assigned every standalone Library root its own Resource Scene with a
protected primary. That made an ordinary content click replace the entire tab
context, prevented closing the root tab, and left the tab-strip `+` without a
valid action vocabulary. It also treated a presentation group as though it
were owned by one content resource.

Pages needs one stable workspace-like tab context per app window. Library
remains the authority for resource identity, ownership, path, lifecycle, and
access; Pages is only its window-local presentation.

## Decision

`WorkbenchSceneSnapshot` v5 adds the singleton owner `{ kind: "pages" }` with
canonical key `pages`. The Scene lives inside one Window Session; it is not a
Core aggregate, Project, or conversation Session.

Unlike Project and Session Scenes, Pages has no protected primary. Its Page,
Database, View, and Canvas surfaces are ordinary closable, reorderable,
splittable tabs, and an empty tablist is valid. Every descriptor carries
explicit trusted-Library access. Execution-only surfaces and Project-default
Database targets are rejected.

Selecting any Pages sidebar row presents or focuses its semantic surface in
this one Scene. Surface reuse keys prevent duplicates. Scene mutation and
selection of the Pages location are recorded as one Window State transition,
so Back and Forward restore the complete active tab and panel tree without an
intermediate history entry.

The tab-strip `+` owns a Pages-specific, search-first picker backed by the
bounded Library catalog. It opens Page, Database-default, and Canvas targets
and offers New Page and New Database actions. It does not reuse the
Project-specific panel destination picker. The sidebar header `+` remains a
creation-only shortcut.

The active sidebar root is derived from the selected surface's authoritative
Library path. It is not persisted separately in layout state. Page and Canvas
runtime cleanup is fenced before a tab is removed.

Layout v7 migrates only the active v6 Resource Scene into Pages: its former
primary becomes an ordinary tab while placement, active selection, splits,
titles, and state are retained. Compatible Library-authorized Page, Database,
View, and Canvas siblings are retained up to the Scene bound; the promoted
primary wins any bound collision. Browser, execution-only, and Project-scoped
siblings are discarded because Pages cannot authorize or render them. Other
dormant Resource Scenes are discarded; Project and Session Scenes migrate
unchanged. Resource locations, including Settings and Automations `returnTo`,
become `{ kind: "pages" }`. Missing active Resource Scenes are materialized
with deterministic bounded identities so repeated decode is stable.

## Consequences

- All Pages resources in a window share one coherent tablist and split tree.
- The last tab can close into a useful empty chooser.
- Pages navigation no longer creates synthetic Sessions or per-resource
  presentation owners.
- Library authority stays explicit and independent from the selected Scene.
- Exact global Database View search remains outside the catalog picker until
  the Library catalog exposes Views; exact Views can still open from resource
  navigation.

This ADR supersedes ADR 0037's per-root Resource Scene decision and partially
supersedes ADR 0034's universal protected-primary invariant.
