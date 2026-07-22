# Command Palette Behavior

## Intent
The command palette is the global launcher for fast workbench navigation.
It has explicit entry modes while keeping root search useful when users type a task title without switching modes first:

- root mode searches commands immediately and progressively adds chats and Pages as the query becomes specific
- chats mode searches the current non-archived sidebar chats
- page mode searches Library Pages and owns the Page filter controls
- files mode keeps the command-menu shell available for future file-search work, but file search stays a development-only disabled mock until Nodex has a real file-search backend
- result ranking favors fast recall over exhaustive inspection
- matching context is visible directly in the result row through inline highlights and short previews

The palette is a transient overlay and does not become part of durable navigation history.

## Launch and Scope
- `Cmd/Ctrl+K` opens the command palette from anywhere in the app in root command mode, including editable surfaces.
- `Cmd/Ctrl+Shift+P` opens the same root command mode.
- `Cmd/Ctrl+G` opens chats mode.
- `Cmd/Ctrl+P` opens page mode.
- The sidebar `Search` row opens page mode and shows the `Cmd/Ctrl+P` shortcut.
- A leading `>` is plain query text and no longer switches modes.
- The palette reads Pages visible through every loaded Project context, not just the active Project.
- The palette combines the current non-archived local chat catalog with eligible root chats returned by app-server search. A server-only result is materialized locally only when opened.
- The palette closes after executing a result.
- Closing the palette clears the query and resets the selection index.
- The palette overlays the workbench without dimming the background content.

## Modes

### Root Command Mode
Root command mode is opened by `Cmd/Ctrl+K` and `Cmd/Ctrl+Shift+P`.

- Root mode always searches command/action rows.
- A root query shorter than `2` characters remains command-only.
- At `2` Unicode characters, matching local chat and Page metadata appears in trailing `Chats` and `Pages` sections while commands remain visible.
- At `2` Unicode characters, root mode also starts a bounded Page-body search. At `3` characters, the `Chats` section additionally merges bounded app-server chat-history results.
- Chats and Pages are represented as explicit command rows such as `Search chats` and `Search Pages`.
- Executing `Search chats` switches to chats mode. Executing `Search Pages` switches to page mode.
- `Search files` appears only in development as a disabled mock row until real file search exists.
- Root results remain grouped as commands, Chats, then Pages; scores from different result types are never interleaved.
- Pages use only the discovery-row budget left after commands, Chats, and visible search-status rows. Root mode has no separate Page-result cap, so Pages can fill every remaining row.
- For queries that include app-server chat history, root mode waits for that Chat result count to settle before revealing Pages so the final section does not appear and disappear as Chats arrive.
- Root Page discovery ignores persisted Page-mode filters because those controls are not visible in root mode.
- Disabled commands remain visible so users can understand available affordances, but they are skipped by keyboard selection and cannot be executed.
- Commands use customized command-keymap shortcut labels where a matching command id exists.
- Commands are grouped as Suggested, Chat, Navigation, Panels, Project, Configure, Skills, and App.
- Unsupported shell commands appear only in development as disabled mock rows with a `Mock` badge; production hides them entirely. Supported Nodex-only actions appear in the closest matching group.
- `Toggle browser panel` and `Open Page Stage` are intentionally not part of the root command catalog.

### Chats Mode
Chats mode is opened by `Cmd/Ctrl+G` or the root-mode `Search chats` row.

- Chats mode shows chat rows only.
- Commands and Pages are hidden entirely in chats mode.
- Empty query shows recent and pinned sidebar chats when available.
- User-facing row text uses `chat`; internal data structures may still use `thread`.
- Chat metadata search is local and immediate. Transcript discovery and snippets come only from the bounded app-server search path described below.

### Page Mode
Page mode is opened by `Cmd/Ctrl+P`, the sidebar `Search` row, or the root-mode `Search Pages` row.

- Page mode shows Page rows only.
- Commands and chats are hidden entirely in page mode.
- Empty query shows default Page suggestions.
- Page mode keeps a trailing `Filter` button on the search-input row.
- Local Page metadata matches remain visible while Page-body search is pending. A fixed-height `Searching page contents...` status occupies the async result slot, and `No matching pages.` appears only after the current query and Project scope have settled with no matches.
- Clicking `Filter` opens a transient popover with property filters for status, priority, tags, assignee, and project.
- When any palette filters are active, the palette shows a compact summary row directly under the input, using the same compact pill language as the DB view toolbar.
- Palette Page filters persist across palette reopen and app reload, but the free-text query still clears on close.

### Files Mode
Files mode is a reference-shell placeholder.

- Files mode keeps the command-menu layout, input, loading, empty, and disabled-row states available for future file-search work.
- Until Nodex has real workspace file search, file search does not claim `Cmd/Ctrl+P` and does not execute backend actions.

## Page Search Model

### Indexed fields
Page search indexes the following normalized fields:

- title
- plain-text description
- tags
- assignee
- column name
- project name
- Page id

Normalization is lowercasing plus whitespace compaction.

### Ranking
Page search uses a MiniSearch index with a persisted cache plus a runtime reuse layer.
Field boosts are:

- title: `8`
- tags: `5`
- assignee: `4`
- column name: `2`
- project name: `2`
- description: `1`
- Page id: `1`

Query semantics:

- multiple terms combine with `AND`
- prefix matching is enabled for terms with length `>= 2`
- fuzzy matching uses term-length-sensitive thresholds
  - length `<= 3`: `0`
  - length `4-5`: `0.1`
  - length `> 5`: `0.2`
