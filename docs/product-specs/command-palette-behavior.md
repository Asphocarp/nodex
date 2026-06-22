# Command Palette Behavior

## Intent
The command palette is the global launcher for fast workbench navigation.
It is split into explicit entry modes so command recall, chat search, and card retrieval do not compete in one result list:

- root mode searches command/action rows only
- chats mode searches the current non-archived sidebar chats
- cards mode searches workspace cards and owns the card filter controls
- files mode keeps the reference command-menu shell available for parity work, but file search stays a development-only disabled mock until Nodex has a real file-search backend
- result ranking favors fast recall over exhaustive inspection
- matching context is visible directly in the result row through inline highlights and short previews

The palette is a transient overlay and does not become part of durable navigation history.

## Launch and Scope
- `Cmd/Ctrl+K` opens the command palette from anywhere in the app in root command mode, including editable surfaces.
- `Cmd/Ctrl+Shift+P` opens the same root command mode.
- `Cmd/Ctrl+G` opens chats mode.
- `Cmd/Ctrl+P` opens cards mode.
- The sidebar `Search` row opens cards mode and shows the `Cmd/Ctrl+P` shortcut.
- A leading `>` is plain query text and no longer switches modes.
- The palette reads cards from every loaded project store, not just the active project.
- The palette reads chat results from the current non-archived sidebar chat snapshot, including project-backed, projectless, and not-yet-materialized sidebar chats that can be opened through chat session materialization.
- The palette closes after executing a result.
- Closing the palette clears the query and resets the selection index.
- The palette overlays the workbench without dimming the background content.

## Modes

### Root Command Mode
Root command mode is opened by `Cmd/Ctrl+K` and `Cmd/Ctrl+Shift+P`.

- Root mode shows command/action rows only.
- Chats and cards are represented as explicit command rows such as `Search chats` and `Search cards`.
- Executing `Search chats` switches to chats mode. Executing `Search cards` switches to cards mode.
- `Search files` appears only in development as a disabled mock row until real file search exists.
- Cards and chats are hidden entirely in root mode.
- Disabled commands remain visible so users can understand available affordances, but they are skipped by keyboard selection and cannot be executed.
- Commands use customized command-keymap shortcut labels where a matching command id exists.
- Commands are grouped as Suggested, Chat, Navigation, Panels, Project, Configure, Skills, and App.
- Unsupported Codex-parity commands appear only in development as disabled mock rows with a `Mock` badge; production hides them entirely. Supported Nodex-only actions appear in the closest matching group.
- `Toggle browser panel` and `Open Card Stage` are intentionally not part of the root command catalog.

### Chats Mode
Chats mode is opened by `Cmd/Ctrl+G` or the root-mode `Search chats` row.

- Chats mode shows chat rows only.
- Commands and cards are hidden entirely in chats mode.
- Empty query shows recent and pinned sidebar chats when available.
- User-facing row text uses `chat`; internal data structures may still use `thread`.
- Chat metadata search is local. Chat content snippets come only from the bounded backend search path described below.

### Cards Mode
Cards mode is opened by `Cmd/Ctrl+P`, the sidebar `Search` row, or the root-mode `Search cards` row.

- Cards mode shows card rows only.
- Commands and chats are hidden entirely in cards mode.
- Empty query shows default card suggestions.
- Cards mode keeps a trailing `Filter` button on the search-input row.
- Clicking `Filter` opens a transient popover with property filters for status, priority, tags, assignee, and project.
- When any palette filters are active, the palette shows a compact summary row directly under the input, using the same compact pill language as the DB view toolbar.
- Palette card filters persist across palette reopen and app reload, but the free-text query still clears on close.

### Files Mode
Files mode is a reference-shell placeholder.

- Files mode keeps the command-menu layout, input, loading, empty, and disabled-row states available for parity work.
- Until Nodex has real workspace file search, file search does not claim `Cmd/Ctrl+P` and does not execute backend actions.

## Card Search Model

### Indexed fields
Card search indexes the following normalized fields:

- title
- plain-text description
- tags
- assignee
- agent status
- column name
- project name
- card id

Normalization is lowercasing plus whitespace compaction.

### Ranking
Card search uses a MiniSearch index with a persisted cache plus a runtime reuse layer.
Field boosts are:

- title: `8`
- tags: `5`
- assignee: `4`
- agent status: `3`
- column name: `2`
- project name: `2`
- description: `1`
- card id: `1`

Query semantics:

- multiple terms combine with `AND`
- prefix matching is enabled for terms with length `>= 2`
- fuzzy matching uses term-length-sensitive thresholds
  - length `<= 3`: `0`
  - length `4-5`: `0.1`
  - length `> 5`: `0.2`
- free-text search stays separate from palette filters; filters narrow the final card result set after search ranking
- status, priority, assignee, and project filters are multi-select unions
- tag filters support `Any`, `All`, and `None` matching modes

### Ordering
For non-empty queries, card results sort by:

1. MiniSearch relevance score
2. active-project preference
3. recency preference (`recentIndex`)
4. board order (`boardIndex`)
5. title

For empty queries, card results skip MiniSearch and sort by:

1. active-project preference
2. recency preference
3. board order
4. title

