import { describe, expect, test } from "bun:test";
import {
  DatabaseFractionalRankError,
  MAX_DATABASE_RANK_REBALANCE_ITEMS,
  isDatabaseFractionalRankKey,
  planDatabaseFractionalRank,
} from "./database-fractional-rank";

describe("Database fractional rank planner", () => {
  test("allocates by logical anchor without trusting a caller rank", () => {
    const first = planDatabaseFractionalRank({
      items: [],
      targetId: "a",
    });
    const second = planDatabaseFractionalRank({
      items: [{ id: "a", rankKey: first.rankKey }],
      targetId: "b",
      beforeId: "a",
    });
    expect(isDatabaseFractionalRankKey(first.rankKey)).toBeTrue();
    expect(isDatabaseFractionalRankKey(second.rankKey)).toBeTrue();
    expect(second.rankKey < first.rankKey).toBeTrue();
  });

  test("order-preservingly rebalances legacy, duplicate, and exhausted keys", () => {
    const legacy = planDatabaseFractionalRank({
      items: [
        { id: "a", rankKey: "legacy" },
        { id: "b", rankKey: "legacy" },
      ],
      targetId: "c",
      beforeId: "b",
    });
    expect(legacy.rebalancedRankKeys.size).toBe(2);
    expect(
      (legacy.rebalancedRankKeys.get("a") ?? "") < legacy.rankKey,
    ).toBeTrue();
    expect(
      legacy.rankKey < (legacy.rebalancedRankKeys.get("b") ?? ""),
    ).toBeTrue();

    const exhausted = planDatabaseFractionalRank({
      items: [
        { id: "a", rankKey: "00000000000000000000000000000001" },
        { id: "b", rankKey: "00000000000000000000000000000002" },
      ],
      targetId: "c",
      beforeId: "b",
    });
    expect(exhausted.rebalancedRankKeys.size).toBe(2);
  });

  test("has a deterministic bounded rebalance failure", () => {
    const items = Array.from(
      { length: MAX_DATABASE_RANK_REBALANCE_ITEMS + 1 },
      (_, index) => ({ id: `item-${index}`, rankKey: "legacy" }),
    );
    let code = "";
    try {
      planDatabaseFractionalRank({ items, targetId: "target" });
    } catch (error) {
      if (error instanceof DatabaseFractionalRankError) code = error.code;
    }
    expect(code).toBe("rebalance_limit");
  });
});
