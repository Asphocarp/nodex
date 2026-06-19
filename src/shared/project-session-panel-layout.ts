import type {
  ProjectSessionPanelLayout,
  ProjectSessionPanelLayoutV2,
  ProjectSessionPanelNode,
  ProjectSessionPanelSplitSide,
  ProjectSessionSplitBranch,
  ProjectSessionSplitLeaf,
} from "./types";

export const PROJECT_SESSION_PANEL_LAYOUT_VERSION = 2;
export const PROJECT_SESSION_PANEL_MIN_RATIO = 0.15;
export const PROJECT_SESSION_PANEL_MAX_RATIO = 0.85;

interface NormalizePanelLayoutOptions {
  preferredActiveTabId?: string | null;
  preferredActiveLeafId?: string | null;
}

interface SplitPanelLeafInput {
  leafId: string;
  newLeafId: string;
  newBranchId: string;
  side: ProjectSessionPanelSplitSide;
  tabId?: string;
}

interface MovePanelTabInput {
  tabId: string;
  targetLeafId?: string | null;
  targetIndex?: number;
}

interface RemovePanelTabOptions {
  preferredActiveLeafId?: string | null;
  preferredActiveTabId?: string | null;
}

interface PruneEmptyPanelLeavesOptions {
  preserveLeafIds?: readonly string[];
  preferredActiveLeafId?: string | null;
  preferredActiveTabId?: string | null;
}

interface MovePanelLeafInput {
  sourceLeafId: string;
  targetLeafId: string;
  side: ProjectSessionPanelSplitSide;
  newBranchId: string;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(PROJECT_SESSION_PANEL_MAX_RATIO, Math.max(PROJECT_SESSION_PANEL_MIN_RATIO, ratio));
}

function normalizeMruTabIds(
  tabIds: readonly string[],
  activeTabId: string | null,
  mruTabIds: readonly string[] = [],
): string[] {
  const validTabIds = new Set(tabIds);
  const activePrefix = activeTabId && validTabIds.has(activeTabId) ? [activeTabId] : [];
  return uniqueStrings([...activePrefix, ...mruTabIds, ...tabIds])
    .filter((tabId) => validTabIds.has(tabId));
}

function makeLeaf(
  id: string,
  tabIds: string[],
  activeTabId: string | null,
  mruTabIds: readonly string[] = [],
): ProjectSessionSplitLeaf {
  const uniqueTabIds = uniqueStrings(tabIds);
  const resolvedActiveTabId = activeTabId && uniqueTabIds.includes(activeTabId)
    ? activeTabId
    : uniqueTabIds[0] ?? null;
  return {
    type: "leaf",
    id,
    tabIds: uniqueTabIds,
    activeTabId: resolvedActiveTabId,
    mruTabIds: normalizeMruTabIds(uniqueTabIds, resolvedActiveTabId, mruTabIds),
  };
}

export function makeProjectSessionPanelLayout(
  tabIds: readonly string[],
  activeTabId: string | null,
  leafId = "main",
): ProjectSessionPanelLayoutV2 {
  const uniqueTabIds = uniqueStrings(tabIds);
  const leaf = makeLeaf(leafId, uniqueTabIds, activeTabId);
  return {
    version: PROJECT_SESSION_PANEL_LAYOUT_VERSION,
    root: leaf,
    activeLeafId: leaf.id,
    mruLeafIds: [leaf.id],
    maximizedLeafId: null,
  };
}

export function listProjectSessionPanelLeaves(layout: ProjectSessionPanelLayout): ProjectSessionSplitLeaf[] {
  const leaves: ProjectSessionSplitLeaf[] = [];
  const visit = (node: ProjectSessionPanelNode) => {
    if (node.type === "leaf") {
      leaves.push(node);
      return;
    }
    visit(node.first);
    visit(node.second);
  };
  visit(layout.root);
  return leaves;
}

