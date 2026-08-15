# Vendored BlockNote

Nodex vendors a narrow BlockNote subset so editor fixes can be maintained directly while app code continues importing the normal `@blocknote/*` package names.

## Upstream

- Repository: https://github.com/TypeCellOS/BlockNote
- Tag: `v0.51.4`
- Commit: `320949198e6db8d7cdaf970c2af7071ab61ed6d9`
- Imported packages:
  - `packages/core` -> `third_party/blocknote/packages/core`
  - `packages/react` -> `third_party/blocknote/packages/react`
  - `packages/shadcn` -> `third_party/blocknote/packages/shadcn`
  - `packages/code-block` -> `third_party/blocknote/packages/code-block`

## License Boundary

The vendored packages above are MPL-2.0 packages. Preserve each package's `LICENSE` file and keep local source modifications documented here when rebasing.

The `@blocknote/xl-*` packages are intentionally excluded because upstream marks them as GPL-3.0-or-proprietary/commercial packages. Other BlockNote packages are also excluded unless Nodex starts consuming them directly.

## Runtime Contract

- App imports stay on `@blocknote/core`, `@blocknote/react`, `@blocknote/shadcn`, and `@blocknote/code-block`.
- Root `package.json` resolves those packages through Bun workspaces.
- Vendored package exports are source-first and point at `src` instead of `dist`.
- Upstream package `devDependencies` are omitted from the private vendored manifests so editor runtime code resolves React and other peers from Nodex instead of package-local tooling installs.
- Tailwind scans `third_party/blocknote/packages/shadcn/src`.
- The renderer manual chunk resolver groups `third_party/blocknote/packages/` with the BlockNote/Tiptap vendor chunk.
- Root `bun test` excludes `third_party/**`; run upstream BlockNote tests deliberately from the vendored package when maintaining that code.

## Nodex Local Modifications

The vendored source carries these Nodex-maintained deltas from upstream:

- `core/src/blocks/ToggleWrapper/createToggleWrapper.ts`: preserve collapsed toggle state across children being added instead of forcing collapsed toggles open.
- `core/src/extensions/SideMenu/SideMenu.ts`: carry captured side-menu drag details through the drag-start event path.
- `core/src/extensions/SideMenu/SideMenu.ts`: exclude inert, non-rendered, and pointer-disabled editors from document-wide side-menu routing, prefer browser hit-test order for overlapping visible editors, and keep geometric proximity as the gutter fallback.
- `core/src/editor/editorInteractionScopes.ts`, `core/src/editor/BlockNoteEditor.ts`, `core/src/extensions/SideMenu/SideMenu.ts`, and `react/src/components/Popovers/GenericPopover.tsx`: give nested editors explicit content/container/floating-UI interaction scopes, route side-menu hover and drop events to the deepest owner before geometric gutter fallback, and keep custom portal targets attributable to their editor.
- `react/src/components/Popovers/GenericPopover.tsx`: keep the final committed React/DOM subtree and geometry through exit motion, mark that closing subtree inert, and remove it from editor interaction ownership instead of replacing it with an interactive native-HTML clone.
- `react/src/editor/ComponentsContext.tsx` and `shadcn/src/sideMenu/SideMenuButton.tsx`: expose and forward the intrinsic button interface for side-menu actions so pointer gestures and semantic styling do not require unsafe casts or selectors coupled to accessibility copy and drag mechanics.
- `core/src/extensions/SideMenu/dragging.ts`: support captured selected block IDs and ProseMirror ranges when creating drag selections, and guard drag cleanup when the view is no longer mounted.
- `core/src/extensions/SideMenu/dragging.ts`: use ProseMirror's public `TextSelection.between` API for captured selection ranges; `Selection.between` is not exposed by the installed ProseMirror version.
- `react/src/blocks/ToggleWrapper/ToggleWrapper.tsx`: keep React toggle-wrapper behavior aligned with the core toggle-wrapper collapse semantics.
- `react/src/components/Comments/FloatingComposerController.lazy.tsx` and `react/src/components/Comments/FloatingThreadController.lazy.tsx`: keep the root `@blocknote/react` controller exports available without statically importing the heavy comments controller implementations, so `BlockNoteDefaultUI` can keep its real lazy chunk boundary.
- `shadcn/src/menu/Menu.tsx`: delay Radix menu trigger pointerdown until click-intent pointerup so native drag gestures from the side-menu handle are not stolen by dropdown opening.
- `shadcn/src/style.css`, `shadcn/src/components/ui/`, and `shadcn/src/suggestionMenu/`: preserve Nodex `icon-*` geometry anywhere upstream SVG defaults already preserve Tailwind `size-*` geometry.

