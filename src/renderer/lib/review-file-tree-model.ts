import type { GitReviewFileStatus } from "@/lib/types";

export interface ReviewFileTreeEntry {
  key: string;
  displayPath: string;
}

export type ReviewFileTreeNodeType = "folder" | "file";
export type ReviewFileTreeRowGitStatus =
  "added" | "modified" | "deleted" | null;

interface ReviewFileTreeBaseNode {
  id: string;
  type: ReviewFileTreeNodeType;
  path: string;
  name: string;
  parentId: string | null;
}

interface ReviewFileTreeFolderNode extends ReviewFileTreeBaseNode {
  type: "folder";
  childIds: string[];
}

interface ReviewFileTreeFileNode<
  TEntry extends ReviewFileTreeEntry,
> extends ReviewFileTreeBaseNode {
  type: "file";
  entry: TEntry;
}

export type ReviewFileTreeNode<TEntry extends ReviewFileTreeEntry> =
  ReviewFileTreeFolderNode | ReviewFileTreeFileNode<TEntry>;

export interface ReviewFileTreeFlattenedPart {
  id: string;
  label: string;
  path: string;
}

export interface ReviewFileTreeRow<TEntry extends ReviewFileTreeEntry> {
  id: string;
  type: ReviewFileTreeNodeType;
  path: string;
  level: number;
  siblingIndex: number;
  siblingCount: number;
  ancestorIds: string[];
  hasChildren: boolean;
  isExpanded: boolean;
  isFlattenedDirectory: boolean;
  flattenedParts: ReviewFileTreeFlattenedPart[];
  hasLeadingSlash: boolean;
  label: string;
  entry: TEntry | null;
  isSelected: boolean;
  isFocused: boolean;
  isSearchMatch: boolean;
  gitStatus: ReviewFileTreeRowGitStatus;
  containsGitChange: boolean;
  isLocked: boolean;
}

export interface ReviewFileTreeModel<TEntry extends ReviewFileTreeEntry> {
  nodesById: Map<string, ReviewFileTreeNode<TEntry>>;
  pathToId: Map<string, string>;
  idToPath: Map<string, string>;
  rootChildIds: string[];
  defaultExpandedPaths: string[];
}

export interface ReviewFileTreeVisibleStateOptions {
  fileFilterQuery: string;
  expandedPaths: ReadonlySet<string>;
  selectedTreeItemId?: string | null;
  focusedTreeItemId?: string | null;
  gitStatusByPath?: ReadonlyMap<string, GitReviewFileStatus | null>;
  lockedPaths?: ReadonlySet<string>;
}

export interface ReviewFileTreeVisibleState<
  TEntry extends ReviewFileTreeEntry,
> {
  model: ReviewFileTreeModel<TEntry>;
  rows: ReviewFileTreeRow<TEntry>[];
  filteredEntries: TEntry[];
  selectedTreeItemId: string | null;
  focusedTreeItemId: string | null;
}

interface BuildReviewFileTreeRowsInput<TEntry extends ReviewFileTreeEntry> {
  model: ReviewFileTreeModel<TEntry>;
  expandedPaths: ReadonlySet<string>;
  forceExpandAll: boolean;
  selectedTreeItemId: string | null;
  focusedTreeItemId: string | null;
  normalizedQuery: string;
  gitStatusByPath: ReadonlyMap<string, GitReviewFileStatus | null>;
  lockedPaths: ReadonlySet<string>;
}

interface ReviewFileTreeNodeDecorationState {
  gitStatus: ReviewFileTreeRowGitStatus;
  containsGitChange: boolean;
  isLocked: boolean;
}

const REVIEW_FILE_TREE_ROOT_ID = "root";

function splitReviewPath(path: string): {
  hasLeadingSlash: boolean;
  segments: string[];
} {
  const normalizedPath = path.replace(/\\/g, "/");
  const hasLeadingSlash = normalizedPath.startsWith("/");
  const trimmedPath = normalizedPath.replace(/^\/+/, "").replace(/\/+$/, "");
  return {
    hasLeadingSlash,
    segments: trimmedPath.length === 0 ? [] : trimmedPath.split("/"),
  };
}

function joinReviewPath(hasLeadingSlash: boolean, segments: string[]): string {
  if (segments.length === 0) return hasLeadingSlash ? "/" : "";
  return `${hasLeadingSlash ? "/" : ""}${segments.join("/")}`;
}

function createFolderNode(
  path: string,
  name: string,
  parentId: string | null,
): ReviewFileTreeFolderNode {
  return {
    id: `d:${path}`,
    type: "folder",
    path,
    name,
    parentId,
    childIds: [],
  };
}