### Index lifecycle
- The renderer keeps one serialized card-search index in IndexedDB for the palette.
- The app also keeps an in-memory copy of the most recent palette index so reopening the palette in the same session does not rebuild it.
- When the current card set changes, the palette hydrates the cached MiniSearch index and diffs cards by per-card search signature instead of rebuilding everything from scratch.
- Signature changes include all indexed text, so card edits plus project-name or column-name changes invalidate the affected cached entries.

## Card Result Presentation

### Primary line
Each card result renders:

- project icon chip
- card title
- project and column subtitle

If the query matched the title, project name, or column name, those matched spans are highlighted inline inside the rendered text rather than rendered as a separate badge.

### Secondary match indicators
If the query matched other indexed fields, the result may render compact indicator chips for:

- `tag`
- `assignee`
- `status`
- `id`

These chips render only for fields that actually matched.
They are intentionally compact and subdued so they explain why a result appeared without overpowering the title.

### Description preview
If the query matched description text, the result renders a contextual preview below the subtitle:

- preview is extracted from the plain-text description
- excerpt centers around the first matched description term
- excerpt is trimmed with leading/trailing ellipses when taken from the middle of the description
- preview is clamped to `3` lines
- matched spans are highlighted inline

If a result matched only non-description fields, no description preview is shown.

## Chat Search Model

Chat search indexes sidebar chat metadata in the renderer and treats content search as a bounded main-process supplement.

### Indexed fields
Chat metadata search indexes:

- title
- preview
- project name
- cwd
- chat id

Only non-archived chats visible in the sidebar snapshot are included. Project-backed chats, projectless chats, and sessionless snapshot chats are searchable; archived chats, disabled rows, side chats, ephemeral conversations, and internal helper threads are excluded.

### Ranking
Chat metadata search uses an in-memory MiniSearch index. It is intentionally not persisted in IndexedDB because chat metadata is small and already fetched on palette open.

Field boosts are:

- title: `8`
- preview: `4`
- project name: `3`
- cwd: `2`
- chat id: `1`

Query semantics match card metadata search:

- multiple terms combine with `AND`
- prefix matching is enabled for terms with length `>= 2`
- fuzzy matching uses the shared term-length-sensitive thresholds

For empty queries, chat results preserve sidebar ordering: pinned rows first, then the sidebar's recency ordering.
For non-empty queries, metadata relevance sorts first, then pinned/sidebar ordering and recency tiebreaks.

### Content search
For queries with at least `2` characters, the renderer also requests bounded chat content search through `codex:threads:palette:search-content`:

- the request limit is capped at `60`
- the main process searches a local SQLite FTS5 content index plus an in-memory MiniSearch fuzzy overlay
- returned content hits are intersected with the current sidebar chat id whitelist before they can render
- local search/index errors fail closed and leave metadata search working
- content-only hits can appear in the `Chats` section after metadata hits

### Chat Result Presentation
Each chat result renders:

- chat icon
- chat title
- project, cwd basename, and updated date metadata
- optional preview/snippet row

Metadata matches can highlight fuzzy-matched title, project/Chats context, cwd, and preview spans using MiniSearch match terms.
Content snippets prefer backend-provided highlight segments from FTS snippets; fuzzy content fallback snippets highlight only literal matched terms when available.

## Command Search Model
- Commands are matched only in root mode.
- Command ranking remains lightweight and heuristic rather than MiniSearch-based.
- Ranking considers title, subtitle, keyword text, explicit command priority, and active-state bonus.
- Result limits remain separate from card limits.

## Keyboard Behavior
- `ArrowDown` / `ArrowUp` moves selection and skips disabled commands.
- `Home` / `End` jumps to the first or last visible result.
- `Enter` executes the selected result.
- `Escape` clears the query when the query is non-empty.
- When the query is empty, standard dialog close behavior applies.

## Result Limits
- root mode shows up to `100` command rows; disabled mock rows are discoverable only in development builds because production does not include mock commands in the catalog
- chats mode shows up to `12` chat rows
- cards mode shows up to `12` card rows
- files mode shows only its mock/empty state until real file search exists

## Execution Semantics

### Card results
Executing a card result:

- closes the palette
- opens that card in a durable Card Stage panel tab
- preserves the current DB-project selection if the card belongs to another project

### Command results
Executing a command result:

- closes the palette
- runs the associated shell/workbench action

### Chat Results
Executing a chat result:

- closes the palette
- opens the attached project session for that chat
- shows the existing unattached-chat toast only if the result is stale and its session link disappeared after search

Supported actions currently include:

- go back / go forward
- new chat, rename chat, archive chat, pin/unpin chat, and open chat in a new window
- toggle sidebar, side panel, and bottom panel
- open Files, Browser, Review, Terminal, and DB View panel tabs
- open side chat for an attached active chat
- open settings and keyboard shortcut settings

## Non-Goals
- full query DSL in card mode
- quoted phrase operators
- inline search qualifiers or advanced query syntax
- persistent search history
- multi-snippet previews per card
- multi-snippet previews per chat
- syntax-colored rich-text previews

The palette is intentionally biased toward immediate navigation rather than becoming a full search product. Filtering should feel like a lightweight extension of the existing workbench toolbar language, not a separate advanced-search feature.