export function getProjectSessionPanelTopRightLeafId(node: ProjectSessionPanelNode): string {
  if (node.type === "leaf") return node.id;
  return getProjectSessionPanelTopRightLeafId(node.direction === "horizontal" ? node.second : node.first);
}

export function getProjectSessionPanelTopLeftLeafId(node: ProjectSessionPanelNode): string {
  if (node.type === "leaf") return node.id;
  return getProjectSessionPanelTopLeftLeafId(node.first);
}

interface PanelLeafRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const RECT_EPSILON = 0.000001;

function collectProjectSessionPanelLeafRects(
  node: ProjectSessionPanelNode,
  rect: Omit<PanelLeafRect, "id">,
): PanelLeafRect[] {
  if (node.type === "leaf") return [{ ...rect, id: node.id }];

  const ratio = clampRatio(node.ratio);
  if (node.direction === "horizontal") {
    const splitX = rect.left + (rect.right - rect.left) * ratio;
    return [
      ...collectProjectSessionPanelLeafRects(node.first, { ...rect, right: splitX }),
      ...collectProjectSessionPanelLeafRects(node.second, { ...rect, left: splitX }),
    ];
  }

  const splitY = rect.top + (rect.bottom - rect.top) * ratio;
  return [
    ...collectProjectSessionPanelLeafRects(node.first, { ...rect, bottom: splitY }),
    ...collectProjectSessionPanelLeafRects(node.second, { ...rect, top: splitY }),
  ];
}

function rectsVerticallyOverlap(left: PanelLeafRect, right: PanelLeafRect): boolean {
  return Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > RECT_EPSILON;
}

export function findNearestProjectSessionPanelLeafToRight(
  layout: ProjectSessionPanelLayout,
  sourceLeafId: string,
): string | null {
  const rects = collectProjectSessionPanelLeafRects(layout.root, {
    left: 0,
    top: 0,
    right: 1,
    bottom: 1,
  });
  const sourceRect = rects.find((rect) => rect.id === sourceLeafId);
  if (!sourceRect) return null;

  const sourceCenterY = (sourceRect.top + sourceRect.bottom) / 2;
  const candidates = rects
    .filter((rect) =>
      rect.id !== sourceLeafId
      && rect.left >= sourceRect.right - RECT_EPSILON
      && rectsVerticallyOverlap(sourceRect, rect)
    )
    .map((rect) => ({
      rect,
      horizontalDistance: Math.max(0, rect.left - sourceRect.right),
      verticalDistance: Math.abs(((rect.top + rect.bottom) / 2) - sourceCenterY),
    }))
    .sort((left, right) =>
      left.horizontalDistance - right.horizontalDistance
      || left.verticalDistance - right.verticalDistance
      || left.rect.top - right.rect.top
      || left.rect.left - right.rect.left
    );

  return candidates[0]?.rect.id ?? null;
}

export function flattenProjectSessionPanelTabIds(layout: ProjectSessionPanelLayout): string[] {
  return listProjectSessionPanelLeaves(layout).flatMap((leaf) => leaf.tabIds);
}

export function findProjectSessionPanelLeaf(
  layout: ProjectSessionPanelLayout,
  leafId: string | null | undefined,
): ProjectSessionSplitLeaf | null {
  if (!leafId) return null;
  return listProjectSessionPanelLeaves(layout).find((leaf) => leaf.id === leafId) ?? null;
}

export function findProjectSessionPanelLeafForTab(
  layout: ProjectSessionPanelLayout,
  tabId: string | null | undefined,
): ProjectSessionSplitLeaf | null {
  if (!tabId) return null;
  return listProjectSessionPanelLeaves(layout).find((leaf) => leaf.tabIds.includes(tabId)) ?? null;
}

export function getProjectSessionPanelActiveLeaf(layout: ProjectSessionPanelLayout): ProjectSessionSplitLeaf {
  const leaves = listProjectSessionPanelLeaves(layout);
  if (leaves.length === 0) {
    return makeLeaf("main", [], null);
  }
  const activeLeaf = leaves.find((leaf) => leaf.id === layout.activeLeafId);
  return activeLeaf ?? leaves[0] ?? makeLeaf("main", [], null);
}

