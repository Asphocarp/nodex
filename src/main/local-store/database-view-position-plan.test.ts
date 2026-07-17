import { describe, expect, test } from "vitest";

import { isDatabaseFractionalRankKey } from "./database-fractional-rank";
import {
  planDatabaseViewPositionRun,
  type DatabaseViewPositionRunPlan,
  type LogicalDatabaseViewPositionItem,
} from "./database-view-position-plan";

const finalOrder = (
  items: readonly LogicalDatabaseViewPositionItem[],
  plan: DatabaseViewPositionRunPlan,
): readonly string[] => {
  const ranks = new Map(items.map((item) => [item.pageId, item.rankKey] as const));
  for (const write of plan.siblingWrites) ranks.set(write.pageId, write.rankKey);
  for (const [pageId, rankKey] of plan.movedRankKeys) ranks.set(pageId, rankKey);
  return [...ranks]
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]))
    .map(([pageId]) => pageId);
};

describe("Database View position run planner", () => {
  test.each([
    {
      name: "nulls-last logical order",
      order: [
        { pageId: "positioned", rankKey: "40000000000000000000000000000000" },
        { pageId: "null-a", rankKey: null },
        { pageId: "null-b", rankKey: null },
      ],
      beforePageId: "null-b",
      expected: ["positioned", "null-a", "moved-a", "moved-b", "null-b"],
    },
    {
      name: "nulls-first logical order",
      order: [
        { pageId: "null-a", rankKey: null },
        { pageId: "null-b", rankKey: null },
        { pageId: "positioned", rankKey: "40000000000000000000000000000000" },
      ],
      beforePageId: "positioned",
      expected: ["null-a", "null-b", "moved-a", "moved-b", "positioned"],
    },
  ])("materializes the complete $name around a logical anchor", ({
    order,
    beforePageId,
    expected,
  }) => {
    const moved = [
      { pageId: "moved-a", rankKey: null },
      { pageId: "moved-b", rankKey: null },
    ];
    const plan = planDatabaseViewPositionRun({
      logicalGroupOrder: [...order, ...moved],
      movedPageIds: moved.map((item) => item.pageId),
      beforePageId,
    });

    expect(finalOrder([...order, ...moved], plan)).toEqual(expected);
    expect(plan.siblingWrites.filter((write) => write.kind === "materialize"))
      .toHaveLength(2);
    expect(
      [...plan.movedRankKeys.values(), ...plan.siblingWrites.map((write) => write.rankKey)]
        .every(isDatabaseFractionalRankKey),
    ).toBe(true);
  });

  test("keeps the localized gap path when every sibling is positioned", () => {
    const items = [
      { pageId: "first", rankKey: "40000000000000000000000000000000" },
      { pageId: "second", rankKey: "80000000000000000000000000000000" },
      { pageId: "moved", rankKey: "c0000000000000000000000000000000" },
    ];
    const plan = planDatabaseViewPositionRun({
      logicalGroupOrder: items,
      movedPageIds: ["moved"],
      beforePageId: "second",
    });

    expect(finalOrder(items, plan)).toEqual(["first", "moved", "second"]);
    expect(plan.siblingWrites).toEqual([]);
  });

  test("returns final moved ranks when a later Page exhausts a dense gap", () => {
    const items = [
      { pageId: "left", rankKey: "00000000000000000000000000000001" },
      { pageId: "right", rankKey: "00000000000000000000000000000003" },
    ];
    const plan = planDatabaseViewPositionRun({
      logicalGroupOrder: items,
      movedPageIds: ["moved-a", "moved-b"],
      beforePageId: "right",
    });

    expect(finalOrder(items, plan)).toEqual([
      "left",
      "moved-a",
      "moved-b",
      "right",
    ]);
  });

  test("preserves visual order while materializing a descending manual View", () => {
    const items = [
      { pageId: "high", rankKey: "c0000000000000000000000000000000" },
      { pageId: "low", rankKey: "40000000000000000000000000000000" },
      { pageId: "unpositioned", rankKey: null },
    ];
    const plan = planDatabaseViewPositionRun({
      logicalGroupOrder: items,
      movedPageIds: ["moved"],
      beforePageId: "low",
      rankDirection: "desc",
    });

    expect([...finalOrder(items, plan)].reverse()).toEqual([
      "high",
      "moved",
      "low",
      "unpositioned",
    ]);
  });
});