- free-text search stays separate from palette filters; filters narrow the final Page result set after search ranking
- status, priority, assignee, and project filters are multi-select unions
- tag filters support `Any`, `All`, and `None` matching modes

### Ordering
For non-empty queries, Page results sort by:

1. MiniSearch relevance score
2. active-project preference
3. recency preference (`recentIndex`)
4. board order (`boardIndex`)
5. title

For empty queries, Page results skip MiniSearch and sort by:

1. active-project preference
2. recency preference
3. board order
4. title

### Index lifecycle
- The renderer keeps one serialized Page-search index in IndexedDB for the palette.
- The app also keeps an in-memory copy of the most recent palette index so reopening the palette in the same session does not rebuild it.
- When the current Page set changes, the palette hydrates the cached MiniSearch index and diffs Pages by per-Page search signature instead of rebuilding everything from scratch.
- Signature changes include all indexed text, so Page edits plus project-name or column-name changes invalidate the affected cached entries.
- Bounded Page-body searches use a 150 ms debounce, deduplicate identical in-flight requests, and reuse successful results for 30 seconds. Root mode requests at most `12` body candidates; focused Page mode requests at most `60`.

## Page Result Presentation

### Primary line
Each Page result renders:

- project icon chip
- Page title
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

In root mode, Page rows stay compact: metadata badges are omitted and a body excerpt is clamped to one line. Focused Page mode retains the full Page row treatment above.

## Chat Search Model

Chat search indexes the local chat catalog in the renderer and treats app-server `thread/search` as a bounded supplement and discovery source.

### Indexed fields
Chat metadata search indexes:

- title
- preview
- git branch
- project name
- cwd
- chat id

The local index includes non-archived project-backed, projectless, and sessionless chats. The app-server supplement may add eligible root chats that are not local yet. Archived chats, side chats, ephemeral conversations, parent-linked subagents, and internal helper threads are excluded at the main-process boundary.

### Ranking
Chat metadata search uses an in-memory MiniSearch index. It is intentionally not persisted in IndexedDB because chat metadata is small and already fetched on palette open.

Field boosts are:

- title: `8`
- preview: `4`
- git branch: `2.5`
- project name: `3`
- cwd: `2`
- chat id: `1`

Query semantics match Page metadata search:

- multiple terms combine with `AND`
- prefix matching is enabled for terms with length `>= 2`
- fuzzy matching uses the shared term-length-sensitive thresholds

For empty queries, chat results preserve sidebar ordering: pinned rows first, then the sidebar's recency ordering.
For non-empty queries, the best matched field orders results first (`title`, `preview`, `branch`, `project/cwd`, then id), followed by relevance and recency. Pickers may place active-Project results first without changing this shared match order.

### App-server search
The renderer requests bounded chat search through `codex:threads:palette:search`, with a 200 ms debounce:

- the request limit is capped at `60`
- explicit Chats mode searches for every non-empty query; root mode starts at `3` characters
- main calls paginated app-server `thread/search`, ordered by `updated_at` descending, until it reaches the result limit or exhausts the cursor
- main drops archived, ephemeral, parent/subagent, and internal-source rows, guards repeated cursors, and enriches hits from local thread/session/Project state when available
- a normalized query/limit cache lasts 30 seconds and identical in-flight requests are deduplicated
- renderer results are accepted only for the current normalized query; a stale response cannot replace newer rows
- app-server errors show a compact fallback status while local metadata matches remain interactive
- Nodex stores no transcript copy, FTS table, retry state, or backfill queue for this feature

### Chat Result Presentation
Each chat result renders:

- chat icon
- chat title
- project, cwd basename, branch, and updated date metadata
- optional preview/snippet row

Metadata matches highlight title, project/Chats context, cwd, branch, and preview characters inline without badge-like match chips. App-server snippets are normalized and highlighted against the current query in the renderer. CJK, emoji, and combining marks use one code-point coordinate system so highlighting never corrupts visible text.

## Command Search Model
- Commands are matched only in root mode.
- Command ranking remains lightweight and heuristic rather than MiniSearch-based.
- Ranking considers exact/prefix/substring and fuzzy subsequence matches across title, subtitle, and keyword text, plus explicit command priority and active-state bonus.
- Matching command-title characters are highlighted inline; a failed fuzzy attempt leaves the original title untouched.
- Result limits remain separate from Page limits.

## Keyboard Behavior
- `ArrowDown` / `ArrowUp` moves selection and skips disabled commands.
- `Home` / `End` jumps to the first or last visible result.
- `Enter` executes the selected result.
- `Escape` clears the query when the query is non-empty.
- When the query is empty, standard dialog close behavior applies.

## Result Limits
- root mode shows up to `100` matching command rows and up to `9` progressive chat rows; Pages appear only when the combined command, Chat, and status-row count is below the `7`-row discovery budget, then fill the remaining budget without a separate Page cap
- chats mode shows up to `9` chat rows
- page mode shows up to `12` Page rows
- files mode shows only its mock/empty state until real file search exists

## Execution Semantics

### Page results
Executing a Page result:

- closes the palette
- opens that Page in a durable Page Stage panel tab
- preserves the current DB-project selection if the Page belongs to another project

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
- full query DSL in Page mode
- quoted phrase operators
- inline search qualifiers or advanced query syntax
- persistent search history
- multi-snippet previews per Page
- multi-snippet previews per chat
- syntax-colored rich-text previews

The palette is intentionally biased toward immediate navigation rather than becoming a full search product. Filtering should feel like a lightweight extension of the existing workbench toolbar language, not a separate advanced-search feature.