function createFileNode<TEntry extends ReviewFileTreeEntry>(
  path: string,
  name: string,
  parentId: string | null,
  entry: TEntry,
): ReviewFileTreeFileNode<TEntry> {
  return {
    id: `f:${path}`,
    type: "file",
    path,
    name,
    parentId,
    entry,
  };
}

function appendUniqueChild(
  folder: ReviewFileTreeFolderNode,
  childId: string,
): void {
  if (folder.childIds.includes(childId)) return;
  folder.childIds.push(childId);
}

function getFolderAncestorPaths<TEntry extends ReviewFileTreeEntry>(
  nodesById: Map<string, ReviewFileTreeNode<TEntry>>,
  nodeId: string | null,
): string[] {
  const ancestorPaths: string[] = [];
  let currentId = nodeId;

  while (currentId) {
    const currentNode = nodesById.get(currentId);
    if (!currentNode) break;
    if (currentNode.type === "folder" && currentNode.path.length > 0) {
      ancestorPaths.push(currentNode.path);
    }
    currentId = currentNode.parentId;
  }

  ancestorPaths.reverse();
  return ancestorPaths;
}

function collectDefaultExpandedPaths<TEntry extends ReviewFileTreeEntry>(
  nodesById: Map<string, ReviewFileTreeNode<TEntry>>,
): string[] {
  const expandedPaths: string[] = [];
  for (const node of nodesById.values()) {
    if (node.type !== "folder") continue;
    if (node.path.length === 0) continue;
    if (node.childIds.length === 0) continue;
    expandedPaths.push(node.path);
  }
  return expandedPaths;
}

function mapGitStatus(
  status: GitReviewFileStatus | null | undefined,
): ReviewFileTreeRowGitStatus {
  if (status === "added" || status === "copied" || status === "untracked") {
    return "added";
  }
  if (status === "deleted") {
    return "deleted";
  }
  if (
    status === "modified" ||
    status === "renamed" ||
    status === "type-changed" ||
    status === "unmerged"
  ) {
    return "modified";
  }
  return null;
}

function flattenFolderRow<TEntry extends ReviewFileTreeEntry>(
  nodesById: Map<string, ReviewFileTreeNode<TEntry>>,
  node: ReviewFileTreeFolderNode,
): {
  deepestFolder: ReviewFileTreeFolderNode;
  flattenedParts: ReviewFileTreeFlattenedPart[];
  hasLeadingSlash: boolean;
} {
  const flattenedParts: ReviewFileTreeFlattenedPart[] = [];
  let currentFolder = node;
  const hasLeadingSlash = currentFolder.path.startsWith("/");

  while (true) {
    flattenedParts.push({
      id: currentFolder.id,
      label: currentFolder.name,
      path: currentFolder.path,
    });

    if (currentFolder.childIds.length !== 1) {
      return { deepestFolder: currentFolder, flattenedParts, hasLeadingSlash };
    }

    const child = nodesById.get(currentFolder.childIds[0] ?? "");
    if (!child || child.type !== "folder") {
      return { deepestFolder: currentFolder, flattenedParts, hasLeadingSlash };
    }

    currentFolder = child;
  }
}

function buildDecorationByNodeId<TEntry extends ReviewFileTreeEntry>(
  model: ReviewFileTreeModel<TEntry>,
  gitStatusByPath: ReadonlyMap<string, GitReviewFileStatus | null>,
  lockedPaths: ReadonlySet<string>,
): Map<string, ReviewFileTreeNodeDecorationState> {
  const decorationByNodeId = new Map<
    string,
    ReviewFileTreeNodeDecorationState
  >();

  const visit = (nodeId: string): ReviewFileTreeNodeDecorationState => {
    const cached = decorationByNodeId.get(nodeId);
    if (cached) return cached;

    const node = model.nodesById.get(nodeId);
    if (!node) {
      const emptyState = {
        gitStatus: null,
        containsGitChange: false,
        isLocked: false,
      } satisfies ReviewFileTreeNodeDecorationState;
      decorationByNodeId.set(nodeId, emptyState);
      return emptyState;
    }

    if (node.type === "file") {
      const rawStatus = gitStatusByPath.get(node.path) ?? null;
      const nextState = {
        gitStatus: mapGitStatus(rawStatus),
        containsGitChange: rawStatus !== null,
        isLocked: lockedPaths.has(node.path),
      } satisfies ReviewFileTreeNodeDecorationState;
      decorationByNodeId.set(nodeId, nextState);
      return nextState;
    }

    let containsGitChange = false;
    let isLocked = lockedPaths.has(node.path);

    for (const childId of node.childIds) {
      const childState = visit(childId);
      containsGitChange = containsGitChange || childState.containsGitChange;
      isLocked = isLocked || childState.isLocked;
    }

    const nextState = {
      gitStatus: null,
      containsGitChange,
      isLocked,
    } satisfies ReviewFileTreeNodeDecorationState;
    decorationByNodeId.set(nodeId, nextState);
    return nextState;
  };

  visit(REVIEW_FILE_TREE_ROOT_ID);
  return decorationByNodeId;
}

