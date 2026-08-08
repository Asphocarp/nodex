# Page editor

Use this reference for Page discovery and semantic Page or Block writes. Run the
capability and context preflight in `SKILL.md` first.

## Discover and read

Start broad only when necessary:

```sh
nodex tree --json
nodex rg --json "launch plan"
nodex read --json LAB-13
nodex read --json @PAGE_ID
nodex read --json --meta @PAGE_ID
nodex sed --json -n '1,80p' @PAGE_ID
nodex history --json @PAGE_ID
```

Use `--database @DATABASE_ID` or `--page LAB-13` / `--page @PAGE_ID` to narrow
discovery. A current or historical Page key resolves inside the selected
Project and the result reports both current `page_key` and canonical `page_id`.
Search results, keys, and title paths are discovery aids; use the returned full
`@PAGE_ID` for writes and stable deeplinks.

Page bodies are canonical Nested Markdown. Read
[nested-markdown.md](nested-markdown.md) before authoring rich content. Write
content to a temporary file and pass `--file`; do not risk shell interpolation
of tabs, markup, or user text.

## Prepared validators

Request only the validator for the planned write:

```sh
nodex read --json --prepare title.set @PAGE_ID
nodex read --json --prepare document.replace @PAGE_ID
nodex read --json --prepare page.delete @PAGE_ID
nodex read --json --prepare page.move --view @VIEW_ID @PAGE_ID
```

Use the returned narrow ETag only with that operation. After a conflict, reread
and decide again.

Do not place `LAB-13` into a structured `pageId` value or replace `@PAGE_ID` in
the write examples below. Page keys are human CLI selectors; Core mutations and
their validators remain bound to canonical IDs.

## Page workflows

Create a Page under an authorized parent:

```sh
nodex page create --json \
  --parent page:@PARENT_PAGE_ID \
  --title "Launch plan" \
  --file /tmp/launch-plan.nested.md \
  --idempotency-key page-create-launch-plan-v1
```

Replace a complete body:

```sh
nodex page replace --json @PAGE_ID \
  --file /tmp/revised.nested.md \
  --if-match 'NARROW_ETAG' \
  --idempotency-key page-replace-PAGE_ID-v1
```

Set a title:

```sh
nodex page title set --json @PAGE_ID \
  --value "Launch plan" \
  --if-match 'NARROW_ETAG' \
  --idempotency-key page-title-PAGE_ID-launch-plan-v1
```

Delete only after explicit user intent:

```sh
nodex page delete --json @PAGE_ID \
  --if-match 'NARROW_ETAG' \
  --idempotency-key page-delete-PAGE_ID-v1
```

Use `nodex patch --json --file PATCH_FILE --idempotency-key KEY` for exact,
multi-edit Page changes when the patch contract is the clearest expression of
intent. Prefer semantic `page` or `block` commands for one resource.

## Stable Block edits

Use Block commands only after reading the Page representation that supplies the
stable Block ID and compatible ETag. Examples:

```sh
nodex block update --json @PAGE_ID \
  --block @BLOCK_ID \
  --patch-json '{"content":[{"type":"text","text":"Updated"}]}' \
  --if-match 'BLOCK_ETAG' \
  --idempotency-key block-update-BLOCK_ID-v1
```

For insert/move positions, pass the exact `--at` selector accepted by current
machine help. Run `nodex --json --help` when constructing an uncommon command;
do not infer flags from old documentation.

## Retry and verification

An idempotency key names one logical mutation, not one process attempt. Reuse it
after transport or response loss. Change it when the intended content,
destination, or operation changes. Treat a duplicate receipt as success for the
original intent, then verify the returned resource identity and revisions.