No generated `dist` hunks are carried forward. Future BlockNote changes should edit the vendored source and update this list when the local delta changes.

## Upgrade Workflow

Treat BlockNote upgrades as a source rebase, not as an npm version bump. The goal is to re-import the same four packages from a newer upstream tag, replay Nodex's local source delta, then restore the workspace package contract described above.

Use a local clone instead of reading upstream files from `raw.githubusercontent.com`:

```bash
OLD_TAG=v0.51.4
NEW_TAG=vX.Y.Z
tmp=$(mktemp -d)

git clone https://github.com/TypeCellOS/BlockNote "$tmp/blocknote"
git -C "$tmp/blocknote" checkout "$OLD_TAG"
```

Mirror the current vendored packages into the old upstream checkout and create a source delta. Exclude package manifests from this patch because Nodex's private workspace/source-first manifests are deterministic and should be re-applied after the new upstream package manifests are copied:

```bash
for pkg in core react shadcn code-block; do
  rsync -a --delete \
    "third_party/blocknote/packages/$pkg/" \
    "$tmp/blocknote/packages/$pkg/"
done

git -C "$tmp/blocknote" diff -- \
  packages/core \
  packages/react \
  packages/shadcn \
  packages/code-block \
  ':(exclude)packages/core/package.json' \
  ':(exclude)packages/react/package.json' \
  ':(exclude)packages/shadcn/package.json' \
  ':(exclude)packages/code-block/package.json' \
  > "$tmp/nodex-blocknote-local-source-delta.patch"
```

Reset the clone to the new upstream tag and replay the source delta with three-way merge support:

```bash
git -C "$tmp/blocknote" reset --hard
git -C "$tmp/blocknote" clean -fdx
git -C "$tmp/blocknote" checkout "$NEW_TAG"
git -C "$tmp/blocknote" apply -3 "$tmp/nodex-blocknote-local-source-delta.patch"
```

Resolve conflicts in the upstream clone first. Conflicts should normally be limited to the files listed in `Nodex Local Modifications`. If an upstream change makes one of the local modifications unnecessary, drop that hunk and update this file.

Copy the resolved packages back into Nodex:

```bash
for pkg in core react shadcn code-block; do
  rsync -a --delete \
    "$tmp/blocknote/packages/$pkg/" \
    "third_party/blocknote/packages/$pkg/"
done
```

After copying, restore the vendored package manifest rules:

- Keep upstream `name` and new upstream `version`.
- Set `private: true`.
- Keep source-first `main`, `module`, `types`, `source`, and `exports` entries.
- Order conditional exports from specific to fallback: keep custom conditions such as `style` before `default`, and always keep `default` last so later conditions remain reachable.
- Keep all existing public subpath exports used by Nodex.
- Change internal BlockNote runtime dependencies to `workspace:*`.
- Omit upstream package `devDependencies` unless Nodex intentionally starts running upstream package-local tooling.

Then update this file:

- Change the upstream tag and commit.
- Keep the imported package list limited to `core`, `react`, `shadcn`, and `code-block`.
- Keep the `@blocknote/xl-*` exclusion unless the licensing decision changes explicitly.
- Refresh `Nodex Local Modifications` to match the actual post-rebase delta.

Finish with the standard validation commands:

```bash
bun install
bun test config/renderer-manual-chunks.test.ts
bun test src/renderer/lib/nfm/blocknote-adapter.test.ts
bun test src/renderer/components/board/editor/code-block-options.test.ts
bun run typecheck
bun run lint
bun test
bun run build
```
