# Product Specifications

| Spec | Status | Last Updated | Summary |
|------|--------|--------------|---------|
| nodex-product-spec.md | Active | 2026-02-13 | Full product contract: goals, features, API, CLI, config, architecture |
| auto-review-behavior.md | Active | 2026-04-09 | Detailed Auto-review contract covering config-backed preset resolution, hard-gate reviewer fallback, UI surfaces, and approval request lifecycle |
| desktop-notification-behavior.md | Active | 2026-04-09 | Detailed Electron desktop notification contract for thread turn-complete, approval, and question notifications, including suppression, payloads, and action routing |
| codex-fast-mode-core-enablement.md | Active | 2026-04-09 | Detailed global Fast-mode preference contract covering persistence, shared renderer ownership, UI surfaces, request fallback, queue freezing, and reporting normalization |
| codex-thread-transcript-behavior.md | Active | 2026-03-20 | Source of truth for visible Codex Threads transcript projection, rendering, optimistic prompts, tool/reasoning rows, and restart recovery |
| review-right-panel-behavior.md | Active | 2026-06-09 | Detailed Review right-panel contract for toolbar controls, diff sources, Git IPC, large-diff limits, file tree behavior, and code-comment annotations |
| kanban-drag-and-drop-behavior.md | Active | 2026-03-17 | Detailed Kanban DnD contract covering same-column reorder, filtered/sorted behavior, editor interop, and persistence invariants |
| command-palette-behavior.md | Active | 2026-03-14 | Detailed command-palette launch, mode switching, ranking, previews, highlights, and execution behavior |
| description-history-revisions.md | Active | 2026-03-11 | Detailed storage, migration, hydration, pruning, and disk-reclamation behavior for revision-based card description history |
| nfm-editor-autolink-behavior.md | Active | 2026-03-10 | Detailed autolink behavior for typing and paste in the NFM editor, including settings, strict bare-domain rules, and separator-aware path protection |
| nfm-editor-attachment-chip-behavior.md | Active | 2026-03-11 | Detailed oversized-text and native file/folder paste behavior for inline attachment chips, including prompting, NFM syntax, previews, and clipboard/plain-text rules |
| nfm-editor-thread-mention-behavior.md | Active | 2026-06-20 | Detailed inline Codex thread mention contract for NFM syntax, minimal rendering, resolution, navigation, insertion, and prompt serialization |
| nfm-editor-table-block-behavior.md | Active | 2026-06-24 | Detailed simple table block contract for NFM syntax, editor parity behavior, Notion paste, layout, and clipboard serialization |
| nfm-editor-child-group-keyboard-behavior.md | Active | 2026-04-13 | Detailed `Enter` and `Backspace` behavior for nested child groups in the NFM editor, including precedence, schema gating, ProseMirror mutations, and caret placement |
| nfm-editor-copy-behavior.md | Active | 2026-03-08 | Detailed clipboard behavior for standard copy/cut and image copy inside the NFM editor |
| nfm-block-side-menu-behavior.md | Active | 2026-06-24 | Detailed NFM block side-menu contract for scope titles, production actions, card-only deeplinks, layout, and submenu behavior |
| nfm-editor-move-to-popover-behavior.md | Active | 2026-06-19 | Detailed NFM side-menu Move-to popover contract for DB/card destination search and move semantics |
| nfm-thread-section-image-inputs.md | Active | 2026-05-01 | Detailed send-time behavior for NFM image blocks in thread-section prompts, including placeholders, app-server image inputs, and source mapping |
| nfm-editor-thread-section-behavior.md | Active | 2026-03-12 | Detailed notebook-style `threadSection` syntax, section-boundary rules, send behavior, and sticky thread binding inside the NFM editor |
| workbench-shell.md | Active | 2026-03-02 | Workbench stage shell layout, thread rendering model, and navigation behavior |
