# Domain docs

Nodex uses a single-context domain-documentation layout.

## Read before exploring

- Read the root `CONTEXT.md` for the canonical domain language and invariants.
- Read relevant decisions under `docs/adr/` before changing the affected Module or Interface.
- Read `ARCHITECTURE.md` for system ownership and dependency flow.

If a file does not exist yet, proceed without treating its absence as a blocker. Producer workflows create domain documents when terminology or decisions become stable.

## Use the glossary vocabulary

Use the terms defined in `CONTEXT.md` in issues, plans, tests, implementation names, and architectural proposals. Avoid introducing synonyms for an established concept. If a necessary concept is missing, record the gap and resolve it in the domain docs.

## ADR conflicts

If proposed work contradicts an accepted ADR, identify the conflict explicitly. Supersede the ADR deliberately instead of silently implementing a second model.
