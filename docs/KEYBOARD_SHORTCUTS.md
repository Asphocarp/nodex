# Keyboard Shortcuts

All keyboard shortcuts in Nodex. Platform modifier: **⌘ (Cmd)** on Mac, **Ctrl** on Windows/Linux.

## App-Wide

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Ctrl+Tab` | Legacy stage focus | Retained by the shortcut hook while project/session/tab shortcuts are rebuilt; no longer describes the primary shell hierarchy |
| `Ctrl+Shift+Tab` | Legacy reverse stage focus | Retained by the shortcut hook while project/session/tab shortcuts are rebuilt |
| `⌘/Ctrl+L` | Legacy stage-window shift | Retained by the shortcut hook; the new shell uses session tabs instead of a sliding stage rail |
| `⌘/Ctrl+H` | Legacy stage-window shift | Retained by the shortcut hook; the new shell uses session tabs instead of a sliding stage rail |
| `Shift+Wheel` | Native horizontal scrolling | Calendar view still claims this gesture for day navigation where applicable |
| `⌘/Ctrl+1`–`4` | Legacy stage jump | Retained by the shortcut hook while project/session/tab shortcuts are rebuilt |
| `⌘/Ctrl+Alt+1`–`9` | Jump to project by index | First 9 projects in shell/sidebar order (disabled while focus is in NFM editor because `⌘/Ctrl+Alt+1`–`4` are editor heading shortcuts) |
| `⌘/Ctrl+Shift+P` | Search commands | Opens the global palette with `>` already seeded, so it starts in command mode; works from editable surfaces too |
| `⌘/Ctrl+K` | Open command palette | Global launcher for cards; type `>` to switch into command search; works from editable surfaces too |
| `⌘/Ctrl+P` | Open Files side-panel tab | In project-session context, opens/focuses a Codex-style Files placeholder tab. `⌘/Ctrl+K` remains the global card launcher. |
| `⌘/Ctrl+[` | Go back | Restores the previous durable workbench context; works from editable surfaces too |
| `⌘/Ctrl+]` | Go forward | Restores the next durable workbench context; works from editable surfaces too |
| `⌘/Ctrl+,` | Toggle settings overlay | Opens/closes the full-page settings overlay |
| `⌘/Ctrl+J` | Toggle terminal UI | Global toggle, including when focus is in editor inputs; session-tab terminals are the primary terminal surface in the new shell |
| `⌘/Ctrl+N` | Open new app window | Electron desktop only (`window:new` IPC); ignored in browser runtime |
| `⌘/Ctrl+F` | Open search for the focused stage | In Threads, opens `Find in thread`; in Diffs, opens `Find in review`; otherwise opens the Views-stage floating task search. Thread and review search can open even when focus is inside their stage content |

## Project Session Right Panel

| Shortcut | Action | Notes |
|----------|--------|-------|
| `⌘/Ctrl+P` | Files | Opens a Codex-style mock Files tab |
| `⌘/Ctrl+T` | Browser | Opens or focuses the singleton Browser placeholder tab |
| `Ctrl+Shift+G` | Review | Opens or focuses the singleton Review tab |
| `Ctrl+\`` | Terminal | Opens a new session terminal tab |

Right-panel shortcuts are ignored from editable targets and dialog surfaces.

### Workbench Panel Borders

| Shortcut | Action | Scope |
|----------|--------|-------|
| `←` / `→` | Resize focused panel separator | Legacy stage border handlers; project-session pane resize is pointer-driven in v1 |
| `⌘/Ctrl+Z` | Undo | Board-level undo (card ops) outside editor surfaces; inside BlockNote editor this stays editor-local undo |
| `⌘/Ctrl+Shift+Z` | Redo | Board-level redo outside editor surfaces |
| `⌘/Ctrl+Y` | Redo | Windows convention |

## Threads Composer

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Enter` | Send prompt | Default behavior in the thread-page composer; in `Cmd/Ctrl+Enter to send long prompts` mode, multiline drafts use `Enter` for newline instead |
| `Shift+Enter` | Insert newline | Thread panel composer |
| `⌘/Ctrl+Enter` | Send prompt | Always submits; when `Cmd/Ctrl+Enter to send long prompts` is enabled, this becomes the primary submit for multiline drafts |
| `⌘/Ctrl+Shift+Enter` | Alternate queue/steer submit | Running-thread composer only, when `Cmd/Ctrl+Enter to send long prompts` is enabled |
| `Ctrl+M` | Hold to dictate | Electron-only thread composer dictation. Keydown starts recording; keyup stops and inserts the transcript. Button click also starts dictation, and the active dictation footer exposes `Stop dictation` and `Transcribe and send`. |

## Editor (NFM / BlockNote)

### Find & Replace

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl+F` | Open find panel (in-editor); seeds query from selected editor text when selection is non-empty |
| `⌘/Ctrl+G` | Next match |
| `⌘/Ctrl+Shift+G` | Previous match |
| `Enter` | Next match (in find input) |
| `Shift+Enter` | Previous match (in find input) |
| `Enter` | Replace current (in replace input) |
| `Escape` | Close find panel |

### Block Formatting

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl+Alt+1`–`4` | Heading level 1–4 |
| `⌘/Ctrl+Enter` | Send current thread section | Opens a confirmation preview by default; can auto-create a section at the current block when none exists |
| `⌘+Enter` | Toggle expand/collapse (Mac, when the cursor is on a toggle header or `cardToggle` row) |
| `⌘/Ctrl+A` | Select current block content |

### Input Rules (text triggers)

| Typed at line start | Result |
|---------------------|--------|
| `> ` | Toggle list item |
| `\| ` | Quote block |
| `# `–`#### ` | Heading level 1–4 |

### Navigation

| Shortcut | Action | Scope |
|----------|--------|-------|
| `↑` / `↓` | Navigate between inline views | When on inline block selection |
| `↑` / `↓` | Navigate between cards at boundary | Toggle list card editor |
| `Space` | Toggle large image preview | When an image block is focused (open), or while preview modal is open (close) |

## Forms & Dialogs

| Shortcut | Action | Scope |
|----------|--------|-------|
| `Enter` | Submit / confirm | Inline card creator, project create/rename, tag input |
| `Escape` | Cancel / close | Inline card creator, project forms, card-stage tag dropdown |
| `↑` / `↓` | Navigate suggestions | Card stage tag input |
| `Tab` | Select highlighted tag | Card stage tag input |
| `↑` / `↓` | Navigate entries | History panel |

## Implementation

Workbench navigation shortcuts are in `src/renderer/lib/use-workbench-shortcuts.ts`. Project-session right-panel shortcuts are owned by `src/renderer/components/workbench/workbench-shell.tsx` because they depend on the active session and tab registry. The remaining stage-focused shortcuts are legacy compatibility until the project/session/tab keyboard map replaces them.
Undo/redo shortcuts are in `src/renderer/lib/use-keyboard-shortcuts.ts`.
Editor shortcuts are in `src/renderer/components/kanban/editor/nfm-editor-extensions.ts` and `nfm-editor.tsx`.
Terminal panel shortcut routing is in `src/renderer/lib/use-workbench-shortcuts.ts`.
