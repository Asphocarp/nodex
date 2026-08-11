import { describe, expect, test } from "vitest";

import type { EffectiveDatabaseViewPresentation } from "../../../shared/database-kernel";
import {
  displayFieldForcedByOrdering,
  reduceDisplayOptionChange,
} from "./database-view-display-options-model";

const effective = (): EffectiveDatabaseViewPresentation => ({
  layout: "list",
  presentation: {
    sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
    group: { propertyId: "status" },
    subgroup: { propertyId: "priority" },
    groupDirection: "asc",
    completion: { range: "all", orderByRecency: false },
    hierarchy: { showSubPages: true, nestedSubPages: false },
    layouts: {
      board: { fields: [{ kind: "property", propertyId: "status" }], showEmptyGroups: true },
      list: { fields: [{ kind: "intrinsic", field: "created_at" }], showEmptyGroups: false },
    },
  },
});

const capabilities = {
  groupablePropertyIds: new Set(["status", "priority", "assignee"]),
};

describe("Database View Display option reducer", () => {
  test("clears a conflicting subgroup while preserving the selected primary group", () => {
    const next = reduceDisplayOptionChange(
      effective(),
      { kind: "set_group", propertyId: "priority" },
      capabilities,
    );
    expect(next.presentation.group).toEqual({ propertyId: "priority" });
    expect(next.presentation.subgroup).toBeNull();
  });

  test("keeps Board and List display preferences independent across layout changes", () => {
    const board = reduceDisplayOptionChange(
      effective(),
      { kind: "set_layout", layout: "board" },
      capabilities,
    );
    const changed = reduceDisplayOptionChange(
      board,
      { kind: "set_show_empty_groups", enabled: false },
      capabilities,
    );
    expect(changed.presentation.layouts.board.showEmptyGroups).toBe(false);
    expect(changed.presentation.layouts.list.showEmptyGroups).toBe(false);
    expect(changed.presentation.layouts.list.fields).toEqual([
      { kind: "intrinsic", field: "created_at" },
    ]);
  });

  test("toggles primary group order independently from row ordering", () => {
    const next = reduceDisplayOptionChange(
      effective(),
      { kind: "toggle_group_direction" },
      capabilities,
    );

    expect(next.presentation.groupDirection).toBe("desc");
    expect(next.presentation.sort[0]?.direction).toBe("asc");
  });

  test("disabling sub-pages also disables nesting and enabling nesting restores visibility", () => {
    const hidden = reduceDisplayOptionChange(
      effective(),
      { kind: "set_show_sub_pages", enabled: false },
      capabilities,
    );
    expect(hidden.presentation.hierarchy).toEqual({
      showSubPages: false,
      nestedSubPages: false,
    });
    const nested = reduceDisplayOptionChange(
      hidden,
      { kind: "set_nested_sub_pages", enabled: true },
      capabilities,
    );
    expect(nested.presentation.hierarchy).toEqual({
      showSubPages: true,
      nestedSubPages: true,
    });
  });

  test("derives only real trailing display fields from ordering", () => {
    expect(displayFieldForcedByOrdering({ kind: "created" })).toEqual({
      kind: "intrinsic",
      field: "created_at",
    });
    expect(displayFieldForcedByOrdering({ kind: "property", propertyId: "priority" }))
      .toEqual({ kind: "property", propertyId: "priority" });
    expect(displayFieldForcedByOrdering({ kind: "title" })).toBeNull();
  });
});
