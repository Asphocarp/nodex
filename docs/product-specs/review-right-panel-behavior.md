# Review Right Panel Behavior

Status: Active
Last updated: 2026-06-09

## Purpose

The Review right-panel tab gives an attached thread a compact, code-review-oriented view of workspace changes. It is a read-first review surface: it selects a diff source, renders file diffs, navigates changed files, starts review requests, and routes commit or PR follow-up prompts through the active thread.

## Toolbar Contract

The toolbar is a single compact row:

- Source selector: `Last turn`, `Review uncommitted changes`, `Review staged changes`, and `Review against a base branch`.
- Diff stats: aggregate `+N` and `-N` for the active snapshot.
- `Review options`: includes review target entries, hidden-whitespace toggle, expand/collapse all diffs, and refresh for Git-backed sources.
- `Jump to file`: searchable changed-file list; selecting a row focuses and scrolls that file.
- Diff mode toggle: `Switch to split diff` and `Switch to unified diff`.
- File-tree toggle: `Hide files` and `Show files`.
- Action buttons: `Commit or push` and `Create PR`.

The Review tab does not expose the older convenience controls for word diffs, rich preview, full-file loading, manual file-tree resizing, copy-git-apply commands, or inline stage/unstage/revert actions.

## Source And State Contract

`Last turn` renders from the active conversation turn diff. A selected transcript turn can still open an internal selected-turn diff, but selected turns are not a primary source menu option.

Git-backed sources are `unstaged`, `staged`, and `branch`. The renderer stores lightweight tab state only: selected source, base branch when known, diff mode, hidden-whitespace preference, file-tree visibility, selected path, file filter, jump-to-file query, search query, expanded files, and load status.

Raw diffs, parsed hunks, file contents, and model review comments are not persisted in tab state.

## Backend Contract

The renderer calls `src/renderer/lib/api.ts`; it does not call Electron directly.

Git-backed review loading uses:

- `git:review:diff` for the active source and optional file list.
- `git:review:branch-diff-stats` for branch aggregate stats.
- `git:merge-base` before branch review actions when a base branch is selected.
- `git:review:snapshot` remains available for compatibility surfaces outside the Review right panel.

The Review panel batches Git diff loads behind a 16 ms delay and treats requests that take longer than 15 seconds as `timed-out`. Stale responses are ignored.

Large diff mode activates when any of these are true: file count is above 128, total changed lines are above 9000, total changed bytes are above 12582912, or a single file changes more than 15000 lines.

## Review Requests And Comments

Review target options call `codex:review:start` with protocol-native targets where possible:

- uncommitted changes -> `{ type: "uncommittedChanges" }`
- base branch -> `{ type: "baseBranch", branch }`
- commit targets may use `{ type: "commit", sha, title }` when available
- unsupported custom scopes should use `{ type: "custom", instructions }`

Assistant `::code-comment{title body file start end priority}` directives are parsed separately from normal text and render as anchored review annotations on matching file diffs.

## File Tree Contract

The file tree is a fixed-width right pane and has no visible resize handle. It remains stateful when hidden and restored. The tree uses a `Filter files...` input, shows folder/file rows with preserved ancestors while filtering, and keeps selected/focused row state synchronized with the active diff path.
