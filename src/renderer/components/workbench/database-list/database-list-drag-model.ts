import type {
  DatabaseListMoveSelectionV2,
  DatabaseListMoveTargetV2,
  DatabaseOperationOutcomeV2,
} from "../../../../shared/database-module-v2";
import {
  applyOptimisticDatabaseListDrop,
  databaseListProjectionPlacementEquals,
  type DatabaseListPageRow,
  type DatabaseListProjectionRow,
  type DatabaseListSelectionState,
} from "./database-list-model";

export interface DatabaseListDragSources {
  readonly initiator: DatabaseListPageRow;
  readonly rootRows: readonly DatabaseListPageRow[];
  readonly visibleClosurePageIds: ReadonlySet<string>;
  readonly previewClosureComplete: boolean;
  readonly concretePageCount: number;
  readonly selection: DatabaseListMoveSelectionV2;
}

export type DatabaseListRawEdge = "before" | "after" | "inside";

export type DatabaseListDragTarget =
  | {
      readonly kind: "page";
      /** The droppable currently under the pointer or keyboard cursor. */
      readonly overOccurrenceKey: string;
      /** The canonical row that owns the one visible insertion indicator. */
      readonly occurrenceKey: string;
      readonly pointerEdge: DatabaseListRawEdge;
      readonly indicatorEdge: "before" | "after" | "inside";
      readonly prospectiveDepth: number;
      readonly target: DatabaseListMoveTargetV2;
    }
  | {
      readonly kind: "group";
      readonly overOccurrenceKey: string;
      readonly occurrenceKey: string;
      readonly prospectiveDepth: 0;
      readonly target: DatabaseListMoveTargetV2;
    };

const isSelected = (
  selection: DatabaseListSelectionState,
  occurrenceKey: string,
): boolean => selection.allMatching
  ? !selection.excludedOccurrenceKeys.has(occurrenceKey)
  : selection.selectedOccurrenceKeys.has(occurrenceKey);

const sameOccurrencePath = (
  left: DatabaseListPageRow,
  right: DatabaseListPageRow,
): boolean => left.groupKey === right.groupKey && left.subgroupKey === right.subgroupKey;

const sameParentOccurrencePath = (
  left: DatabaseListPageRow,
  right: DatabaseListPageRow,
): boolean => sameOccurrencePath(left, right)
  && left.depth === right.depth
  && left.ancestorPageIds.length === right.ancestorPageIds.length
  && left.ancestorPageIds.every(
    (pageId, index) => pageId === right.ancestorPageIds[index],
  );

const directChildOf = (
  child: DatabaseListPageRow,
  parent: DatabaseListPageRow,
): boolean => sameOccurrencePath(child, parent)
  && child.depth === parent.depth + 1
  && child.ancestorPageIds.length === parent.ancestorPageIds.length + 1
  && child.ancestorPageIds[parent.depth] === parent.pageId
  && parent.ancestorPageIds.every(
    (pageId, index) => pageId === child.ancestorPageIds[index],
  );

/**
 * Collapses the two row-half hit regions around one physical sibling gap onto
 * a single `before` slot. If the adjacent row belongs to the moved closure we
 * retain the hit row so the indicator does not jump across the still-mounted
 * source subtree.
 */
const canonicalBeforeRowForAfter = (input: {
  readonly rows: readonly DatabaseListProjectionRow[];
  readonly row: DatabaseListPageRow;
  readonly sources: DatabaseListDragSources;
}): DatabaseListPageRow | null => {
  const rowIndex = input.rows.findIndex((candidate) => candidate.key === input.row.key);
  if (rowIndex < 0) return null;
  const candidateIndex = input.row.hasChildren
    ? rowIndex + 1
    : rowIndex + input.row.subtreeOccurrenceCount;
  const candidate = input.rows[candidateIndex];
  if (!candidate || candidate.kind !== "page") return null;
  const sharesSlot = input.row.hasChildren
    ? directChildOf(candidate, input.row)
    : sameParentOccurrencePath(candidate, input.row);
  if (!sharesSlot || input.sources.visibleClosurePageIds.has(candidate.pageId)) return null;
  return candidate;
};

/**
 * Resolves only the renderer preview roots. Core expands the authoritative
 * concrete closure from the same occurrence selection before committing.
 */