function updateMruLeafIds(layout: ProjectSessionPanelLayoutV2, activeLeafId: string): string[] {
  const validLeafIds = new Set(listProjectSessionPanelLeaves(layout).map((leaf) => leaf.id));
  const next = [activeLeafId, ...layout.mruLeafIds].filter((leafId) => validLeafIds.has(leafId));
  return uniqueStrings(next);
}

function mapNode(
  node: ProjectSessionPanelNode,
  visitor: (node: ProjectSessionPanelNode) => ProjectSessionPanelNode,
): ProjectSessionPanelNode {
  if (node.type === "leaf") return visitor(node);
  return visitor({
    ...node,
    first: mapNode(node.first, visitor),
    second: mapNode(node.second, visitor),
  });
}

function replaceLeaf(
  node: ProjectSessionPanelNode,
  leafId: string,
  replacement: ProjectSessionPanelNode,
): ProjectSessionPanelNode {
  if (node.type === "leaf") return node.id === leafId ? replacement : node;
  return {
    ...node,
    first: replaceLeaf(node.first, leafId, replacement),
    second: replaceLeaf(node.second, leafId, replacement),
  };
}

function normalizeNode(
  node: ProjectSessionPanelNode,
  knownTabIds: Set<string>,
  seenTabIds: Set<string>,
  seenNodeIds: Set<string>,
  nextDuplicateId: () => number,
): ProjectSessionPanelNode {
  const baseId = node.id.trim() || (node.type === "leaf" ? "leaf" : "split");
  const id = seenNodeIds.has(baseId) ? `${baseId}:${nextDuplicateId()}` : baseId;
  seenNodeIds.add(id);

  if (node.type === "leaf") {
    const tabIds: string[] = [];
    for (const tabId of node.tabIds) {
      if (!knownTabIds.has(tabId) || seenTabIds.has(tabId)) continue;
      seenTabIds.add(tabId);
      tabIds.push(tabId);
    }
    return makeLeaf(id, tabIds, node.activeTabId, node.mruTabIds ?? []);
  }

  return {
    type: "split",
    id,
    direction: node.direction === "vertical" ? "vertical" : "horizontal",
    first: normalizeNode(node.first, knownTabIds, seenTabIds, seenNodeIds, nextDuplicateId),
    second: normalizeNode(node.second, knownTabIds, seenTabIds, seenNodeIds, nextDuplicateId),
    ratio: clampRatio(node.ratio),
  };
}

function updateLeafTabs(
  node: ProjectSessionPanelNode,
  leafId: string,
  update: (leaf: ProjectSessionSplitLeaf) => ProjectSessionSplitLeaf,
): ProjectSessionPanelNode {
  return mapNode(node, (candidate) => {
    if (candidate.type !== "leaf" || candidate.id !== leafId) return candidate;
    return update(candidate);
  });
}

