# NFM Editor Thread Mention Behavior

Status: Active
Last Updated: 2026-06-24

## Summary

NFM supports an inline Codex thread mention:

```xml
<mention-thread uuid="019..." />
```

The mention references a Codex app-server thread/session id as an opaque string. It is a document reference and navigation affordance only; it does not embed or send the mentioned thread's transcript.

## Persistence

- The canonical inline NFM form is a self-closing `<mention-thread uuid="..." />` tag.
- `uuid` is required after trimming whitespace. Empty or missing `uuid` tags remain plain text and must not create broken structured inline content.
- The serializer writes only the `uuid` attribute and escapes XML attribute characters.
- The parser stores the mention as `threadMention` inline content with `{ uuid }`.
- Unknown future thread id formats are allowed; the parser does not enforce a UUID regex.

## Rendering

- Editable Card Stage, Toggle List, projected inline editors, and read-only NFM previews all understand `threadMention` inline content.
- In editable editors, the mention is atomic inline content and is not directly text-editable.
- The inline surface follows a minimal Notion page-mention style: inherited body text color, a small thread icon, medium-weight underlined label, no filled pill background, and no inline status badge.
- The display label resolves in this order:
  1. `threadName`
  2. First non-empty line of `threadPreview`; when transcript history is available, Nodex derives this preview from the thread's first user message.
  3. Shortened thread id
- If the thread cannot be resolved, the mention displays `Missing thread` while preserving the original `uuid`.
- Status text for archived, system-error, approval, waiting, active, idle, loading, and missing states is reserved for hover titles and popovers; it is not rendered inline in the editor body.
- Hovering or keyboard-focusing the mention auto-reveals a tooltip with the resolved label, state/short-id detail, and workspace or raw id. The tooltip is informational only and does not replace the click action.

## Resolution And Navigation

- Card Stage resolves mention metadata from the current project thread summary cache first.
- If a mention is not cached, Nodex asks the main process for `codex:thread:summary:get(threadId)`.
- The main process first reads local `codex_threads`; only a miss calls Codex app-server `thread/read` with `includeTurns: false`.
- Resolution must not resume a thread, subscribe to a stream, switch the active thread, or fetch transcript turns.
- Clicking a resolved mention opens the referenced thread through the existing Codex-thread navigation callback.
- If opening is unavailable or the thread is unresolved, the mention popover exposes `Copy UUID`.

## Insertion

- The NFM `@` suggestion menu includes thread mention rows alongside card references.
- Thread rows use the same sidebar-wide chat search model as the command palette: non-archived sidebar chats from the current project, other projects, projectless chats, and sessionless chats are eligible.
- The picker treats the editor's own `projectId` as the active project. Matching current-project chats and cards are rendered first in one `Current project` group, with chats before cards and each type preserving its selector order. Other chats, including projectless chats, follow in `Chats`; other cards follow in `Cards`.
- Archived, ephemeral, and side-conversation chats do not appear in the picker.
- Metadata search covers title, preview, project, cwd, and short/id fields with command-palette fuzzy and prefix ranking. Transcript content matches use the bounded local `codex:threads:palette:search-content` path and may add a compact snippet to the item tooltip.
- Mention rows render only the item title in the picker row and do not show right-side `@thread` or `@` syntax hints; slash-menu rows keep their syntax/shortcut hints.
- Mention tooltips show only compact context, such as project, column, actionable state, and an optional search snippet. They do not concatenate raw thread ids, card ids, cwd paths, or long mixed metadata strings.
- Idle and unknown-state threads do not show `Ready` or `Thread` as row state labels.
- Choosing a thread row inserts `threadMention` inline content and a trailing space.
- Card rows use the same command-palette card search model: summary metadata is searched with MiniSearch ranking, and full-description hits come from bounded `cards:search` excerpts. Choosing a card row inserts the existing `cardRef` block shape.

## Prompt And Clipboard Behavior

- Plain-text serialization renders a thread mention as `[Thread: <uuid>]`.
- Thread-section prompts use that same text placeholder.
- Thread mentions do not add `promptInput.mentions`, do not attach files or images, and do not inject referenced thread content.
