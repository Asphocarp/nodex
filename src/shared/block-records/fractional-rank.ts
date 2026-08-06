const RANK_WIDTH = 32;
const MAX_U128 = (1n << 128n) - 1n;

export interface RankedItem {
  readonly id: string;
  readonly rankKey: string;
}

export interface FractionalRankPlan {
  readonly rankKey: string;
  /**
   * Ranks that need to be rewritten before inserting the new item.  The
   * current BlockRecord operation is intentionally single-row, so callers
   * must reject this result or use a future atomic reorder operation rather
   * than silently losing the rebalance writes.
   */
  readonly rebalancedRankKeys: ReadonlyMap<string, string>;
}

const isFractionalRankKey = (value: string): boolean =>
  value.length === RANK_WIDTH && /^[0-9a-f]+$/.test(value);

const formatRank = (value: bigint): string => value.toString(16).padStart(RANK_WIDTH, "0");

const evenlySpacedRank = (index: number, total: number): string => {
  const divisor = BigInt(total + 1);
  const ordinal = BigInt(index + 1);
  return formatRank(
    (MAX_U128 / divisor) * ordinal
      + ((MAX_U128 % divisor) * ordinal) / divisor,
  );
};

const rebalance = (items: readonly RankedItem[]): ReadonlyMap<string, string> =>
  new Map(items.map((item, index) => [item.id, evenlySpacedRank(index, items.length)]));

const requiresRebalance = (items: readonly RankedItem[]): boolean => {
  let previous: string | undefined;
  for (const item of items) {
    if (!isFractionalRankKey(item.rankKey) || (previous !== undefined && item.rankKey <= previous)) {
      return true;
    }
    previous = item.rankKey;
  }
  return false;
};

const rankBetween = (left: string | undefined, right: string | undefined): string | null => {
  const leftValue = left === undefined ? 0n : BigInt(`0x${left}`);
  const rightValue = right === undefined ? MAX_U128 : BigInt(`0x${right}`);
  const distance = rightValue - leftValue;
  if (distance <= 1n) return null;
  return formatRank(leftValue + distance / 2n);
};

const effectiveItems = (
  items: readonly RankedItem[],
  ranks: ReadonlyMap<string, string>,
): RankedItem[] => items.map((item) => ({
  id: item.id,
  rankKey: ranks.get(item.id) ?? item.rankKey,
}));

/**
 * Computes the same insertion rank as Core's fractional-rank module.
 * `beforeId === undefined` appends to the current sibling sequence.
 */
export const planFractionalRank = (
  sourceItems: readonly RankedItem[],
  targetId: string,
  beforeId?: string,
): FractionalRankPlan => {
  const items = sourceItems.filter((item) => item.id !== targetId);
  const anchorIndex = beforeId === undefined
    ? items.length
    : items.findIndex((item) => item.id === beforeId);
  if (anchorIndex < 0) throw new Error(`Fractional order anchor does not exist: ${beforeId}`);

  let rebalancedRankKeys = new Map<string, string>();
  let ordered = items;
  if (requiresRebalance(items)) {
    rebalancedRankKeys = new Map(rebalance(items));
    ordered = effectiveItems(items, rebalancedRankKeys);
  }

  const rankKey = rankBetween(
    ordered[anchorIndex - 1]?.rankKey,
    ordered[anchorIndex]?.rankKey,
  );
  if (rankKey) return { rankKey, rebalancedRankKeys };

  rebalancedRankKeys = new Map(rebalance(items));
  ordered = effectiveItems(items, rebalancedRankKeys);
  const rebalancedRankKey = rankBetween(
    ordered[anchorIndex - 1]?.rankKey,
    ordered[anchorIndex]?.rankKey,
  );
  if (!rebalancedRankKey) {
    throw new Error("Fractional rank space remained exhausted after rebalance");
  }
  return { rankKey: rebalancedRankKey, rebalancedRankKeys };
};