function normalizeV2Layout(
  layout: ProjectSessionPanelLayoutV2,
  allTabIds: readonly string[],
  options: NormalizePanelLayoutOptions,
): ProjectSessionPanelLayoutV2 {
  const knownTabIds = new Set(allTabIds);
  const seenTabIds = new Set<string>();
  const seenNodeIds = new Set<string>();
  let duplicateIndex = 0;
  const nextDuplicateId = () => {
    duplicateIndex += 1;
    return duplicateIndex;
  };
  let root = normalizeNode(layout.root, knownTabIds, seenTabIds, seenNodeIds, nextDuplicateId);
  let leaves = listProjectSessionPanelLeaves({ ...layout, root });
  if (leaves.length === 0) {
    root = makeLeaf("main", [], null);
    leaves = listProjectSessionPanelLeaves({ ...layout, root });
  }

  const preferredLeafId =
    options.preferredActiveLeafId
    ?? findProjectSessionPanelLeafForTab({ ...layout, root }, options.preferredActiveTabId)?.id
    ?? layout.activeLeafId
    ?? leaves[0]?.id
    ?? "main";
  const activeLeafId = leaves.some((leaf) => leaf.id === preferredLeafId)
    ? preferredLeafId
    : leaves[0]?.id ?? "main";

  const unassignedTabIds = allTabIds.filter((tabId) => !seenTabIds.has(tabId));
  if (unassignedTabIds.length > 0) {
    root = updateLeafTabs(root, activeLeafId, (leaf) =>
      makeLeaf(
        leaf.id,
        [...leaf.tabIds, ...unassignedTabIds],
        options.preferredActiveTabId && unassignedTabIds.includes(options.preferredActiveTabId)
          ? options.preferredActiveTabId
          : leaf.activeTabId,
        leaf.mruTabIds,
      )
    );
  }

  root = mapNode(root, (node) => {
    if (node.type !== "leaf") return node;
    return makeLeaf(node.id, uniqueStrings(node.tabIds), node.activeTabId, node.mruTabIds);
  });

  const normalized: ProjectSessionPanelLayoutV2 = {
    version: PROJECT_SESSION_PANEL_LAYOUT_VERSION,
    root,
    activeLeafId,
    mruLeafIds: [],
    maximizedLeafId: layout.maximizedLeafId ?? null,
  };
  const validLeafIds = new Set(listProjectSessionPanelLeaves(normalized).map((leaf) => leaf.id));
  const activeFromPreferredTab = options.preferredActiveTabId
    ? findProjectSessionPanelLeafForTab(normalized, options.preferredActiveTabId)?.id
    : null;
  const finalActiveLeafId = activeFromPreferredTab && validLeafIds.has(activeFromPreferredTab)
    ? activeFromPreferredTab
    : validLeafIds.has(activeLeafId)
      ? activeLeafId
      : [...validLeafIds][0] ?? "main";

  return activateNormalizedProjectSessionPanelLeaf(
    {
      ...normalized,
      activeLeafId: finalActiveLeafId,
      mruLeafIds: uniqueStrings([finalActiveLeafId, ...layout.mruLeafIds]).filter((leafId) => validLeafIds.has(leafId)),
      maximizedLeafId: layout.maximizedLeafId && validLeafIds.has(layout.maximizedLeafId)
        ? layout.maximizedLeafId
        : null,
    },
    finalActiveLeafId,
    options.preferredActiveTabId,
  );
}

export function normalizeProjectSessionPanelLayout(
  value: ProjectSessionPanelLayout | null | undefined,
  allTabIds: readonly string[],
  options: NormalizePanelLayoutOptions = {},
): ProjectSessionPanelLayoutV2 {
  const fallback = makeProjectSessionPanelLayout(
    allTabIds,
    options.preferredActiveTabId ?? allTabIds[0] ?? null,
  );
  if (!value) return fallback;
  return normalizeV2Layout(value, allTabIds, options);
}

export function activateProjectSessionPanelLeaf(
  layout: ProjectSessionPanelLayout,
  leafId: string,
  tabId?: string | null,
): ProjectSessionPanelLayoutV2 {
  const normalized = normalizeProjectSessionPanelLayout(layout, flattenProjectSessionPanelTabIds(layout), {
    preferredActiveLeafId: leafId,
    preferredActiveTabId: tabId,
  });
  return activateNormalizedProjectSessionPanelLeaf(normalized, leafId, tabId);
}

