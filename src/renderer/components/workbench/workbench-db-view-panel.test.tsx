import { describe, expect, test } from "vitest";

import type { EffectiveDatabaseViewPresentation } from "../../../shared/database-kernel";
import { classicBoardPreferences } from "@/lib/classic-board-adapter";

const boardPresentation = (
  overrides: Partial<EffectiveDatabaseViewPresentation["presentation"]> = {},
): EffectiveDatabaseViewPresentation => ({
  layout: "board",
  presentation: {
    sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
    group: { propertyId: "status" },
    subgroup: null,
    groupDirection: "asc",
    completion: { range: "all", orderByRecency: false },
    hierarchy: { showSubPages: true, nestedSubPages: false },
    layouts: {
      board: {
        fields: [
          { kind: "property", propertyId: "tags" },
          { kind: "property", propertyId: "priority" },
          { kind: "property", propertyId: "status" },
        ],
        showEmptyGroups: false,
      },
      list: { fields: [], showEmptyGroups: false },
    },
    ...overrides,
  },
});

describe("classicBoardPreferences", () => {
  test("adapts canonical Status Board fields without changing its presenter", () => {
    const preferences = classicBoardPreferences(boardPresentation());

    expect(preferences?.display.propertyOrder).toEqual(["tags", "priority"]);
    expect(preferences?.display.hiddenProperties).toEqual([
      "estimate",
      "assignee",
    ]);
    expect(preferences?.rules.sort).toEqual([{
      field: "board-order",
      direction: "asc",
    }]);
  });

  test.each([
    ["another grouping", { group: { propertyId: "priority" } }],
    ["a subgroup", { subgroup: { propertyId: "priority" } }],
    ["an unsupported field", {
      layouts: {
        board: {
          fields: [{ kind: "intrinsic", field: "created_at" }],
          showEmptyGroups: false,
        },
        list: { fields: [], showEmptyGroups: false },
      },
    }],
  ] satisfies ReadonlyArray<readonly [
    string,
    Partial<EffectiveDatabaseViewPresentation["presentation"]>,
  ]>)("keeps the generic renderer for %s", (_name, overrides) => {
    expect(classicBoardPreferences(boardPresentation(overrides))).toBeNull();
  });
});
