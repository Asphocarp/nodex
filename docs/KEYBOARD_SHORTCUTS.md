# Keyboard Shortcuts

All keyboard shortcuts in Nodex. Platform modifier: **⌘ (Cmd)** on Mac, **Ctrl** on Windows/Linux.

## Editable Command Shortcuts

Settings -> Keyboard shortcuts edits the command-keymap registry used by the workbench shortcut hook, command-palette labels, shell panel actions, and desktop application-menu accelerators. User overrides persist in `~/.nodex/config.toml` under `[server.command_keybindings]`: a missing command id uses defaults, an empty array means explicitly unassigned, and an array of strings is the custom accelerator list.

The editable settings tab covers Nodex-supported command ids only. Editor-native shortcuts, text input behavior, and BlockNote/NFM editing shortcuts remain owned by the editor surface and are documented separately below.

## App-Wide

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Shift+Wheel` | Native horizontal scrolling | Calendar view still claims this gesture for day navigation where applicable |
| `⌘/Ctrl+Alt+1`–`9` | Jump to project by index | First 9 projects in shell/sidebar order (disabled while focus is in NFM editor because `⌘/Ctrl+Alt+1`–`4` are editor heading shortcuts) |
| `⌘/Ctrl+Shift+P` | Search commands | Opens the global command palette in root command mode; works from editable surfaces too |
| `⌘/Ctrl+K` | Search commands and chats | Opens the global command palette in root mode; chat metadata joins at two query characters and chat history at three; works from editable surfaces too |
| `⌘/Ctrl+G` | Search chats | Opens the global palette in chat-search mode |
| `⌘/Ctrl+P` | Search Pages | Opens the global palette in Page-search mode, including Page filter controls |
| `⌘/Ctrl+[` | Back | Restores the previous shell-owned project/session/panel context; works from editable surfaces too |
| `⌘/Ctrl+]` | Forward | Restores the next shell-owned project/session/panel context; works from editable surfaces too |
| `⌘/Ctrl+Shift+A` | Archive chat | Archives the active project or projectless session |
| `⌘/Ctrl+N` | New chat | Starts a new chat in the active project |
| `⌘/Ctrl+Alt+S` | Open side chat | Opens a side chat for the active attached thread |
| Unassigned | Open in new window | Editable command; opens the active session in a new window once assigned |
| `⌘/Ctrl+Alt+N` | New quick chat | Starts a new chat in the active project |
| `⌘/Ctrl+Alt+P` | Toggle pin | Pins or unpins the active session |
| `⌘/Ctrl+Alt+R` | Rename chat | Opens `Rename chat` for the active session |
| `MouseBack` | Back | Desktop mouse back button; routes to the same app-window workbench history command |
| `MouseForward` | Forward | Desktop mouse forward button; routes to the same app-window workbench history command |
| `⌘/Ctrl+,` | Toggle settings route | Opens/closes the full-window settings route shell |
| `⌘/Ctrl+Shift+N` | Open new app window | Electron desktop only; restores the most recently closed Window Session, otherwise clones the active window |
| `⌘/Ctrl+Shift+W` | Close app window | Electron desktop only; kept distinct from `⌘/Ctrl+W` close-panel-tab |
| `⌘/Ctrl+F` | Content search | Opens the floating Workbench search for the mounted chat, review diff, or Browser page source. When the floating input is focused, repeating the shortcut cycles chat -> diff -> browser when available. Database task search remains a Database-view-local action |
| `⌘/Ctrl+L` | Focus browser address bar | Focuses and selects the active Browser tab address field when one is mounted |

## Project Session Panels

| Shortcut | Action | Notes |
|----------|--------|-------|
| `⌘/Ctrl+J` | Toggle bottom panel | Shows or hides the active session's bottom panel; works from editable surfaces and desktop Browser tabs through the application-menu accelerator |
| `⌘/Ctrl+Shift+E` | Files | Opens a Files preview in the side panel; interacting with it pins a durable Files tab |
| `Alt+⌘/Ctrl+S` | Side chat | Starts a side chat in the active panel target |
| `⌘/Ctrl+T` | Browser | Opens a Browser preview in the side panel; interacting with it pins a durable Browser tab |
| `Ctrl+Shift+G` | Review | Opens or focuses the singleton Review tab |
| `Ctrl+\`` | Terminal | Focuses an existing session terminal tab, or creates one in the bottom panel |
| `⌘/Ctrl+Shift+[` | Previous panel tab | Uses the focused right or bottom panel tab group; wraps within the same split group |
| `⌘/Ctrl+Shift+]` | Next panel tab | Uses the focused right or bottom panel tab group; wraps within the same split group |
| `⌘/Ctrl+W` | Close panel tab | Closes the active closable tab in the focused right or bottom panel tab group, then reveals that leaf's most recently active remaining tab |