function activateNormalizedProjectSessionPanelLeaf(
  normalized: ProjectSessionPanelLayoutV2,
  leafId: string,
  tabId?: string | null,
): ProjectSessionPanelLayoutV2 {
  const targetLeaf = findProjectSessionPanelLeaf(normalized, leafId)
    ?? findProjectSessionPanelLeafForTab(normalized, tabId)
    ?? getProjectSessionPanelActiveLeaf(normalized);
  const activeTabId = tabId && targetLeaf.tabIds.includes(tabId)
    ? tabId
    : targetLeaf.activeTabId;
  const root = updateLeafTabs(normalized.root, targetLeaf.id, (leaf) =>
    makeLeaf(leaf.id, leaf.tabIds, activeTabId, activeTabId ? [activeTabId, ...leaf.mruTabIds] : leaf.mruTabIds)
  );
  const next = {
    ...normalized,
    root,
    activeLeafId: targetLeaf.id,
  };
  return {
    ...next,
    mruLeafIds: updateMruLeafIds(next, targetLeaf.id),
  };
}

export function splitProjectSessionPanelLeaf(
  layout: ProjectSessionPanelLayout,
  input: SplitPanelLeafInput,
): ProjectSessionPanelLayoutV2 {
  const allTabIds = uniqueStrings([
    ...flattenProjectSessionPanelTabIds(layout),
    ...(input.tabId ? [input.tabId] : []),
  ]);
  const normalized = normalizeProjectSessionPanelLayout(layout, allTabIds, {
    preferredActiveLeafId: input.leafId,
    preferredActiveTabId: input.tabId,
  });
  const targetLeaf = findProjectSessionPanelLeaf(normalized, input.leafId);
  if (!targetLeaf) return normalized;
  if (!input.tabId) return normalized;
  if (!targetLeaf.tabIds.includes(input.tabId)) return normalized;
  if (targetLeaf.tabIds.length <= 1) return normalized;

  const targetTabIds = targetLeaf.tabIds.filter((tabId) => tabId !== input.tabId);
  const updatedTarget = makeLeaf(targetLeaf.id, targetTabIds, targetLeaf.activeTabId, targetLeaf.mruTabIds);
  const newLeaf = makeLeaf(input.newLeafId, [input.tabId], input.tabId);
  const direction = input.side === "left" || input.side === "right" ? "horizontal" : "vertical";
  const newBranch: ProjectSessionSplitBranch = {
    type: "split",
    id: input.newBranchId,
    direction,
    first: input.side === "left" || input.side === "up" ? newLeaf : updatedTarget,
    second: input.side === "left" || input.side === "up" ? updatedTarget : newLeaf,
    ratio: 0.5,
  };
  const next = normalizeProjectSessionPanelLayout(
    {
      ...normalized,
      root: replaceLeaf(normalized.root, targetLeaf.id, newBranch),
      activeLeafId: newLeaf.id,
      mruLeafIds: [newLeaf.id, ...normalized.mruLeafIds],
      maximizedLeafId: null,
    },
    flattenProjectSessionPanelTabIds({
      ...normalized,
      root: replaceLeaf(normalized.root, targetLeaf.id, newBranch),
    }),
    {
      preferredActiveLeafId: newLeaf.id,
      preferredActiveTabId: input.tabId ?? null,
    },
  );
  return next;
}

export function moveProjectSessionPanelTab(
  layout: ProjectSessionPanelLayout,
  input: MovePanelTabInput,
): ProjectSessionPanelLayoutV2 {
  const allTabIds = uniqueStrings([...flattenProjectSessionPanelTabIds(layout), input.tabId]);
  const normalized = normalizeProjectSessionPanelLayout(layout, allTabIds, {
    preferredActiveTabId: input.tabId,
    preferredActiveLeafId: input.targetLeafId,
  });
  const targetLeaf = findProjectSessionPanelLeaf(normalized, input.targetLeafId)
    ?? getProjectSessionPanelActiveLeaf(normalized);

  let root = mapNode(normalized.root, (node) => {
    if (node.type !== "leaf") return node;
    const nextIds = node.tabIds.filter((tabId) => tabId !== input.tabId);
    return makeLeaf(node.id, nextIds, node.activeTabId, node.mruTabIds);
  });

  root = updateLeafTabs(root, targetLeaf.id, (leaf) => {
    const base = leaf.tabIds.filter((tabId) => tabId !== input.tabId);
    const targetIndex = Math.min(input.targetIndex ?? base.length, base.length);
    const nextIds = [...base];
    nextIds.splice(targetIndex, 0, input.tabId);
    return makeLeaf(leaf.id, nextIds, input.tabId, [input.tabId, ...leaf.mruTabIds]);
  });

  return normalizeProjectSessionPanelLayout(
    {
      ...normalized,
      root,
      activeLeafId: targetLeaf.id,
      mruLeafIds: [targetLeaf.id, ...normalized.mruLeafIds],
      maximizedLeafId: null,
    },
    allTabIds,
    {
      preferredActiveLeafId: targetLeaf.id,
      preferredActiveTabId: input.tabId,
    },
  );
}

