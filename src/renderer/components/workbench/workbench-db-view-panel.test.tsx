import { describe, expect, test } from "vitest";

import type { EffectiveDatabaseViewPresentation } from "../../../shared/database-kernel";
import { classicBoardPresentation } from "@/lib/classic-board-adapter";

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

describe("classicBoardPresentation", () => {
  test("adapts Page key as identity without changing the canonical Board presenter", () => {
    const adapted = classicBoardPresentation(boardPresentation({
      layouts: {
        board: {
          fields: [
            { kind: "intrinsic", field: "page_key" },
            { kind: "property", propertyId: "tags" },
            { kind: "property", propertyId: "priority" },
            { kind: "property", propertyId: "status" },
          ],
          showEmptyGroups: false,
        },
        list: { fields: [], showEmptyGroups: false },
      },
    }));

    expect(adapted?.identity).toEqual({ showPageKey: true, showDescription: true });
    expect(adapted?.prefs.display.propertyOrder).toEqual(["tags", "priority"]);
    expect(adapted?.prefs.display.hiddenProperties).toEqual([
      "estimate",
      "assignee",
    ]);
    expect(adapted?.prefs.rules.sort).toEqual([{
      field: "board-order",
      direction: "asc",
    }]);
  });

  test("keeps the canonical presenter when Page key is hidden", () => {
    expect(classicBoardPresentation(boardPresentation())?.identity).toEqual({
      showPageKey: false,
      showDescription: true,
    });
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
    expect(classicBoardPresentation(boardPresentation(overrides))).toBeNull();
  });
});
