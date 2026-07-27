import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeDirectoryHandle } from "@pierre/trees";
import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { preloadSourceViewer } from "@/components/ui/lazy-source-viewer";
import { cn } from "@/lib/utils";

export interface WorkspaceFileTreePath {
  readonly path: string;
  readonly kind: "directory" | "file";
}

export interface WorkspaceFileTreeProps {
  readonly paths: readonly WorkspaceFileTreePath[];
  readonly expandedPaths: ReadonlySet<string>;
  readonly selectedPath: string | null;
  readonly searchQuery: string;
  readonly className?: string;
  readonly onExpand: (path: string) => void;
  readonly onCollapse: (path: string) => void;
  readonly onOpen: (path: string, mode: "preview" | "durable") => void;
}

const WORKSPACE_TREE_UNSAFE_CSS = `
:host {
  --trees-bg-override: var(--color-token-main-surface-primary);
  --trees-bg-muted-override: var(--color-token-list-hover-background);
  --trees-border-color-override: var(--color-token-border);
  --trees-fg-override: var(--color-token-foreground);
  --trees-font-size-override: 13px;
  --trees-focus-ring-color-override: var(--color-token-list-focus-outline);
  --trees-item-padding-x-override: 6px;
  --trees-item-margin-x-override: 0px;
  --trees-level-gap-override: 0px;
  --trees-padding-inline-override: 0px;
  --trees-scrollbar-gutter-override: 0px;
  --trees-scrollbar-gutter-measured: 0px;
  --trees-selected-bg-override: var(--color-token-list-active-selection-background);
  --trees-selected-fg-override: var(--color-token-list-active-selection-foreground);
  --trees-item-row-gap-override: 10px;
}

[data-file-tree-sticky-overlay-content='true'],
[data-file-tree-sticky-row='true'] {
  background-color: var(--color-token-main-surface-primary);
}

[data-file-tree-virtualized-scroll='true'] {
  scrollbar-gutter: auto;
}

[role='treeitem'],
[role='treeitem'] * {
  cursor: var(--cursor-interaction) !important;
}

[data-item-type='file']:has([data-item-section='content']:empty) {
  display: none;
}

@container measure (height <= calc(1lh + 1px)) {
  [data-truncate-marker] {
    opacity: 0;
  }
}
`;

function toPierreDirectoryPath(path: string): string {
  return path.replace(/\/+$/, "") + "/";
}

export function toPierreWorkspaceTreePaths(
  paths: readonly WorkspaceFileTreePath[],
): string[] {
  return paths.map((item) =>
    item.kind === "directory" ? toPierreDirectoryPath(item.path) : item.path);
}

function fromPierreTreePath(path: string): string {
  return path.replace(/\/+$/, "");
}

export function resolveWorkspaceFileClickMode(
  detail: number,
): "preview" | null {
  return detail > 1 ? null : "preview";
}

function getTreeEventPath(event: Event): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const itemPath = target.dataset.itemPath ?? target.dataset.fileTreeStickyPath;
    if (itemPath) return itemPath;
  }
  return null;
}

export function WorkspaceFileTree({
  paths,
  expandedPaths,
  selectedPath,
  searchQuery,
  className,
  onExpand,
  onCollapse,
  onOpen,
}: WorkspaceFileTreeProps) {
  const callbacksRef = useRef({ onCollapse, onExpand, onOpen });
  callbacksRef.current = { onCollapse, onExpand, onOpen };
  const treePaths = useMemo(() => toPierreWorkspaceTreePaths(paths), [paths]);
  const initialExpandedPaths = useMemo(
    () => [...expandedPaths]
      .filter((path) => path.length > 0)
      .map(toPierreDirectoryPath),
    [expandedPaths],
  );
  const initialSelectedPaths = useMemo(
    () => selectedPath ? [selectedPath] : [],
    [selectedPath],
  );
  const { model } = useFileTree({
    paths: treePaths,
    initialExpandedPaths,
    initialSelectedPaths,
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: false,
    icons: { set: "complete", colored: true },
    itemHeight: 28,
    stickyFolders: true,
    search: false,
    unsafeCSS: WORKSPACE_TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    model.resetPaths(treePaths, { initialExpandedPaths });
  }, [initialExpandedPaths, model, treePaths]);

  useEffect(() => {
    model.setSearch(searchQuery || null);
  }, [model, searchQuery]);

  useEffect(() => {
    const currentSelection = model.getSelectedPaths();
    if (
      currentSelection.length === (selectedPath ? 1 : 0)
      && currentSelection[0] === selectedPath
    ) {
      return;
    }
    for (const path of currentSelection) model.getItem(path)?.deselect();
    if (selectedPath) model.getItem(selectedPath)?.select();
  }, [model, selectedPath, treePaths]);

  const handleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const rawPath = getTreeEventPath(event.nativeEvent);
    if (!rawPath) return;
    if (!rawPath.endsWith("/")) {
      // A double click emits two click events before `dblclick`. Only the
      // first click previews; the dedicated handler performs one durable open.
      const mode = resolveWorkspaceFileClickMode(event.detail);
      if (!mode) return;
      callbacksRef.current.onOpen(rawPath, mode);
      return;
    }
    const item = model.getItem(rawPath);
    if (!item?.isDirectory()) return;
    const directoryItem = item as FileTreeDirectoryHandle;
    const path = fromPierreTreePath(rawPath);
    if (directoryItem.isExpanded()) {
      callbacksRef.current.onExpand(path);
      return;
    }
    callbacksRef.current.onCollapse(path);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const rawPath = getTreeEventPath(event.nativeEvent);
    if (!rawPath || rawPath.endsWith("/")) return;
    callbacksRef.current.onOpen(rawPath, "durable");
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter") return;
    const item = model.getFocusedItem();
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    const rawPath = item.getPath();
    if (!item.isDirectory()) {
      callbacksRef.current.onOpen(rawPath, "durable");
      return;
    }
    const directoryItem = item as FileTreeDirectoryHandle;
    directoryItem.toggle();
    const path = fromPierreTreePath(rawPath);
    if (directoryItem.isExpanded()) {
      callbacksRef.current.onExpand(path);
      return;
    }
    callbacksRef.current.onCollapse(path);
  };

  const handlePointerOver = (event: ReactPointerEvent<HTMLElement>) => {
    const rawPath = getTreeEventPath(event.nativeEvent);
    if (rawPath && !rawPath.endsWith("/")) preloadSourceViewer();
  };

  return (
    <FileTree
      model={model}
      aria-label="Workspace files"
      className={cn("block h-full min-h-0 w-full", className)}
      data-tab-preview-pin-exempt="true"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onPointerOver={handlePointerOver}
    />
  );
}