export function reorderProjectSessionPanelLeafTabs(
  layout: ProjectSessionPanelLayout,
  leafId: string,
  orderedTabIds: readonly string[],
): ProjectSessionPanelLayoutV2 {
  const normalized = normalizeProjectSessionPanelLayout(layout, flattenProjectSessionPanelTabIds(layout), {
    preferredActiveLeafId: leafId,
  });
  const leaf = findProjectSessionPanelLeaf(normalized, leafId);
  if (!leaf) return normalized;
  const selected = orderedTabIds.filter((tabId) => leaf.tabIds.includes(tabId));
  const remaining = leaf.tabIds.filter((tabId) => !selected.includes(tabId));
  const finalOrder = [...selected, ...remaining];
  return activateProjectSessionPanelLeaf(
    {
      ...normalized,
      root: updateLeafTabs(normalized.root, leaf.id, (current) =>
        makeLeaf(current.id, finalOrder, current.activeTabId, current.mruTabIds)
      ),
    },
    leaf.id,
    leaf.activeTabId,
  );
}

export function removeProjectSessionPanelTab(
  layout: ProjectSessionPanelLayout,
  tabId: string,
  options: RemovePanelTabOptions = {},
): ProjectSessionPanelLayoutV2 {
  const allTabIds = flattenProjectSessionPanelTabIds(layout).filter((candidate) => candidate !== tabId);
  const normalized = normalizeProjectSessionPanelLayout(layout, allTabIds, options);
  const root = mapNode(normalized.root, (node) => {
    if (node.type !== "leaf") return node;
    const tabIds = node.tabIds.filter((candidate) => candidate !== tabId);
    return makeLeaf(node.id, tabIds, node.activeTabId, node.mruTabIds);
  });
  return normalizeProjectSessionPanelLayout({ ...normalized, root }, allTabIds, options);
}

function removeLeafFromNode(
  node: ProjectSessionPanelNode,
  leafId: string,
): { node: ProjectSessionPanelNode | null; removed: ProjectSessionSplitLeaf | null } {
  if (node.type === "leaf") {
    return node.id === leafId ? { node: null, removed: node } : { node, removed: null };
  }

  const first = removeLeafFromNode(node.first, leafId);
  if (first.removed) {
    return {
      node: first.node ? { ...node, first: first.node } : node.second,
      removed: first.removed,
    };
  }

  const second = removeLeafFromNode(node.second, leafId);
  if (second.removed) {
    return {
      node: second.node ? { ...node, second: second.node } : node.first,
      removed: second.removed,
    };
  }

  return { node, removed: null };
}

