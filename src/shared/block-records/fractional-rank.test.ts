import { describe, expect, test } from "vitest";
import { planFractionalRank } from "./fractional-rank";

describe("BlockRecord fractional ranks", () => {
  test("matches the Core append vector", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `item-${index}`,
      rankKey: [
        "1c71c71c71c71c71c71c71c71c71c71c",
        "38e38e38e38e38e38e38e38e38e38e3",
        "55555555555555555555555555555555",
        "71c71c71c71c71c71c71c71c71c71c7",
        "8e38e38e38e38e38e38e38e38e38e38e",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "c71c71c71c71c71c71c71c71c71c71c",
        "e38e38e38e38e38e38e38e38e38e38e",
      ][index]!,
    }));

    expect(planFractionalRank(items, "new").rankKey).toBe(
      "f1c71c71c71c71c71c71c71c71c71c70",
    );
  });

  test("rebases exhausted ranks before inserting", () => {
    const plan = planFractionalRank([
      { id: "left", rankKey: "00000000000000000000000000000001" },
      { id: "right", rankKey: "00000000000000000000000000000002" },
    ], "new", "right");

    expect(plan.rankKey).toBe("7fffffffffffffffffffffffffffffff");
    expect(plan.rebalancedRankKeys.get("left")).toBe(
      "55555555555555555555555555555555",
    );
    expect(plan.rebalancedRankKeys.get("right")).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  test("rejects a missing insertion anchor", () => {
    expect(() => planFractionalRank([], "new", "missing")).toThrow(
      "Fractional order anchor does not exist",
    );
  });
});
