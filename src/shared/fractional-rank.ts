const RANK_WIDTH = 32;
const RANK_MAX = (1n << 128n) - 1n;
export const MAX_FRACTIONAL_RANK_REBALANCE_ITEMS = 100_000;

export interface FractionalRankedItem {
  readonly id: string;
  readonly rankKey: string;
}

export interface FractionalRankPlan {
  readonly rankKey: string;
  /** Existing identities whose internal key must be rewritten first. */
  readonly rebalancedRankKeys: ReadonlyMap<string, string>;
}

export type FractionalRankErrorCode = "anchor_not_found" | "rebalance_limit";

export class FractionalRankError extends Error {
  constructor(
    readonly code: FractionalRankErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FractionalRankError";
  }
}

export const isFractionalRankKey = (value: string): boolean =>
  value.length === RANK_WIDTH && /^[0-9a-f]{32}$/.test(value);

const encodeRank = (value: bigint): string => value.toString(16).padStart(RANK_WIDTH, "0");

const evenlySpacedRank = (index: number, total: number): string =>
  encodeRank((RANK_MAX * BigInt(index + 1)) / BigInt(total + 1));

const rankBetween = (left: string | null, right: string | null): string | null => {
  const leftValue = left === null ? 0n : BigInt(`0x${left}`);
  const rightValue = right === null ? RANK_MAX : BigInt(`0x${right}`);
  if (rightValue - leftValue <= 1n) return null;
  return encodeRank((leftValue + rightValue) / 2n);
};

const requiresRebalance = (items: readonly FractionalRankedItem[]): boolean => {
  let previous: string | null = null;
  for (const item of items) {
    if (!isFractionalRankKey(item.rankKey)) return true;
    if (previous !== null && item.rankKey <= previous) return true;
    previous = item.rankKey;
  }
  return false;
};

const makeRebalancedRanks = (
  items: readonly { readonly id: string }[],
): ReadonlyMap<string, string> => {
  if (items.length > MAX_FRACTIONAL_RANK_REBALANCE_ITEMS) {
    throw new FractionalRankError(
      "rebalance_limit",
      `Fractional order contains ${items.length} items; the bounded rebalance limit is ${MAX_FRACTIONAL_RANK_REBALANCE_ITEMS}`,
    );
  }
  return new Map(items.map((item, index) => [item.id, evenlySpacedRank(index, items.length)]));
};

/**
 * Materialize one complete logical order into canonical, evenly spaced keys.
 * Callers own identity validation; this primitive owns only the bounded rank
 * space and intentionally does not know about persistence or revisions.
 */
export const materializeFractionalRankOrder = (
  itemIds: readonly string[],
): ReadonlyMap<string, string> => makeRebalancedRanks(itemIds.map((id) => ({ id })));

/**
 * Allocate one server-owned key from logical anchor intent. Input order is the
 * current `(rankKey, id)` order. The target is removed before allocation so an
 * update behaves like a move. Legacy/noncanonical keys and exhausted gaps are
 * repaired by a bounded, order-preserving rebalance.
 */
export const planFractionalRank = (input: {
  readonly items: readonly FractionalRankedItem[];
  readonly targetId: string;
  readonly beforeId?: string;
}): FractionalRankPlan => {
  const items = input.items.filter((item) => item.id !== input.targetId);
  let anchorIndex = items.length;
  if (input.beforeId !== undefined) {
    anchorIndex = items.findIndex((item) => item.id === input.beforeId);
    if (anchorIndex < 0) {
      throw new FractionalRankError(
        "anchor_not_found",
        `Fractional order anchor does not exist: ${input.beforeId}`,
      );
    }
  }

  let rebalancedRankKeys: ReadonlyMap<string, string> = new Map();
  let effectiveItems = items;
  if (requiresRebalance(items)) {
    rebalancedRankKeys = makeRebalancedRanks(items);
    effectiveItems = items.map((item) => ({
      id: item.id,
      rankKey: rebalancedRankKeys.get(item.id) ?? item.rankKey,
    }));
  }

  const readRank = (index: number): string | null =>
    index < 0 || index >= effectiveItems.length ? null : (effectiveItems[index]?.rankKey ?? null);
  let rankKey = rankBetween(readRank(anchorIndex - 1), readRank(anchorIndex));
  if (rankKey !== null) return { rankKey, rebalancedRankKeys };

  rebalancedRankKeys = makeRebalancedRanks(items);
  effectiveItems = items.map((item) => ({
    id: item.id,
    rankKey: rebalancedRankKeys.get(item.id) ?? item.rankKey,
  }));
  rankKey = rankBetween(readRank(anchorIndex - 1), readRank(anchorIndex));
  if (rankKey !== null) return { rankKey, rebalancedRankKeys };
  throw new FractionalRankError(
    "rebalance_limit",
    "Fractional rank space remained exhausted after a bounded rebalance",
  );
};
