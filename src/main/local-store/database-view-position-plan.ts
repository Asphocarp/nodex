import {
  DatabaseFractionalRankError,
  materializeDatabaseFractionalRankOrder,
  planDatabaseFractionalRank,
  type DatabaseRankedItem,
} from "./database-fractional-rank";

export interface LogicalDatabaseViewPositionItem {
  readonly pageId: string;
  readonly rankKey: string | null;
}

export type DatabaseViewSiblingRankWrite =
  | {
      readonly kind: "materialize";
      readonly pageId: string;
      readonly rankKey: string;
    }
  | {
      readonly kind: "rebalance";
      readonly pageId: string;
      readonly rankKey: string;
    };

export interface DatabaseViewPositionRunPlan {
  readonly movedRankKeys: ReadonlyMap<string, string>;
  readonly siblingWrites: readonly DatabaseViewSiblingRankWrite[];
}

export type DatabaseViewPositionPlanErrorCode =
  | "invalid_input"
  | "anchor_not_found"
  | "rebalance_limit";

export class DatabaseViewPositionPlanError extends Error {
  constructor(
    readonly code: DatabaseViewPositionPlanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DatabaseViewPositionPlanError";
  }
}

const fail = (
  code: DatabaseViewPositionPlanErrorCode,
  message: string,
): never => {
  throw new DatabaseViewPositionPlanError(code, message);
};

const compareRankedItems = (
  left: DatabaseRankedItem,
  right: DatabaseRankedItem,
): number =>
  left.rankKey === right.rankKey
    ? left.id.localeCompare(right.id)
    : left.rankKey.localeCompare(right.rankKey);

const validateUnique = (ids: readonly string[], label: string): void => {
  if (new Set(ids).size === ids.length) return;
  fail("invalid_input", `${label} must contain unique Page IDs`);
};

const planMaterializedRun = (input: {
  readonly remaining: readonly LogicalDatabaseViewPositionItem[];
  readonly movedPageIds: readonly string[];
  readonly physicalPageIds: readonly string[];
}): DatabaseViewPositionRunPlan => {
  let rankKeys: ReadonlyMap<string, string>;
  try {
    rankKeys = materializeDatabaseFractionalRankOrder(input.physicalPageIds);
  } catch (error) {
    if (!(error instanceof DatabaseFractionalRankError)) throw error;
    return fail("rebalance_limit", error.message);
  }

  const movedRankKeys = new Map<string, string>();
  for (const pageId of input.movedPageIds) {
    const rankKey = rankKeys.get(pageId);
    if (!rankKey) return fail("invalid_input", `Rank plan omitted Page ${pageId}`);
    movedRankKeys.set(pageId, rankKey);
  }
  const siblingWrites = input.remaining.flatMap((item) => {
    const rankKey = rankKeys.get(item.pageId);
    if (!rankKey) {
      return fail("invalid_input", `Rank plan omitted Page ${item.pageId}`);
    }
    if (item.rankKey === rankKey) return [];
    return [{
      kind: item.rankKey === null ? "materialize" : "rebalance",
      pageId: item.pageId,
      rankKey,
    } satisfies DatabaseViewSiblingRankWrite];
  });
  return { movedRankKeys, siblingWrites };
};