export const resolveDatabaseListDragSources = (input: {
  readonly rows: readonly DatabaseListProjectionRow[];
  readonly selection: DatabaseListSelectionState;
  readonly initiatorOccurrenceKey: string;
}): DatabaseListDragSources | null => {
  const initiator = input.rows.find((row): row is DatabaseListPageRow =>
    row.kind === "page" && row.key === input.initiatorOccurrenceKey
  );
  if (!initiator || initiator.transientKind !== "none") return null;
  const initiatorSelected = isSelected(input.selection, initiator.key);
  const selectedRows = initiatorSelected
    ? input.rows.filter((row): row is DatabaseListPageRow =>
        row.kind === "page"
        && row.transientKind === "none"
        && isSelected(input.selection, row.key)
      )
    : [initiator];
  const rootRows = selectedRows.filter((row) => !selectedRows.some((candidate) =>
    candidate !== row
    && sameOccurrencePath(candidate, row)
    && row.ancestorPageIds.includes(candidate.pageId)
  ));
  const visibleClosurePageIds = new Set<string>();
  let everySubtreeIsFullyVisible = true;
  for (const root of rootRows) {
    const rootIndex = input.rows.findIndex((row) => row.key === root.key);
    if (rootIndex < 0) {
      everySubtreeIsFullyVisible = false;
      continue;
    }
    const subtreeEnd = rootIndex + root.subtreeOccurrenceCount;
    if (subtreeEnd > input.rows.length) everySubtreeIsFullyVisible = false;
    for (let index = rootIndex; index < subtreeEnd; index += 1) {
      const row = input.rows[index];
      if (!row || row.kind !== "page") {
        everySubtreeIsFullyVisible = false;
        continue;
      }
      if (row.transientKind === "none") {
        visibleClosurePageIds.add(row.pageId);
      }
    }
  }
  const concretePageCount = everySubtreeIsFullyVisible
    ? visibleClosurePageIds.size
    : Math.max(
        visibleClosurePageIds.size,
        rootRows.reduce((total, row) => total + row.concreteSubtreePageCount, 0),
      );
  const everySelectedOccurrenceIsVisible = !initiatorSelected
    || (!input.selection.allMatching
      && selectedRows.length === input.selection.selectedOccurrenceKeys.size);
  const previewClosureComplete = everySubtreeIsFullyVisible
    && everySelectedOccurrenceIsVisible;
  const selection: DatabaseListMoveSelectionV2 = initiatorSelected
    ? input.selection.allMatching
      ? {
          kind: "all_matching",
          excludedOccurrenceKeys: [...input.selection.excludedOccurrenceKeys],
        }
      : {
          kind: "explicit",
          occurrenceKeys: [...input.selection.selectedOccurrenceKeys],
        }
    : { kind: "explicit", occurrenceKeys: [initiator.key] };
  return {
    initiator,
    rootRows,
    visibleClosurePageIds,
    previewClosureComplete,
    concretePageCount,
    selection,
  };
};

export const resolveDatabaseListRawEdge = (input: {
  readonly pointerY: number;
  readonly top: number;
  readonly height: number;
  readonly explicitInside: boolean;
}): DatabaseListRawEdge => {
  if (input.explicitInside) return "inside";
  return input.pointerY < input.top + input.height / 2 ? "before" : "after";
};

export const normalizeDatabaseListDropTarget = (input: {
  readonly rows: readonly DatabaseListProjectionRow[];
  readonly row: DatabaseListProjectionRow;
  readonly rawEdge?: DatabaseListRawEdge;
  readonly sources: DatabaseListDragSources;
}): DatabaseListDragTarget | null => {
  const { row, sources } = input;
  if (row.kind === "group" || row.kind === "subgroup") {
    return {
      kind: "group",
      overOccurrenceKey: row.key,
      occurrenceKey: row.key,
      prospectiveDepth: 0,
      target: { kind: "group", occurrenceKey: row.key },
    };
  }
  if (sources.visibleClosurePageIds.has(row.pageId)) return null;
  const rawEdge = input.rawEdge ?? "after";
  const canonicalBeforeRow = rawEdge === "after"
    ? canonicalBeforeRowForAfter({ rows: input.rows, row, sources })
    : null;
  if (canonicalBeforeRow) {
    return {
      kind: "page",
      overOccurrenceKey: row.key,
      occurrenceKey: canonicalBeforeRow.key,
      pointerEdge: rawEdge,
      indicatorEdge: "before",
      prospectiveDepth: canonicalBeforeRow.depth,
      target: {
        kind: "page",
        occurrenceKey: row.key,
        edge: rawEdge,
      },
    };
  }
  const parentAfter = rawEdge === "after" && row.hasChildren;
  return {
    kind: "page",
    overOccurrenceKey: row.key,
    occurrenceKey: row.key,
    pointerEdge: rawEdge,
    indicatorEdge: rawEdge === "inside" ? "inside" : rawEdge,
    prospectiveDepth: rawEdge === "inside" || parentAfter
      ? row.depth + 1
      : row.depth,
    target: {
      kind: "page",
      occurrenceKey: row.key,
      edge: rawEdge,
    },
  };
};

