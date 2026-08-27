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

Exact-format bytes are Files owned directly by a Page. Use them for images,
PDFs, scripts, datasets, reference Markdown, and exports whose byte format
matters. Use a child Page for content that should remain a Nodex-native,
collaborative document. A File path such as `references/api.md` organizes the
Page's direct Files; its prefixes are not Pages or durable folders.

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

## Page File workflows

List before a File write so the operation is grounded in the current manifest:

```sh
nodex page file list --json @PAGE_ID --limit 100
```

Create or replace the File at a logical path. `--from -` reads bounded stdin;
prefer a regular source file when the output already exists on disk:

```sh
nodex page file put --json @PAGE_ID \
  --path prototype/check.py \
  --from /tmp/check.py \
  --idempotency-key page-file-put-PAGE_ID-check-v1
```

Read by stable File ID or exact logical path. Binary output goes to a file;
`--output -` is suitable only when the caller can preserve raw stdout bytes:

```sh
nodex page file read @PAGE_ID \
  --file prototype/check.py \
  --output /tmp/check.py
```

Rename changes only the logical path; placements continue to use the same File
identity. Delete fails while the Page body still references the File:

```sh
nodex page file rename --json @PAGE_ID \
  --file prototype/check.py \
  --to scripts/check.py \
  --idempotency-key page-file-rename-PAGE_ID-check-v1

nodex page file delete --json @PAGE_ID \
  --file scripts/check.py \
  --idempotency-key page-file-delete-PAGE_ID-check-v1
```

Inspect or restore retained versions with `page file versions` and
`page file restore --version N`. A restore creates a new current version; it
does not rewrite history.

Import only outputs the user intends to keep with the Page. Build caches,
temporary intermediates, and executable checkouts remain in the Agent
workspace. Reading a script from a Page does not authorize execution; first
materialize it to the normal workspace and use the existing command approval
flow.

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
