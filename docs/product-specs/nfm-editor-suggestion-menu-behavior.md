# NFM Editor Suggestion Menu Behavior

Status: Active
Last updated: 2026-08-26

## Purpose

Typed suggestion menus appear only where the trigger character expresses an
editor action rather than ordinary text. The editor owns one suggestion
session at a time; the popup is only a presentation of that live session.

The command catalog is owned by
[NFM Editor Slash Menu Behavior](nfm-editor-slash-menu-behavior.md). Page and
chat result semantics are owned by
[NFM Editor Page Connection Behavior](nfm-editor-page-reference-behavior.md)
and the corresponding thread-mention specification.

## Typed triggers

Slash commands use `/` and fullwidth `／`. Japanese locales also accept `；`.
They open only at the start of a text Block or immediately after a Unicode
separator such as an ordinary, non-breaking, or fullwidth space. Letters,
ASCII digits, punctuation, and inline content atoms are not boundaries.
URL-like `http:/` and `https:/` input remains literal.

Mentions use `@`. They open at Block start or after whitespace, `(`, `)`, `[`,
or `]`; word-adjacent input such as `name@` remains literal.

Emoji search uses `:`. It opens at Block start or after whitespace, `{`, `[`,
or `(`; word-adjacent input such as `time:` remains literal. The emoji grid is
shown after two query characters.

Code Blocks do not open typed suggestion menus. Nodex does not currently use
`+` or `[[` as mention triggers.

Programmatic actions may open a named suggestion flow without passing the
typed-trigger boundary. A programmatic mention inserts a separating space when
needed, then a visible `@`, in the same editor transaction.

## Session lifecycle

A trigger accepted from typed input creates one editor-local session. Trigger
characters typed inside its query remain query text; they do not start a
second session. A deliberate programmatic handoff may replace the current
session atomically.

The session and popup close together when the user accepts or dismisses it,
presses Escape, clicks outside, expands the selection, moves the caret before
the trigger, moves to another Block, enters a Code Block, blurs or pointer-
repositions the editor, removes the owning controller, or types a terminally
invalid query. Two consecutive spaces terminate a slash query. A stale async
result cannot restore a replaced or closed session.

IME composition is part of the active session. Temporary empty results do not
close the menu during composition; the final committed query is evaluated
after composition ends.