export const databaseListDropTargetIdentity = (
  target: DatabaseListDragTarget | null,
): string => {
  if (target === null) return "none";
  if (target.kind === "group") {
    return JSON.stringify({
      kind: target.kind,
      occurrenceKey: target.occurrenceKey,
      target: target.target,
    });
  }
  return JSON.stringify({
    kind: target.kind,
    occurrenceKey: target.occurrenceKey,
    indicatorEdge: target.indicatorEdge,
    prospectiveDepth: target.prospectiveDepth,
  });
};

export interface DatabaseListDragPreviewPlacement {
  readonly targetOccurrenceKey: string;
  readonly position: "before" | "after" | "nest" | "root";
  readonly groupKey: string | null;
  readonly subgroupKey: string | null;
}

export const resolveDatabaseListDragPreviewPlacement = (input: {
  readonly rows: readonly DatabaseListProjectionRow[];
  readonly target: DatabaseListDragTarget;
}): DatabaseListDragPreviewPlacement | null => {
  const targetRow = input.rows.find((row) => row.key === input.target.occurrenceKey);
  if (!targetRow) return null;
  if (input.target.kind === "group") {
    return {
      targetOccurrenceKey: targetRow.key,
      position: "root",
      groupKey: targetRow.groupKey,
      subgroupKey: targetRow.kind === "subgroup" ? targetRow.subgroupKey : null,
    };
  }
  if (targetRow.kind !== "page") return null;
  return {
    targetOccurrenceKey: targetRow.key,
    position: input.target.indicatorEdge === "inside"
      ? "nest"
      : input.target.indicatorEdge,
    groupKey: targetRow.groupKey,
    subgroupKey: targetRow.subgroupKey,
  };
};

export const databaseListDragTargetChangesPlacement = (input: {
  readonly rows: readonly DatabaseListProjectionRow[];
  readonly sources: DatabaseListDragSources;
  readonly target: DatabaseListDragTarget;
}): boolean => {
  // A bounded or all-matching source can still contain hidden roots. Only Core
  // can prove its placement, so never suppress that semantic operation here.
  if (!input.sources.previewClosureComplete) return true;
  const placement = resolveDatabaseListDragPreviewPlacement(input);
  if (!placement) return false;
  const preview = applyOptimisticDatabaseListDrop({
    rows: input.rows,
    occurrenceKeys: new Set(input.sources.rootRows.map((row) => row.key)),
    targetOccurrenceKey: placement.targetOccurrenceKey,
    position: placement.position,
    groupKey: placement.groupKey,
    subgroupKey: placement.subgroupKey,
  });
  return !databaseListProjectionPlacementEquals(input.rows, preview);
};

type DatabaseListNormalizedMoveTarget = Extract<
  DatabaseOperationOutcomeV2,
  { readonly kind: "list_occurrence_move" }
>["normalizedTarget"];

/**
 * Verifies only canonical roots that are visible in the current bounded
 * projection. Hidden or filtered roots are proven by the receipt commitSeq.
 */
export const databaseListProjectionReflectsMove = (input: {
  readonly rows: readonly DatabaseListProjectionRow[];
  readonly moveRootPageIds: readonly string[];
  readonly normalizedTarget: DatabaseListNormalizedMoveTarget;
}): boolean => {
  const { normalizedTarget } = input;
  const matchingRootIndexes = new Map<string, number>();
  for (const pageId of input.moveRootPageIds) {
    const visible = input.rows.flatMap((row, index) =>
      row.kind === "page"
        && row.transientKind === "none"
        && row.pageId === pageId
        ? [{ row, index }]
        : []
    );
    if (visible.length === 0) continue;
    const matching = visible.find(({ row }) =>
      row.groupKey === normalizedTarget.groupKey
      && row.subgroupKey === normalizedTarget.subgroupKey
      && (row.row.parentPageId ?? null) === normalizedTarget.parentPageId
    );
    if (!matching) return false;
    matchingRootIndexes.set(pageId, matching.index);
  }
  if (!normalizedTarget.beforePageId || matchingRootIndexes.size === 0) return true;
  const beforeIndex = input.rows.findIndex((row) =>
    row.kind === "page"
    && row.transientKind === "none"
    && row.pageId === normalizedTarget.beforePageId
    && row.groupKey === normalizedTarget.groupKey
    && row.subgroupKey === normalizedTarget.subgroupKey
    && (row.row.parentPageId ?? null) === normalizedTarget.parentPageId
  );
  if (beforeIndex < 0) return true;
  return [...matchingRootIndexes.values()].every((index) => index < beforeIndex);
};