const planRankedRun = (input: {
  readonly remaining: readonly LogicalDatabaseViewPositionItem[];
  readonly movedPageIds: readonly string[];
  readonly beforePageId?: string;
}): DatabaseViewPositionRunPlan => {
  const originalRanks = new Map(
    input.remaining.map((item) => {
      if (item.rankKey === null) {
        return fail("invalid_input", `Ranked order contains unpositioned Page ${item.pageId}`);
      }
      return [item.pageId, item.rankKey] as const;
    }),
  );
  const effectiveRanks = new Map(originalRanks);
  let virtualItems = [...originalRanks].map(([id, rankKey]) => ({ id, rankKey }));

  try {
    for (const pageId of input.movedPageIds) {
      const plan = planDatabaseFractionalRank({
        items: virtualItems,
        targetId: pageId,
        ...(input.beforePageId === undefined
          ? {}
          : { beforeId: input.beforePageId }),
      });
      for (const [siblingId, rankKey] of plan.rebalancedRankKeys) {
        effectiveRanks.set(siblingId, rankKey);
      }
      effectiveRanks.set(pageId, plan.rankKey);
      virtualItems = [...effectiveRanks]
        .map(([id, rankKey]) => ({ id, rankKey }))
        .sort(compareRankedItems);
    }
  } catch (error) {
    if (!(error instanceof DatabaseFractionalRankError)) throw error;
    return fail(error.code, error.message);
  }

  const finalMovedRankKeys = new Map<string, string>();
  for (const pageId of input.movedPageIds) {
    const rankKey = effectiveRanks.get(pageId);
    if (!rankKey) return fail("invalid_input", `Rank plan omitted Page ${pageId}`);
    finalMovedRankKeys.set(pageId, rankKey);
  }
  const siblingWrites = [...originalRanks].flatMap(([pageId, originalRankKey]) => {
    const rankKey = effectiveRanks.get(pageId);
    if (!rankKey || rankKey === originalRankKey) return [];
    return [{ kind: "rebalance", pageId, rankKey } satisfies DatabaseViewSiblingRankWrite];
  });
  return { movedRankKeys: finalMovedRankKeys, siblingWrites };
};

/**
 * Plans one explicit move against the complete, unfiltered logical group
 * order. Missing positions are legal read state, so the first manual move
 * promotes the complete group order before allocating the moved run.
 */
export const planDatabaseViewPositionRun = (input: {
  readonly logicalGroupOrder: readonly LogicalDatabaseViewPositionItem[];
  readonly movedPageIds: readonly string[];
  readonly beforePageId?: string;
  readonly rankDirection?: "asc" | "desc";
}): DatabaseViewPositionRunPlan => {
  if (input.movedPageIds.length === 0) {
    return fail("invalid_input", "A View position run requires at least one Page");
  }
  validateUnique(input.movedPageIds, "Moved Page set");
  validateUnique(
    input.logicalGroupOrder.map((item) => item.pageId),
    "Logical View group",
  );

  const moved = new Set(input.movedPageIds);
  if (input.beforePageId !== undefined && moved.has(input.beforePageId)) {
    return fail("invalid_input", "View position anchor must be outside the moved Page set");
  }
  const remaining = input.logicalGroupOrder.filter(
    (item) => !moved.has(item.pageId),
  );
  const anchorIndex = input.beforePageId === undefined
    ? remaining.length
    : remaining.findIndex((item) => item.pageId === input.beforePageId);
  if (anchorIndex < 0) {
    return fail(
      "anchor_not_found",
      `View position anchor does not exist in the target group: ${input.beforePageId}`,
    );
  }

  const visualPageIds = remaining.map((item) => item.pageId);
  visualPageIds.splice(anchorIndex, 0, ...input.movedPageIds);
  const descending = input.rankDirection === "desc";
  const physicalPageIds = descending
    ? [...visualPageIds].reverse()
    : visualPageIds;
  const physicalRemaining = descending ? [...remaining].reverse() : remaining;
  const physicalMovedPageIds = descending
    ? [...input.movedPageIds].reverse()
    : input.movedPageIds;
  const physicalMovedIndex = physicalPageIds.findIndex((pageId) => moved.has(pageId));
  const physicalBeforePageId = physicalPageIds[
    physicalMovedIndex + physicalMovedPageIds.length
  ];

  if (remaining.some((item) => item.rankKey === null)) {
    return planMaterializedRun({
      remaining,
      movedPageIds: input.movedPageIds,
      physicalPageIds,
    });
  }
  return planRankedRun({
    remaining: physicalRemaining,
    movedPageIds: physicalMovedPageIds,
    ...(physicalBeforePageId === undefined
      ? {}
      : { beforePageId: physicalBeforePageId }),
  });
};