Bottom-panel toggle is a shell-global command and remains available from editable targets. Other panel action shortcuts are ignored from editable targets and dialog surfaces. Side chat, Browser, Terminal, Files, and Review resolve availability through the same capability model as panel menus and the command palette. An unavailable action returns before suppressing the browser/editor key; in particular a blank projectless Session handles Browser only, and an attached projectless Session handles Side chat plus Terminal only when their thread/cwd requirements are satisfied. Focused panel tab cycling and close-tab shortcuts also work from NFM editor content inside a panel tab group, consume the shortcut as a no-op when the focused group has no matching action, still ignore input fields and dialogs, and leave plain `⌘/Ctrl+[` / `⌘/Ctrl+]` as app-window Back/Forward. Close-panel-tab routing is leaf-scoped for keyboard, menu, close-button, and middle-click single-tab closes: Nodex reveals the most recently active remaining tab, falling back to the right neighbor and then the left neighbor only when MRU cannot answer. Durable Card Stage tabs keep their description editor mounted across focused panel-tab cycling while the tab remains open, so returning to the tab restores the previous editor cursor. On macOS, `⌘⇧W` closes the app window.

### Browser

| Shortcut | Action | Notes |
|----------|--------|-------|
| `⌘/Ctrl+L` | Focus address | Selects the complete address of the active Browser tab |
| `⌘/Ctrl+F` | Open Browser find | Opens Workbench content search in the Browser domain when Browser is the mounted target |
| `Enter` / `Shift+Enter` | Next / previous match | While the Browser find input is focused |
| `Escape` | Close or revert | Closes Browser find, exits annotation mode, or reverts an uncommitted address edit according to the focused Browser control |
| `MouseBack` / `MouseForward` | Browser page back / forward | Mouse buttons pressed inside the remote page navigate that Browser tab; these are distinct from app-window mouse Back/Forward outside the guest |

Browser zoom uses the complete options-menu ladder from 25% through 500% and
Reset zoom. Reload, hard reload, print, screenshot, device emulation, Profile
data clearing, downloads, and annotation actions use the Browser toolbar/menu
unless a separately listed app command owns an accelerator.

### Workbench Panel Borders

| Shortcut | Action | Scope |
|----------|--------|-------|
| `←` / `→` | Resize focused panel separator | Legacy stage border handlers; project-session outer panes and split-group sashes are pointer-driven |
| `⌘/Ctrl+Z` | Undo local edit | Only the focused collaborative title/body surface; remote edits and another window's transactions are excluded |
| `⌘/Ctrl+Shift+Z` | Redo local edit | Only the focused collaborative title/body surface |
| `Ctrl+Y` | Redo local edit | Windows convention inside a focused collaborative editor |

