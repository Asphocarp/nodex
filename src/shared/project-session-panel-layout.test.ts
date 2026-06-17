import { describe, expect, test } from "bun:test";
import type { ProjectSessionPanelLayout } from "./types";
import {
  flattenProjectSessionPanelTabIds,
  findNearestProjectSessionPanelLeafToRight,
  getProjectSessionPanelActiveLeaf,
  getProjectSessionPanelTopLeftLeafId,
  getProjectSessionPanelTopRightLeafId,
  listProjectSessionPanelLeaves,
  makeProjectSessionPanelLayout,
  mergeProjectSessionPanelLeaf,
  moveProjectSessionPanelLeaf,
  moveProjectSessionPanelTab,
  normalizeProjectSessionPanelLayout,
  pruneEmptyProjectSessionPanelLeaves,
  removeProjectSessionPanelTab,
  reorderProjectSessionPanelLeafTabs,
  setProjectSessionPanelBranchRatio,
  splitProjectSessionPanelLeaf,
} from "./project-session-panel-layout";

describe("project session panel layout", () => {
  test("falls back to a v2 layout when the stored layout is missing", () => {
    const normalized = normalizeProjectSessionPanelLayout(null, ["one", "two"], {
      preferredActiveTabId: "two",
    });

    expect(normalized.version).toBe(2);
    expect(normalized.activeLeafId).toBe("main");
    expect(JSON.stringify(normalized.mruLeafIds)).toBe(JSON.stringify(["main"]));
    expect(getProjectSessionPanelActiveLeaf(normalized).activeTabId).toBe("two");
    expect(JSON.stringify(flattenProjectSessionPanelTabIds(normalized))).toBe(JSON.stringify(["one", "two"]));
  });

  test("splits a leaf and moves the selected tab into the new group", () => {
    const layout = makeProjectSessionPanelLayout(["one", "two"], "one");
    const split = splitProjectSessionPanelLeaf(layout, {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    expect(split.root.type).toBe("split");
    expect(split.activeLeafId).toBe("leaf:right");
    expect(JSON.stringify(flattenProjectSessionPanelTabIds(split))).toBe(JSON.stringify(["one", "two"]));
    expect(getProjectSessionPanelActiveLeaf(split).activeTabId).toBe("two");
  });

  test("moves a tab between leaves without duplicating ownership", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two", "three"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "three",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    const moved = moveProjectSessionPanelTab(split, {
      tabId: "one",
      targetLeafId: "leaf:right",
      targetIndex: 0,
    });

    const leaves = listProjectSessionPanelLeaves(moved);
    const main = leaves.find((leaf) => leaf.id === "main");
    const right = leaves.find((leaf) => leaf.id === "leaf:right");
    expect(JSON.stringify(main?.tabIds ?? [])).toBe(JSON.stringify(["two"]));
    expect(JSON.stringify(right?.tabIds ?? [])).toBe(JSON.stringify(["one", "three"]));
    expect(JSON.stringify(flattenProjectSessionPanelTabIds(moved))).toBe(JSON.stringify(["two", "one", "three"]));
  });

  test("reorders one leaf without changing sibling leaf order", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two", "three"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "three",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    const reordered = reorderProjectSessionPanelLeafTabs(split, "main", ["two", "one"]);

    expect(JSON.stringify(flattenProjectSessionPanelTabIds(reordered))).toBe(JSON.stringify(["two", "one", "three"]));
  });

  test("resolves the top-right leaf for single and direct split trees", () => {
    const single = makeProjectSessionPanelLayout(["one"], "one");
    const horizontal = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:horizontal",
    });
    const vertical = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "down",
      tabId: "two",
      newLeafId: "leaf:bottom",
      newBranchId: "branch:vertical",
    });

    expect(getProjectSessionPanelTopRightLeafId(single.root)).toBe("main");
    expect(getProjectSessionPanelTopRightLeafId(horizontal.root)).toBe("leaf:right");
    expect(getProjectSessionPanelTopRightLeafId(vertical.root)).toBe("main");
    expect(getProjectSessionPanelTopLeftLeafId(single.root)).toBe("main");
    expect(getProjectSessionPanelTopLeftLeafId(horizontal.root)).toBe("main");
    expect(getProjectSessionPanelTopLeftLeafId(vertical.root)).toBe("main");
  });

  test("resolves the top-right leaf through nested split trees", () => {
    const baseRightSplit = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two", "three"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "three",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });
    const rightWithTwoTabs = moveProjectSessionPanelTab(baseRightSplit, {
      tabId: "two",
      targetLeafId: "leaf:right",
      targetIndex: 0,
    });
    const rightSplit = splitProjectSessionPanelLeaf(
      rightWithTwoTabs,
      {
        leafId: "leaf:right",
        side: "down",
        tabId: "three",
        newLeafId: "leaf:right-bottom",
        newBranchId: "branch:right",
      },
    );
    const topSplit = splitProjectSessionPanelLeaf(
      splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two", "three"], "one"), {
        leafId: "main",
        side: "down",
        tabId: "three",
        newLeafId: "leaf:bottom",
        newBranchId: "branch:root",
      }),
      {
        leafId: "main",
        side: "right",
        tabId: "two",
        newLeafId: "leaf:top-right",
        newBranchId: "branch:top",
      },
    );

    expect(getProjectSessionPanelTopRightLeafId(rightSplit.root)).toBe("leaf:right");
    expect(getProjectSessionPanelTopRightLeafId(topSplit.root)).toBe("leaf:top-right");
    expect(getProjectSessionPanelTopLeftLeafId(rightSplit.root)).toBe("main");
    expect(getProjectSessionPanelTopLeftLeafId(topSplit.root)).toBe("main");
  });

  test("resolves the nearest leaf to the right for a direct horizontal split", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    expect(findNearestProjectSessionPanelLeafToRight(split, "main")).toBe("leaf:right");
  });

  test("resolves the vertically aligned nearest leaf when multiple right leaves exist", () => {
    const layout: ProjectSessionPanelLayout = {
      version: 2,
      activeLeafId: "leaf:left-top",
      mruLeafIds: ["leaf:left-top"],
      maximizedLeafId: null,
      root: {
        type: "split",
        id: "branch:root",
        direction: "horizontal",
        ratio: 0.5,
        first: {
          type: "split",
          id: "branch:left",
          direction: "vertical",
          ratio: 0.5,
          first: { type: "leaf", id: "leaf:left-top", tabIds: ["one"], activeTabId: "one" },
          second: { type: "leaf", id: "leaf:left-bottom", tabIds: ["two"], activeTabId: "two" },
        },
        second: {
          type: "split",
          id: "branch:right",
          direction: "vertical",
          ratio: 0.5,
          first: { type: "leaf", id: "leaf:right-top", tabIds: ["three"], activeTabId: "three" },
          second: { type: "leaf", id: "leaf:right-bottom", tabIds: ["four"], activeTabId: "four" },
        },
      },
    };

    expect(findNearestProjectSessionPanelLeafToRight(layout, "leaf:left-top")).toBe("leaf:right-top");
    expect(findNearestProjectSessionPanelLeafToRight(layout, "leaf:left-bottom")).toBe("leaf:right-bottom");
  });

  test("does not resolve a right leaf for vertical-only layouts", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "down",
      tabId: "two",
      newLeafId: "leaf:bottom",
      newBranchId: "branch:root",
    });

    expect(findNearestProjectSessionPanelLeafToRight(split, "main")).toBe(null);
  });

  test("returns null when the source leaf is already rightmost", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    expect(findNearestProjectSessionPanelLeafToRight(split, "leaf:right")).toBe(null);
  });

  test("merges a non-empty leaf into its nearest visual neighbor", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    const merged = mergeProjectSessionPanelLeaf(split, "leaf:right");

    expect(listProjectSessionPanelLeaves(merged).length).toBe(1);
    expect(JSON.stringify(flattenProjectSessionPanelTabIds(merged))).toBe(JSON.stringify(["one", "two"]));
  });

  test("clamps branch resize ratios", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    const resized = setProjectSessionPanelBranchRatio(split, "branch:root", 0.99);

    expect(resized.root.type).toBe("split");
    if (resized.root.type === "split") {
      expect(resized.root.ratio).toBe(0.85);
    }
  });

  test("does not split a single-tab leaf into an empty source group", () => {
    const layout = makeProjectSessionPanelLayout(["one"], "one");
    const split = splitProjectSessionPanelLeaf(layout, {
      leafId: "main",
      side: "right",
      tabId: "one",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    expect(split.root.type).toBe("leaf");
    expect(listProjectSessionPanelLeaves(split).length).toBe(1);
    expect(JSON.stringify(flattenProjectSessionPanelTabIds(split))).toBe(JSON.stringify(["one"]));
  });

  test("splits a temporarily unassigned moved tab from a multi-tab target leaf", () => {
    const layout = makeProjectSessionPanelLayout(["one", "two"], "one");
    const withoutDraggedTab = removeProjectSessionPanelTab(layout, "two");
    const split = splitProjectSessionPanelLeaf(withoutDraggedTab, {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });
    const leaves = listProjectSessionPanelLeaves(split);

    expect(leaves.length).toBe(2);
    expect(JSON.stringify(leaves[0]?.tabIds ?? [])).toBe(JSON.stringify(["one"]));
    expect(JSON.stringify(leaves[1]?.tabIds ?? [])).toBe(JSON.stringify(["two"]));
    expect(split.activeLeafId).toBe("leaf:right");
  });

  test("prunes empty split leaves and collapses parent branches", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });
    const emptyRight = removeProjectSessionPanelTab(split, "two");
    const pruned = pruneEmptyProjectSessionPanelLeaves(emptyRight);

    expect(listProjectSessionPanelLeaves(pruned).length).toBe(1);
    expect(pruned.root.type).toBe("leaf");
    expect(JSON.stringify(flattenProjectSessionPanelTabIds(pruned))).toBe(JSON.stringify(["one"]));
  });

  test("keeps one fallback leaf when every leaf is empty", () => {
    const empty = removeProjectSessionPanelTab(makeProjectSessionPanelLayout(["one"], "one"), "one");
    const pruned = pruneEmptyProjectSessionPanelLeaves(empty);
    const leaves = listProjectSessionPanelLeaves(pruned);

    expect(leaves.length).toBe(1);
    expect(JSON.stringify(leaves[0]?.tabIds ?? [])).toBe(JSON.stringify([]));
  });

  test("falls back active and maximized leaf state when pruning the active empty leaf", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });
    const emptyRight = removeProjectSessionPanelTab({
      ...split,
      activeLeafId: "leaf:right",
      maximizedLeafId: "leaf:right",
    }, "two");
    const pruned = pruneEmptyProjectSessionPanelLeaves(emptyRight);

    expect(pruned.activeLeafId).toBe("main");
    expect(pruned.maximizedLeafId ?? null).toBe(null);
    expect(JSON.stringify(pruned.mruLeafIds)).toBe(JSON.stringify(["main"]));
  });

  test("moves a whole single-tab leaf next to a target leaf", () => {
    const split = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });
    const moved = moveProjectSessionPanelLeaf(split, {
      sourceLeafId: "leaf:right",
      targetLeafId: "main",
      side: "left",
      newBranchId: "branch:moved",
    });

    expect(moved.root.type).toBe("split");
    expect(moved.activeLeafId).toBe("leaf:right");
    expect(JSON.stringify(flattenProjectSessionPanelTabIds(moved))).toBe(JSON.stringify(["two", "one"]));
  });
});
