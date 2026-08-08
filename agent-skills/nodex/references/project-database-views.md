# Project database Views and Board

Use saved Views as the authority for filters, sorts, grouping, visible
properties, row order, and pagination. Never reconstruct a View with SQL or an
ad-hoc query.

## Query a saved View

Resolve a unique View name to its stable ID, then query it:

```sh
nodex view query --json @VIEW_ID --limit 50
nodex view query --json @VIEW_ID --group STABLE_GROUP_KEY --limit 50
nodex view query --json @VIEW_ID --unassigned --limit 50
nodex view query --json @VIEW_ID --after 'OPAQUE_CURSOR' --limit 50
```

Use `groups[].key` for mutations; `groups[].label` is display-only. Continue
with `pageInfo.endCursor` only when `hasNextPage` is true. Cursors are opaque
and bound to the saved View snapshot.

Each row can include `etags.move`. That narrow ETag binds the Page shell,
membership, grouping value, saved View, and position authority needed for an
atomic Board move.

Rows also include the current nullable `page_key`. Use it when reporting or
disambiguating work for the user, but retain the row's canonical Page ID for
every mutation, anchor, and deeplink. A View may hide keys visually without
removing them from CLI output.

## Create directly in a View group

```sh
nodex page create --json \
  --parent data_source:@DATA_SOURCE_ID \
  --view @VIEW_ID \
  --group STABLE_GROUP_KEY \
  --title "Ship public beta" \
  --file /tmp/card.nested.md \
  --idempotency-key card-create-public-beta-v1
```

Use `--unassigned` instead of `--group` only when the user explicitly wants the
unassigned group.

## Move a Board card atomically

Take the move ETag from the current `view query` row:

```sh
nodex page move --json @PAGE_ID \
  --to data_source:@DATA_SOURCE_ID \
  --view @VIEW_ID \
  --group TARGET_STABLE_GROUP_KEY \
  --at end \
  --if-match 'MOVE_ETAG' \
  --idempotency-key card-move-PAGE_ID-target-v1
```

Use exactly one placement anchor: `--at start|end`, `--before @PAGE_ID`, or
`--after @PAGE_ID`. The mutation updates grouping property and View position in
one Core transaction. Do not split it into a property edit followed by an order
edit.

If the ETag is stale, the entire move fails without a partial placement. Query
the View again, inspect the current group/order, and ask or adapt only if the
user's intent still applies.

## Duplicate into a View

```sh
nodex page duplicate --json @SOURCE_PAGE_ID \
  --to data_source:@DATA_SOURCE_ID \
  --view @VIEW_ID \
  --group STABLE_GROUP_KEY \
  --at end \
  --idempotency-key card-duplicate-SOURCE_PAGE_ID-v1
```

The returned receipt is the authority for the new Page ID, current Page key,
and final placement. Use the ID for later writes; the key is the concise
human/Agent reference.

## Open the saved View

```sh
nodex open view --json @VIEW_ID
nodex open view --json @VIEW_ID --print
```

The CLI first validates the selected Project's access. It never accepts an
arbitrary URL.
