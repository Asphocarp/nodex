# Keyboard Shortcuts

All keyboard shortcuts in Nodex. Platform modifier: **⌘ (Cmd)** on Mac, **Ctrl** on Windows/Linux.

## Editable Command Shortcuts

Settings -> Keyboard shortcuts edits the command-keymap registry used by the workbench shortcut hook, command-palette labels, shell panel actions, and macOS menu accelerators. User overrides persist in `~/.nodex/config.toml` under `[server.command_keybindings]`: a missing command id uses defaults, an empty array means explicitly unassigned, and an array of strings is the custom accelerator list.

The editable settings tab covers Nodex-supported command ids only. Editor-native shortcuts, text input behavior, and BlockNote/NFM editing shortcuts remain owned by the editor surface and are documented separately below.

## App-Wide

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Ctrl+Tab` | Legacy stage focus | Retained by the shortcut hook while project/session/tab shortcuts are rebuilt; no longer describes the primary shell hierarchy |
| `Ctrl+Shift+Tab` | Legacy reverse stage focus | Retained by the shortcut hook while project/session/tab shortcuts are rebuilt |
| `⌘/Ctrl+H` | Legacy stage-window shift | Retained by the shortcut hook; the new shell uses session tabs instead of a sliding stage rail |
| `Shift+Wheel` | Native horizontal scrolling | Calendar view still claims this gesture for day navigation where applicable |
| `⌘/Ctrl+1`–`4` | Legacy stage jump | Retained by the shortcut hook while project/session/tab shortcuts are rebuilt |
| `⌘/Ctrl+Alt+1`–`9` | Jump to project by index | First 9 projects in shell/sidebar order (disabled while focus is in NFM editor because `⌘/Ctrl+Alt+1`–`4` are editor heading shortcuts) |
| `⌘/Ctrl+Shift+P` | Search commands | Opens the global palette with `>` already seeded, so it starts in command mode; works from editable surfaces too |
| `⌘/Ctrl+K` | Open command palette | Global launcher for cards; type `>` to switch into command search; works from editable surfaces too |
| `⌘/Ctrl+P` | Search files / command palette | Editable command-keymap command; currently opens the global launcher in Nodex |
| `⌘/Ctrl+[` | Back | Restores the previous shell-owned project/session/panel context; works from editable surfaces too |
| `⌘/Ctrl+]` | Forward | Restores the next shell-owned project/session/panel context; works from editable surfaces too |
| `⌘/Ctrl+Shift+A` | Archive chat | Archives the active non-Overview project session |
| `⌘/Ctrl+N` | New chat | Starts a new chat in the active project |
| `⌘/Ctrl+Alt+S` | Open side chat | Opens a side chat for the active attached thread |
| Unassigned | Open in new window | Editable command; opens the active non-Overview session in a new window once assigned |
| `⌘/Ctrl+Alt+N` | New quick chat | Starts a new chat in the active project |
| `⌘/Ctrl+Alt+P` | Toggle pin | Pins or unpins the active non-Overview session |
| `⌘/Ctrl+Alt+R` | Rename chat | Opens `Rename chat` for the active non-Overview project session |
| `MouseBack` | Back | Desktop mouse back button; routes to the same app-window workbench history command |
| `MouseForward` | Forward | Desktop mouse forward button; routes to the same app-window workbench history command |
| `⌘/Ctrl+,` | Toggle settings route | Opens/closes the full-window settings route shell |
| `⌘/Ctrl+Shift+N` | Open new app window | Electron desktop only (`window:new` IPC); ignored in browser runtime |
| `⌘/Ctrl+Shift+W` | Close app window | Electron desktop only; kept distinct from `⌘/Ctrl+W` close-panel-tab |
| `⌘/Ctrl+F` | Open search for the focused stage | In Threads, opens `Find in thread`; in Diffs, opens `Find in review`; otherwise opens the Views-stage floating task search. Thread and review search can open even when focus is inside their stage content |
| `⌘/Ctrl+L` | Focus browser address bar | Focuses and selects the active Browser tab address field when one is mounted |

## Project Session Panels

| Shortcut | Action | Notes |
|----------|--------|-------|
| `⌘/Ctrl+Shift+E` | Files | Opens a Files preview in the side panel; interacting with it pins a durable Files tab |
| `Alt+⌘/Ctrl+S` | Side chat | Starts a side chat in the active panel target |
| `⌘/Ctrl+T` | Browser | Opens a Browser preview in the side panel; interacting with it pins a durable Browser tab |
| `Ctrl+Shift+G` | Review | Opens or focuses the singleton Review tab |
| `Ctrl+\`` | Terminal | Focuses an existing session terminal tab, or creates one in the bottom panel |
| `⌘/Ctrl+Shift+[` | Previous panel tab | Uses the focused right or bottom panel tab group; wraps within the same split group |
| `⌘/Ctrl+Shift+]` | Next panel tab | Uses the focused right or bottom panel tab group; wraps within the same split group |
| `⌘/Ctrl+W` | Close panel tab | Closes the active closable tab in the focused right or bottom panel tab group |

Panel action shortcuts are ignored from editable targets and dialog surfaces. Focused panel tab cycling and close-tab shortcuts also work from NFM editor content inside a panel tab group, consume the shortcut as a no-op when the focused group has no matching action, still ignore input fields and dialogs, and leave plain `⌘/Ctrl+[` / `⌘/Ctrl+]` as app-window Back/Forward. Durable Card Stage tabs keep their description editor mounted across focused panel-tab cycling while the tab remains open, so returning to the tab restores the previous editor cursor. On macOS, `⌘⇧W` closes the app window.

### Workbench Panel Borders

| Shortcut | Action | Scope |
|----------|--------|-------|
| `←` / `→` | Resize focused panel separator | Legacy stage border handlers; project-session outer panes and split-group sashes are pointer-driven |
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

The editable command registry and accelerator helpers live in `src/shared/command-keybindings.ts`. Renderer query/mutation state uses `codex-command-keymap-state`, `set-codex-command-keybinding`, and `reset-codex-command-keybindings`; main-process persistence writes user overrides to `~/.nodex/config.toml`.

Workbench navigation keyboard and mouse shortcuts are classified in `src/renderer/lib/use-workbench-shortcuts.ts`, then routed into the shell-owned Back/Forward executor in `src/renderer/components/workbench/workbench-shell.tsx`. Project-session panel shortcuts, including focused right/bottom panel tab cycling and close-tab, are owned by `WorkbenchShell` because they depend on the active session, focused panel leaf, and tab registry. Desktop menu accelerators for focused panel tab commands enter that same shell-owned path through command requests, so the shortcut still works when Chromium does not deliver a useful panel-leaf key target. The remaining stage-focused shortcuts are legacy compatibility outside the editable command registry.
Undo/redo shortcuts are in `src/renderer/lib/use-keyboard-shortcuts.ts`.
Editor shortcuts are in `src/renderer/components/kanban/editor/nfm-editor-extensions.ts` and `nfm-editor.tsx`.
Terminal panel shortcut routing is in `src/renderer/lib/use-workbench-shortcuts.ts`.