export function pruneEmptyProjectSessionPanelLeaves(
  layout: ProjectSessionPanelLayout,
  options: PruneEmptyPanelLeavesOptions = {},
): ProjectSessionPanelLayoutV2 {
  const allTabIds = flattenProjectSessionPanelTabIds(layout);
  const normalized = normalizeProjectSessionPanelLayout(layout, allTabIds, options);
  const leaves = listProjectSessionPanelLeaves(normalized);
  if (leaves.length <= 1) return normalized;

  const preserved = new Set(options.preserveLeafIds ?? []);
  const emptyLeafIds = leaves
    .filter((leaf) => leaf.tabIds.length === 0 && !preserved.has(leaf.id))
    .map((leaf) => leaf.id);
  if (emptyLeafIds.length === 0) return normalized;

  const removableLeafIds = new Set(emptyLeafIds);
  if (leaves.length - removableLeafIds.size <= 0) {
    const fallbackLeaf =
      findProjectSessionPanelLeaf(normalized, options.preferredActiveLeafId)
      ?? findProjectSessionPanelLeafForTab(normalized, options.preferredActiveTabId)
      ?? getProjectSessionPanelActiveLeaf(normalized)
      ?? leaves[0];
    if (fallbackLeaf) removableLeafIds.delete(fallbackLeaf.id);
  }

  let root: ProjectSessionPanelNode | null = normalized.root;
  for (const leafId of removableLeafIds) {
    if (!root) break;
    root = removeLeafFromNode(root, leafId).node;
  }
  if (!root) root = makeLeaf("main", [], null);

  return normalizeProjectSessionPanelLayout(
    {
      ...normalized,
      root,
      maximizedLeafId: normalized.maximizedLeafId && removableLeafIds.has(normalized.maximizedLeafId)
        ? null
        : normalized.maximizedLeafId,
    },
    flattenProjectSessionPanelTabIds({ ...normalized, root }),
    {
      preferredActiveLeafId: options.preferredActiveLeafId ?? normalized.activeLeafId,
      preferredActiveTabId: options.preferredActiveTabId ?? getProjectSessionPanelActiveLeaf(normalized).activeTabId,
    },
  );
}

export function removeProjectSessionPanelLeaf(
  layout: ProjectSessionPanelLayout,
  leafId: string,
): ProjectSessionPanelLayoutV2 {
  const normalized = normalizeProjectSessionPanelLayout(layout, flattenProjectSessionPanelTabIds(layout), {
    preferredActiveLeafId: leafId,
  });
  const leaves = listProjectSessionPanelLeaves(normalized);
  const leaf = leaves.find((candidate) => candidate.id === leafId);
  if (!leaf || leaf.tabIds.length > 0 || leaves.length <= 1) return normalized;

  const removed = removeLeafFromNode(normalized.root, leaf.id);
  if (!removed.node) return normalized;
  return normalizeProjectSessionPanelLayout(
    {
      ...normalized,
      root: removed.node,
      maximizedLeafId: normalized.maximizedLeafId === leaf.id ? null : normalized.maximizedLeafId,
    },
    flattenProjectSessionPanelTabIds({ ...normalized, root: removed.node }),
  );
}

export function moveProjectSessionPanelLeaf(
  layout: ProjectSessionPanelLayout,
  input: MovePanelLeafInput,
): ProjectSessionPanelLayoutV2 {
  const normalized = normalizeProjectSessionPanelLayout(layout, flattenProjectSessionPanelTabIds(layout), {
    preferredActiveLeafId: input.sourceLeafId,
  });
  const sourceLeaf = findProjectSessionPanelLeaf(normalized, input.sourceLeafId);
  const targetLeaf = findProjectSessionPanelLeaf(normalized, input.targetLeafId);
  const leaves = listProjectSessionPanelLeaves(normalized);
  if (!sourceLeaf || !targetLeaf || sourceLeaf.id === targetLeaf.id || leaves.length <= 1) return normalized;

  const removed = removeLeafFromNode(normalized.root, sourceLeaf.id);
  if (!removed.node || !removed.removed) return normalized;

  const direction = input.side === "left" || input.side === "right" ? "horizontal" : "vertical";
  const movedLeaf = removed.removed;
  const newBranch: ProjectSessionSplitBranch = {
    type: "split",
    id: input.newBranchId,
    direction,
    first: input.side === "left" || input.side === "up" ? movedLeaf : targetLeaf,
    second: input.side === "left" || input.side === "up" ? targetLeaf : movedLeaf,
    ratio: 0.5,
  };
  const root = replaceLeaf(removed.node, targetLeaf.id, newBranch);
  return normalizeProjectSessionPanelLayout(
    {
      ...normalized,
      root,
      activeLeafId: movedLeaf.id,
      mruLeafIds: [movedLeaf.id, ...normalized.mruLeafIds.filter((leafId) => leafId !== movedLeaf.id)],
      maximizedLeafId: null,
    },
    flattenProjectSessionPanelTabIds({ ...normalized, root }),
    {
      preferredActiveLeafId: movedLeaf.id,
      preferredActiveTabId: movedLeaf.activeTabId,
    },
  );
}