export function buildReviewFileTreeModel<TEntry extends ReviewFileTreeEntry>(
  entries: readonly TEntry[],
): ReviewFileTreeModel<TEntry> {
  const nodesById = new Map<string, ReviewFileTreeNode<TEntry>>();
  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();
  const rootNode = createFolderNode("", "", null);
  nodesById.set(REVIEW_FILE_TREE_ROOT_ID, {
    ...rootNode,
    id: REVIEW_FILE_TREE_ROOT_ID,
  });
  idToPath.set(REVIEW_FILE_TREE_ROOT_ID, "");

  for (const entry of entries) {
    const { hasLeadingSlash, segments } = splitReviewPath(entry.displayPath);
    if (segments.length === 0) continue;

    let parentId = REVIEW_FILE_TREE_ROOT_ID;
    const folderSegments: string[] = [];

    for (const segment of segments.slice(0, -1)) {
      folderSegments.push(segment);
      const folderPath = joinReviewPath(hasLeadingSlash, folderSegments);
      const folderId = `d:${folderPath}`;
      let folderNode = nodesById.get(folderId);
      if (!folderNode) {
        folderNode = createFolderNode(folderPath, segment, parentId);
        nodesById.set(folderId, folderNode);
        pathToId.set(folderPath, folderId);
        idToPath.set(folderId, folderPath);
      }

      const parentNode = nodesById.get(parentId);
      if (parentNode?.type === "folder") {
        appendUniqueChild(parentNode, folderId);
      }

      parentId = folderId;
    }

    const fileName = segments[segments.length - 1] ?? entry.displayPath;
    const filePath = joinReviewPath(hasLeadingSlash, segments);
    const fileId = `f:${filePath}`;
    const fileNode = createFileNode(filePath, fileName, parentId, entry);
    nodesById.set(fileId, fileNode);
    pathToId.set(filePath, fileId);
    idToPath.set(fileId, filePath);

    const parentNode = nodesById.get(parentId);
    if (parentNode?.type === "folder") {
      appendUniqueChild(parentNode, fileId);
    }
  }

  const rootChildIds = (() => {
    const root = nodesById.get(REVIEW_FILE_TREE_ROOT_ID);
    return root?.type === "folder" ? root.childIds : [];
  })();

  return {
    nodesById,
    pathToId,
    idToPath,
    rootChildIds,
    defaultExpandedPaths: collectDefaultExpandedPaths(nodesById),
  };
}

export function buildReviewFileTreeRows<TEntry extends ReviewFileTreeEntry>(
  input: BuildReviewFileTreeRowsInput<TEntry>,
): ReviewFileTreeRow<TEntry>[] {
  const rows: ReviewFileTreeRow<TEntry>[] = [];
  const {
    model,
    expandedPaths,
    forceExpandAll,
    selectedTreeItemId,
    focusedTreeItemId,
    normalizedQuery,
    gitStatusByPath,
    lockedPaths,
  } = input;
  const decorationByNodeId = buildDecorationByNodeId(
    model,
    gitStatusByPath,
    lockedPaths,
  );

  const visitChildren = (
    childIds: string[],
    level: number,
    ancestorIds: string[],
  ): void => {
    const siblingCount = childIds.length;
    childIds.forEach((childId, childIndex) => {
      const childNode = model.nodesById.get(childId);
      if (!childNode) return;

      if (childNode.type === "file") {
        const decoration = decorationByNodeId.get(childNode.id) ?? {
          gitStatus: null,
          containsGitChange: false,
          isLocked: false,
        };
        const isSearchMatch =
          normalizedQuery.length > 0 &&
          childNode.path.toLowerCase().includes(normalizedQuery);
        rows.push({
          id: childNode.id,
          type: "file",
          path: childNode.path,
          level,
          siblingIndex: childIndex + 1,
          siblingCount,
          ancestorIds,
          hasChildren: false,
          isExpanded: false,
          isFlattenedDirectory: false,
          flattenedParts: [],
          hasLeadingSlash: childNode.path.startsWith("/"),
          label: childNode.name,
          entry: childNode.entry,
          isSelected: childNode.id === selectedTreeItemId,
          isFocused: childNode.id === focusedTreeItemId,
          isSearchMatch,
          gitStatus: decoration.gitStatus,
          containsGitChange: decoration.containsGitChange,
          isLocked: decoration.isLocked,
        });
        return;
      }

      const { deepestFolder, flattenedParts, hasLeadingSlash } =
        flattenFolderRow(model.nodesById, childNode);
      const isExpanded =
        forceExpandAll || expandedPaths.has(deepestFolder.path);
      const decoration = decorationByNodeId.get(deepestFolder.id) ?? {
        gitStatus: null,
        containsGitChange: false,
        isLocked: false,
      };
      const flattenedSearchTarget = flattenedParts
        .map((part) => part.label)
        .join("/");
      const isSearchMatch =
        normalizedQuery.length > 0 &&
        (deepestFolder.path.toLowerCase().includes(normalizedQuery) ||
          flattenedSearchTarget.toLowerCase().includes(normalizedQuery));
      rows.push({
        id: deepestFolder.id,
        type: "folder",
        path: deepestFolder.path,
        level,
        siblingIndex: childIndex + 1,
        siblingCount,
        ancestorIds,
        hasChildren: deepestFolder.childIds.length > 0,
        isExpanded,
        isFlattenedDirectory: flattenedParts.length > 1,
        flattenedParts,
        hasLeadingSlash,
        label: deepestFolder.name,
        entry: null,
        isSelected: deepestFolder.id === selectedTreeItemId,
        isFocused: deepestFolder.id === focusedTreeItemId,
        isSearchMatch,
        gitStatus: decoration.gitStatus,
        containsGitChange: decoration.containsGitChange,
        isLocked: decoration.isLocked,
      });

      if (!isExpanded || deepestFolder.childIds.length === 0) return;
      visitChildren(deepestFolder.childIds, level + 1, [
        ...ancestorIds,
        deepestFolder.id,
      ]);
    });
  };

  visitChildren(model.rootChildIds, 1, []);
  return rows;
}

