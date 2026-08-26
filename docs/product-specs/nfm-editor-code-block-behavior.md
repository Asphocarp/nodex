# NFM Editor Code Block Behavior

Status: Active
Last updated: 2026-08-26

## Purpose

Code Blocks present source text with syntax highlighting while preserving a small durable document shape: language and code. Editing controls stay out of the source and appear as one compact Action Bar at the upper-right of the block. Code Blocks do not support captions.

This contract owns editable Code Blocks, read-only BlockNote previews, NFM previews, language selection, formatting capability, and renderer-local line wrapping.

## Durable content and local presentation

Language is durable Block content and round-trips through the Block Document and the NFM fence. Unsupported or historical language identifiers normalize to Plain Text at import boundaries instead of creating hidden catalog entries.

Line wrapping is renderer-local presentation state keyed by durable Block ID as `code-wrap-${blockId}`. It is not a Block prop, NFM attribute, database value, collaborative update, or Undo/Redo entry. The state rules are:

- a new Block ID starts unwrapped;
- remounting, moving, or restoring the same Block ID restores its local value;
- duplicating creates a new ID and therefore starts unwrapped;
- deleting and undoing restores the same ID and local value;
- unavailable browser storage does not prevent the current renderer session from changing wrap.

Changing wrap must leave the materialized Block Document and serialized NFM byte-for-byte unchanged.

## Language catalog

The picker contains exactly these 88 labels:

> ABAP, Agda, Arduino, ASCII Art, Assembly, Bash, BASIC, BNF, C, C#, C++, Clojure, CoffeeScript, CSS, Dart, Dhall, Diff, Docker, EBNF, Elixir, Elm, Erlang, F#, Flow, Fortran, Gherkin, GLSL, Go, GraphQL, Groovy, Haskell, HCL, HTML, Idris, Java, JavaScript, JSON, Julia, Kotlin, LaTeX, Less, Lisp, LiveScript, LLVM IR, Lua, Makefile, Markdown, Markup, Mathematica, MATLAB, Mermaid, Nix, Notion Formula, Objective-C, OCaml, Pascal, Perl, PHP, Plain Text, PowerShell, Prolog, Protobuf, PureScript, Python, R, Racket, Reason, Rocq, Ruby, Rust, Sass, Scala, Scheme, SCSS, Shell, Smalltalk, Solidity, SQL, Swift, TOML, TypeScript, VB.Net, Verilog, VHDL, Visual Basic, WebAssembly, XML, YAML

`src/shared/nfm/code-language-catalog-v1.json` is the executable source of truth for canonical IDs, labels, aliases, extensions, search terms, syntax grammars, and formatter kinds. Tests must keep the count, order, unique identities, and labels exact.

Search matches label, canonical ID, aliases, extensions, and search terms. The picker is 240px wide, no taller than half the viewport, focuses its search field when opened, marks the current item with both a check and `aria-selected`, and returns focus to its trigger on Escape. Language choice commits one editor transaction and updates the validated renderer-local default used only when creating later Code Blocks. Explicit imported or existing Block language always wins.

## Editable surface and Action Bar

The surface has a 10px radius, 22px horizontal code inset, 24px outer vertical padding, 12px scroller vertical padding, 13.6px/20.4px monospace text, and `tab-size: 2`. Unwrapped code uses `white-space: pre` and block-local horizontal scrolling. Wrapped code uses `break-spaces`, break-all, and no horizontal scroller.

The product surface is the sole Code Block backdrop; the surrounding BlockNote content host remains transparent. Its translucent background token and Shiki token theme must resolve from the same light or dark color scheme. Ordinary code and syntax punctuation maintain at least a 4.5:1 contrast ratio against the fully composited surface in both schemes.

The Action Bar is inset 4px from the top and end edge. It is 28px high with 24px controls. A normal-width bar contains Language, Copy, and More; a block no wider than 230px contains only More. Width changes are observed rather than inferred from document structure.

The Action Bar and read-only header resolve their floating surface, foreground, controls, divider, and outline from the same light or dark scheme as the Code Block. Related portaled pickers and menus inherit the renderer window scheme rather than retaining light chrome inside a dark editor.

On fine-pointer desktops, the Action Bar mounts while the Code Block is hovered, the surface or bar owns focus, or a related popup is open. It unmounts after those conditions end and hides immediately during block drag. Hidden controls must not remain in the tab order. On coarse-pointer devices it remains mounted, and tooltips do not compete with touch input. There is one Action Bar portal for the active Code Block, even when syntax highlighting replaces its initial NodeView anchor.

The stable accessible names are:

- Action Bar: `Code block action bar`
- Language: `Open language dropdown`
- Copy: `Copy code to clipboard`
- More: `Open block actions menu`

Copy writes the complete plain source, without a Markdown fence or document metadata, and does not add editor history.

## Block actions and formatting

More opens the shared NFM Block side menu. For one Code Block it prepends `Copy code`, `Wrap code`, `Language`, and, when supported, `Format code` to the generic production actions. Caption is absent. A narrow Action Bar therefore retains every capability through More.

Formatting is available only for CSS, GraphQL, HTML, JavaScript, JSON, SCSS, TypeScript, and XML. Each formatter and parser loads on demand. Rust and every other catalog language omit Format until a compatible maintained formatter is actually registered and tested.

Formatting distinguishes unsupported, unchanged, failed, and changed results. Unsupported languages expose no action. Unchanged output adds no history entry. Parse or loader failure preserves the exact source and reports a non-blocking error. Changed output replaces the code in one transaction, and one Undo restores the source.

## Read-only presentation

Read-only BlockNote and NFM previews resolve the same language catalog and use the same surface geometry and syntax grammar. They are always unwrapped and show only the language label and Copy. They never mount Language, More, Wrap, Format, or another mutation controller.

## Verification boundary

Pure tests own catalog, normalization, capacity, view-state failure semantics, and formatter outcomes. Renderer/browser tests own real NodeView lifecycle, hover/focus/drag, local wrap projection, language transactions, shared More actions, duplicate/delete identity behavior, and single-step formatting Undo. The `nfm-code-block-actions` public-operation scenario supplies production-shaped Code Blocks for Core and Electron validation. Storybook covers idle, hover, picker, More, wrapped, narrow, dark, and read-only states.