export function mergeProjectSessionPanelLeaf(
  layout: ProjectSessionPanelLayout,
  leafId: string,
): ProjectSessionPanelLayoutV2 {
  const normalized = normalizeProjectSessionPanelLayout(layout, flattenProjectSessionPanelTabIds(layout), {
    preferredActiveLeafId: leafId,
  });
  const leaves = listProjectSessionPanelLeaves(normalized);
  if (leaves.length <= 1) return normalized;

  const leafIndex = leaves.findIndex((leaf) => leaf.id === leafId);
  if (leafIndex < 0) return normalized;

  const targetLeaf = leaves[leafIndex - 1] ?? leaves[leafIndex + 1] ?? leaves[0];
  if (!targetLeaf || targetLeaf.id === leafId) return normalized;

  const removed = removeLeafFromNode(normalized.root, leafId);
  if (!removed.node || !removed.removed) return normalized;

  const mergedRoot = updateLeafTabs(removed.node, targetLeaf.id, (leaf) =>
    makeLeaf(
      leaf.id,
      uniqueStrings([...leaf.tabIds, ...removed.removed!.tabIds]),
      removed.removed!.activeTabId ?? leaf.activeTabId,
      uniqueStrings([
        ...(removed.removed!.activeTabId ? [removed.removed!.activeTabId] : []),
        ...removed.removed!.mruTabIds,
        ...leaf.mruTabIds,
      ]),
    )
  );
  return normalizeProjectSessionPanelLayout(
    {
      ...normalized,
      root: mergedRoot,
      activeLeafId: targetLeaf.id,
      mruLeafIds: [targetLeaf.id, ...normalized.mruLeafIds.filter((candidate) => candidate !== leafId)],
      maximizedLeafId: normalized.maximizedLeafId === leafId ? null : normalized.maximizedLeafId,
    },
    flattenProjectSessionPanelTabIds({ ...normalized, root: mergedRoot }),
    {
      preferredActiveLeafId: targetLeaf.id,
      preferredActiveTabId: removed.removed.activeTabId,
    },
  );
}

export function setProjectSessionPanelBranchRatio(
  layout: ProjectSessionPanelLayout,
  branchId: string,
  ratio: number,
): ProjectSessionPanelLayoutV2 {
  const normalized = normalizeProjectSessionPanelLayout(layout, flattenProjectSessionPanelTabIds(layout));
  const root = mapNode(normalized.root, (node) => {
    if (node.type !== "split" || node.id !== branchId) return node;
    return {
      ...node,
      ratio: clampRatio(ratio),
    };
  });
  return normalizeProjectSessionPanelLayout({ ...normalized, root }, flattenProjectSessionPanelTabIds(normalized));
}

export function setProjectSessionPanelMaximizedLeaf(
  layout: ProjectSessionPanelLayout,
  leafId: string | null,
): ProjectSessionPanelLayoutV2 {
  const normalized = normalizeProjectSessionPanelLayout(layout, flattenProjectSessionPanelTabIds(layout), {
    preferredActiveLeafId: leafId,
  });
  const maximizedLeafId = leafId && findProjectSessionPanelLeaf(normalized, leafId) ? leafId : null;
  return {
    ...activateProjectSessionPanelLeaf(normalized, maximizedLeafId ?? normalized.activeLeafId),
    maximizedLeafId,
  };
}