export function buildReviewFileTreeVisibleState<
  TEntry extends ReviewFileTreeEntry,
>(
  entries: readonly TEntry[],
  options: ReviewFileTreeVisibleStateOptions,
): ReviewFileTreeVisibleState<TEntry> {
  const normalizedQuery = options.fileFilterQuery.trim().toLowerCase();
  const filteredEntries =
    normalizedQuery.length === 0
      ? [...entries]
      : entries.filter((entry) =>
          entry.displayPath.toLowerCase().includes(normalizedQuery),
        );
  const model = buildReviewFileTreeModel(filteredEntries);
  const selectedTreeItemId = options.selectedTreeItemId ?? null;
  const focusedTreeItemId = options.focusedTreeItemId ?? selectedTreeItemId;
  const rows = buildReviewFileTreeRows({
    model,
    expandedPaths: options.expandedPaths,
    forceExpandAll: normalizedQuery.length > 0,
    selectedTreeItemId,
    focusedTreeItemId,
    normalizedQuery,
    gitStatusByPath: options.gitStatusByPath ?? new Map(),
    lockedPaths: options.lockedPaths ?? new Set(),
  });

  return {
    model,
    rows,
    filteredEntries,
    selectedTreeItemId,
    focusedTreeItemId,
  };
}

export function buildReviewFileTreeDefaultExpandedPaths<
  TEntry extends ReviewFileTreeEntry,
>(entries: readonly TEntry[]): string[] {
  return buildReviewFileTreeModel(entries).defaultExpandedPaths;
}

export function buildReviewFileTreeExpandedPathsForSelection<
  TEntry extends ReviewFileTreeEntry,
>(model: ReviewFileTreeModel<TEntry>, selectedPath: string | null): string[] {
  if (!selectedPath) return [];
  const selectedId = model.pathToId.get(selectedPath) ?? null;
  if (!selectedId) return [];
  const selectedNode = model.nodesById.get(selectedId);
  if (!selectedNode) return [];
  return getFolderAncestorPaths(model.nodesById, selectedNode.parentId);
}

export function resolveReviewFileTreeItemIdForPath<
  TEntry extends ReviewFileTreeEntry,
>(model: ReviewFileTreeModel<TEntry>, path: string | null): string | null {
  if (!path) return null;
  return model.pathToId.get(path) ?? null;
}

export function resolveReviewFileTreePathForItemId<
  TEntry extends ReviewFileTreeEntry,
>(model: ReviewFileTreeModel<TEntry>, itemId: string | null): string | null {
  if (!itemId) return null;
  return model.idToPath.get(itemId) ?? null;
}

export function resolveReviewFileTreeSelectedVisibleIndex<
  TEntry extends ReviewFileTreeEntry,
>(
  rows: readonly ReviewFileTreeRow<TEntry>[],
  selectedTreeItemId: string | null,
): number {
  if (!selectedTreeItemId) return -1;
  return rows.findIndex((row) => row.id === selectedTreeItemId);
}
