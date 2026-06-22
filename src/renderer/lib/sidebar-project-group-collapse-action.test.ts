import { describe, expect, test } from "bun:test";
import {
  listExpandedVisibleProjectGroupIds,
  listReopenableVisibleProjectGroupIds,
  resolveSidebarProjectGroupCollapseAction,
} from "./sidebar-project-group-collapse-action";

describe("sidebar project group collapse action", () => {
  test("shows Collapse all only when more than one visible group is expanded", () => {
    const visibleGroupIds = ["alpha", "beta", "gamma"];

    expect(resolveSidebarProjectGroupCollapseAction({
      visibleGroupIds,
      expandedGroupIds: new Set(["alpha", "beta"]),
      previouslyExpandedGroupIds: [],
    })).toBe("collapse-all");

    expect(resolveSidebarProjectGroupCollapseAction({
      visibleGroupIds,
      expandedGroupIds: new Set(["alpha"]),
      previouslyExpandedGroupIds: [],
    })).toBe(null);
  });

  test("shows Reopen previous after all visible groups from the previous collapse are closed", () => {
    expect(resolveSidebarProjectGroupCollapseAction({
      visibleGroupIds: ["alpha", "beta"],
      expandedGroupIds: new Set(),
      previouslyExpandedGroupIds: ["alpha", "beta"],
    })).toBe("reopen-previous");

    expect(resolveSidebarProjectGroupCollapseAction({
      visibleGroupIds: ["alpha", "beta"],
      expandedGroupIds: new Set(["alpha"]),
      previouslyExpandedGroupIds: ["alpha", "beta"],
    })).toBe(null);
  });

  test("filters action inputs to visible project groups", () => {
    expect(JSON.stringify(listExpandedVisibleProjectGroupIds(
      ["alpha", "beta"],
      new Set(["alpha", "hidden"]),
    ))).toBe(JSON.stringify(["alpha"]));

    expect(JSON.stringify(listReopenableVisibleProjectGroupIds(
      ["alpha", "beta"],
      ["hidden", "beta"],
    ))).toBe(JSON.stringify(["beta"]));
  });
});
