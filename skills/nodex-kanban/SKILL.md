---
name: nodex-kanban
description: 'Use when you need to check your task queue, claim a task, update its workflow column, or move cards on a kanban board. Triggers on: starting work, finishing work, needing to plan, checking what is next, "update status", "what should I work on", or any task/kanban interaction.'
---

# Nodex Kanban

Kanban board CLI for coding agents. All reads and writes go through the `nodex` command. Output is JSONL by default; use `--json` for JSON object/array, `--csv` for CSV, and `--table` for aligned text. Run `nodex <command> -h` for full flag details.

## Columns

| # | Accepted ID | Name | Purpose |
|---|-----------|------|---------|
| 1 | `triage` | Triage | Incoming work awaiting clarification and prioritization |
| 2 | `plan` | Plan | Accepted work being scoped and prepared |
| 3 | `build` | Build | Work actively being implemented |
| 4 | `review` | Review | Work awaiting review or verification |
| 5 | `ship` | Ship | Completed work ready for delivery or already delivered |

## Workflows

### Pick Up a Plan Task for Research

When a task needs research and planning before implementation:

```bash
# 1. Claim the task (You are most likely in plan-mode when doing this.)
nodex ls plan --full
nodex mv <id> plan build

# 2. Do your planning (explore codebase, research, design)
#    Write the plan to a markdown file: plans/<task-slug>.md

# 3. Attach the plan as the card description — reuse the file you already wrote
#    Do this BEFORE calling ExitPlanMode (still in plan mode)
nodex update <id> -d @plans/<task-slug>.md

# 4. Call ExitPlanMode to get plan approved

# 5. Begin implementation on the already-claimed card
```

**Why `@filepath`?** The `-d @plans/file.md` syntax reads the file and sends its contents as the description. This avoids pasting large plan text into the command, saving significant tokens. You already wrote the plan — reuse it, don't repeat it.

### Pick Up a Plan Task to Build

The `mv` command is atomic: it fails if the card is no longer in `<from>` (i.e. another agent already claimed it). When that happens, re-list and pick a different task.

```bash
nodex ls plan                                               # List available tasks (JSONL)
nodex mv <id> plan build                                    # Claim the task
# If this fails with "Card is no longer in the expected column",
# another agent claimed it first — re-run `nodex ls plan` and pick another.
```

### Implementation Workflow

```bash
# When implementation is complete, move to Review
nodex mv <id> build review
```

### Create a Task

```bash
nodex add plan "Implement user auth" -P p1-high -e m -t "backend,auth"
nodex add triage "Fix login bug" -P p0-critical -d @./bug-report.md
```

## CLI Quick Reference

| Command | Description |
|---------|-------------|
| `nodex ls [column]` | List cards (optionally filtered by column) |
| `nodex get <id>` | Card details (column auto-resolved) |
| `nodex add <col> <title>` | Create card |
| `nodex update <id> [opts]` | Update card (column auto-resolved) |
| `nodex rm <id>` | Delete card (column auto-resolved) |
| `nodex mv <id> <from> <to> [order] [opts]` | Move card (atomic: fails if not in `<from>`) |
| `nodex history <id>` | View Card history |
| `nodex query "<sql>" [params]` | Read-only SQL query |
| `nodex projects` | List projects |

## One-Shot Read Patterns

Use these when an agent needs enough context in one command:

```bash
nodex ls plan --full
# Includes full card fields with description truncated to 240 chars,
# plus descriptionLen and descriptionTruncated metadata.

nodex ls plan --full --description-chars 800
# Same as above, with a larger description preview.

nodex ls plan --full --description-full
# Includes full descriptions (no truncation).
```

## Card Fields

| Field | Flag | Description |
|-------|------|-------------|
| title | positional / `--title` | Task name |
| description | `-d` | Markdown details (supports `@filepath`) |
| priority | `-P` | p0-critical, p1-high, p2-medium, p3-low, p4-later |
| estimate | `-e` | xs, s, m, l, xl |
| tags | `-t` | Comma-separated labels |
| assignee | `-a` | Who's working on it |
| dueDate | `--due` | Deadline (YYYY-MM-DD) |

## Tips

- **Save tokens with `@filepath`**: Use `-d @plans/file.md` instead of pasting content inline. It also works with `@-` for stdin.
- **Status spelling**: Use the canonical one-word ids `triage`, `plan`, `build`, `review`, and `ship`.
- **Auto-resolution**: `update`, `rm`, and `get` find the card's column automatically — you only need the card ID. `mv` requires explicit `<from> <to>` for atomic claim safety.
- **Filter `ls`**: Use `--priority`, `--assignee`, `--limit`, and `--offset` to narrow results.
- **Full-card reads**: Use `ls --full` for one-shot agent context. Add `--description-chars <n>` or `--description-full` depending token budget.
- **Output formats**: Default is JSONL. Use `--json` when a command should emit one JSON value, `--csv` for spreadsheets/parsers, and `--table` for human scanning.
- **Config file**: Set `project` and `session_id` in `.nodex/config.toml` to avoid repeating `--project` and `--session-id` flags.
