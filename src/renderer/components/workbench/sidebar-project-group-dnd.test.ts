import { describe, expect, test } from "bun:test";
import {
  moveSidebarGroupBefore,
  replaceVisibleOrder,
  resolveSidebarGroupDropTarget,
} from "./sidebar-project-group-dnd";

const SOURCE_RECT = { top: 60, bottom: 90 };
const TARGET_RECT = { top: 0, bottom: 30 };

describe("project group insertion targeting", () => {
  test("places the insertion target before the hovered row above its midpoint", () => {
    const target = resolveSidebarGroupDropTarget({
      groupIds: ["alpha", "beta", "gamma"],
      activeGroupId: "gamma",
      overGroupId: "alpha",
      activeRect: SOURCE_RECT,
      overRect: TARGET_RECT,
      pointerY: 4,
    });

    expect(target?.beforeGroupId).toBe("alpha");
    expect(JSON.stringify(moveSidebarGroupBefore(
      ["alpha", "beta", "gamma"],
      "gamma",
      target?.beforeGroupId ?? null,
    ))).toBe(JSON.stringify(["gamma", "alpha", "beta"]));
  });

  test("places the insertion target after the hovered row below its midpoint", () => {
    const target = resolveSidebarGroupDropTarget({
      groupIds: ["alpha", "beta", "gamma"],
      activeGroupId: "gamma",
      overGroupId: "alpha",
      activeRect: SOURCE_RECT,
      overRect: TARGET_RECT,
      pointerY: 26,
    });

    expect(target?.beforeGroupId).toBe("beta");
  });

  test("uses the translated active midpoint for keyboard sorting", () => {
    const target = resolveSidebarGroupDropTarget({
      groupIds: ["alpha", "beta", "gamma"],
      activeGroupId: "gamma",
      overGroupId: "alpha",
      activeRect: { top: 2, bottom: 28 },
      overRect: TARGET_RECT,
      pointerY: null,
    });

    expect(target?.beforeGroupId).toBe("beta");
  });

  test("suppresses an indicator and write when the resolved order is unchanged", () => {
    const target = resolveSidebarGroupDropTarget({
      groupIds: ["alpha", "beta", "gamma"],
      activeGroupId: "gamma",
      overGroupId: "beta",
      activeRect: SOURCE_RECT,
      overRect: { top: 30, bottom: 60 },
      pointerY: 58,
    });

    expect(target).toBe(null);
  });
});

describe("replaceVisibleOrder", () => {
  test("replaces only visible project ids inside the full order", () => {
    const result = replaceVisibleOrder(
      ["pinned-a", "alpha", "pinned-b", "beta", "gamma"],
      ["alpha", "beta"],
      ["beta", "alpha"],
    );

    expect(JSON.stringify(result)).toBe(JSON.stringify([
      "pinned-a",
      "beta",
      "pinned-b",
      "alpha",
      "gamma",
    ]));
  });

  test("keeps the current order when the visible id set changes", () => {
    const current = ["alpha", "beta", "gamma"];
    const result = replaceVisibleOrder(current, ["alpha", "beta"], ["beta", "delta"]);

    expect(JSON.stringify(result)).toBe(JSON.stringify(current));
  });
});