## Threads Composer

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Enter` | Primary submit | Default thread composer submit; in `Cmd/Ctrl+Enter to send long prompts` mode, multiline drafts use `Enter` for newline instead |
| `Shift+Enter` | Insert newline | Thread panel composer |
| `⌘/Ctrl+Enter` | Submit or alternate submit | In default `Enter` mode this submits idle prompts and is the running-thread alternate queue/steer shortcut; in `Cmd/Ctrl+Enter to send long prompts` mode it is primary submit only for multiline drafts |
| `⌘/Ctrl+Shift+Enter` | Alternate queue/steer submit | Running-thread composer only, when `Cmd/Ctrl+Enter to send long prompts` is enabled |
| `Shift+Tab` | Toggle Plan mode | Thread composer only when the prompt editor is focused, Plan mode is available, and slash/mention menus are not handling the key |
| `↑` | Recall queued follow-up or prompt history | Thread composer only when the cursor is at the end and no modifier is pressed. Empty drafts first edit the latest visible queued follow-up; otherwise the empty composer recalls the newest persisted prompt history entry. |
| `↓` | Walk prompt history forward or clear recall | Thread composer only when traversing recalled history. It walks toward newer entries; pressing from the newest recalled entry clears the composer and exits traversal. |
| `Ctrl+M` | Hold to dictate | Electron-only thread composer dictation. Keydown starts recording; keyup stops and inserts the transcript. Button click also starts dictation, and the active dictation footer exposes `Stop dictation` and `Transcribe and send`. |

### Request Input Cards

| Shortcut | Action | Notes |
|----------|--------|-------|
| `1`–`9` | Activate numbered choice | Advances to the next question or submits the final question; the free-form row follows the numbered preset options |
| `Enter` / `Space` | Activate selected choice | The initially selected choice is not submitted until one of these deliberate activations |
| `←` / `→` | Previous / next question | Multi-question request-input cards only; preserves the equivalent answer-control focus |
| `↑` / `↓` | Previous / next answer | Moves through preset choices; the lower boundary can enter the free-form answer |
| `Enter` | Advance or submit free-form answer | Ignored while an IME composition is active |
| `Shift+Enter` | Insert newline | Free-form textarea only |
| `Escape` | Dismiss request | Uses the request family’s dismiss semantics |

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

| Shortcut | Action | Notes |
|----------|--------|-------|
| `⌘/Ctrl+Alt+1`–`4` | Heading level 1–4 | |
| `⌘/Ctrl+Enter` | Modify current block; otherwise send current thread section in Card Stage | Modifies actionable blocks first: checkbox toggle, native toggle expand/collapse, image preview, child Card/Card-reference disclosure, or bound thread-section open. The Card occurrence toggles in place even while its live title is focused; a nested body keeps the shortcut for its own editor. In Card Stage, unhandled blocks keep the existing thread-section send fallback and confirmation preview. |
| `⌘/Ctrl+A` | Select current block content | |

### Input Rules (text triggers)

| Typed at line start | Result |
|---------------------|--------|
| `> ` | Toggle list item |
| `\| ` | Quote block |
| `# `–`#### ` | Heading level 1–4 |
| `/table` | Insert a 2x3 simple table from the slash menu |

### Tables

| Shortcut | Action |
|----------|--------|
| `Tab` | Move to the next table cell |
| `Shift+Tab` | Move to the previous table cell |
| `Enter` | Move to the cell below when editing table cell content |

### Navigation

| Shortcut | Action | Scope |
|----------|--------|-------|
| `↑` / `↓` | Traverse Page outliner surfaces | At a visual boundary, moves through the visible host Block order, an authoritative child `page` / `pageRef` title, and its disclosed body Blocks without changing disclosure; hidden collapsed-toggle descendants are skipped |
| `↑` / `↓` | Navigate between cards at boundary | Top-level Toggle List Card editor |
| `Escape` | Return from an engaged Card title to its host shell | Keeps Card disclosure unchanged |
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

Workbench navigation keyboard and mouse shortcuts are classified in `src/renderer/lib/use-workbench-shortcuts.ts`, then routed into the shell's shared panel-action dispatcher in `src/renderer/components/workbench/workbench-shell.tsx`. That dispatcher consumes `workbench-panel-capabilities.ts`, as do the bottom-panel toolbar, command palette, browser-runtime keyboard fallback, and typed desktop application-menu request. Electron owns its application-menu accelerator while the browser runtime owns the renderer key listener, preventing one keypress from toggling twice. Project-session panel tab cycling and close-tab remain owned by `WorkbenchShell` because they depend on the active session, focused panel leaf, renderer-local tab MRU, and tab registry. Retired stage/sliding-window shortcuts are deliberately left unhandled so the mounted editor or application surface can claim them.
Collaborative title/body undo is owned by the mounted Block Document surface and its local Yjs transaction origins. Editor shortcuts are in `src/renderer/components/kanban/editor/nfm-editor-extensions.ts` and `nfm-editor.tsx`; there is no Workbench- or Project-wide undo shortcut owner.
Terminal panel shortcut routing is in `src/renderer/lib/use-workbench-shortcuts.ts`.
