# Domain docs

How the engineering skills should consume Nodex's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or **`CONTEXT-MAP.md`** if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area about to change.
- **`ARCHITECTURE.md`** — read the system ownership and dependency flow before changing a Module or Interface.

If any of these files do not exist, proceed silently. Do not treat their absence as a blocker; producer workflows create domain documents lazily when terminology or decisions become stable.

## File structure

Nodex currently uses a single-context layout:

```text
/
├── CONTEXT.md
├── docs/adr/              # system-wide decisions
└── src/
```

If `CONTEXT-MAP.md` is introduced later, follow it and read the relevant context-scoped `CONTEXT.md` and ADRs as well.

## Use the glossary vocabulary

When an engineering skill names a domain concept, use the term defined in `CONTEXT.md` in issues, plans, tests, implementation names, and architectural proposals. Avoid introducing synonyms for an established concept. If a necessary concept is missing, record the gap and resolve it through `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an accepted ADR, identify the conflict explicitly. Supersede the ADR deliberately instead of silently implementing a second model.
