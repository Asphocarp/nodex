import { describe, expect, test } from "vite-plus/test";
import {
  REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX,
  REVIEW_FILE_TREE_FALLBACK_ITEM_HEIGHT_PX,
  REVIEW_FILE_TREE_VIEWPORT_FALLBACK_PX,
  areReviewFileTreeRangesEqual,
  getReviewFileTreeOffset,
  getReviewFileTreeScrollTopForIndex,
  getReviewFileTreeVirtualLayout,
  getReviewFileTreeVirtualRange,
  isReviewFileTreeVirtualizationEnabled,
  resolveReviewFileTreeItemHeight,
} from "./review-file-tree-virtualization";

describe("review file tree virtualization", () => {
  test("computes a stable overscanned range", () => {
    const range = getReviewFileTreeVirtualRange({
      scrollTop: 300,
      viewportHeight: 240,
      offset: 0,
      itemCount: 120,
      itemHeight: REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX,
    });

    expect(range.start).toBe(0);
    expect(range.end).toBe(27);
  });

  test("falls back to a default viewport height when measurement is unavailable", () => {
    const range = getReviewFileTreeVirtualRange({
      scrollTop: 0,
      viewportHeight: 0,
      offset: 0,
      itemCount: 20,
      itemHeight: REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX,
    });

    const expectedVisibleRows = Math.ceil(
      REVIEW_FILE_TREE_VIEWPORT_FALLBACK_PX / REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX,
    );
    expect(range.start).toBe(0);
    expect(range.end).toBe(expectedVisibleRows - 1 + 10);
  });

  test("reuses the previous range when the visible window stays inside it", () => {
    const previousRange = { start: 0, end: 27 };
    const nextRange = getReviewFileTreeVirtualRange(
      {
        scrollTop: 30,
        viewportHeight: 240,
        offset: 0,
        itemCount: 120,
        itemHeight: REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX,
      },
      previousRange,
    );

    expect(areReviewFileTreeRangesEqual(previousRange, nextRange)).toBe(true);
  });

  test("computes offset and window heights for the sticky shell", () => {
    const layout = getReviewFileTreeVirtualLayout({
      range: { start: 10, end: 17 },
      itemCount: 50,
      itemHeight: REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX,
      viewportHeight: 180,
    });

    expect(layout.totalHeight).toBe(1500);
    expect(layout.offsetHeight).toBe(300);
    expect(layout.windowHeight).toBe(240);
    expect(layout.stickyInset).toBe(-60);
  });

  test("scroll target keeps the selected row visible", () => {
    const nextScrollTop = getReviewFileTreeScrollTopForIndex({
      scrollTop: 0,
      viewportHeight: 240,
      offset: 0,
      itemHeight: REVIEW_FILE_TREE_DEFAULT_ITEM_HEIGHT_PX,
      index: 20,
    });

    expect(nextScrollTop).toBe(390);
  });

  test("virtualization enablement respects the threshold", () => {
    expect(isReviewFileTreeVirtualizationEnabled(0, 0)).toBe(false);
    expect(isReviewFileTreeVirtualizationEnabled(5, 10)).toBe(false);
    expect(isReviewFileTreeVirtualizationEnabled(10, 10)).toBe(true);
  });

  test("resolves the row height from the tree host CSS variable", () => {
    document.body.innerHTML = `<div id="tree" style="--trees-row-height: 28px;"></div>`;
    const element = document.getElementById("tree");
    if (!(element instanceof HTMLElement)) {
      throw new Error("Expected a tree host element.");
    }

    expect(resolveReviewFileTreeItemHeight(element)).toBe(28);
  });

  test("falls back to the codex tree row height when no measurement is available", () => {
    expect(resolveReviewFileTreeItemHeight(null)).toBe(REVIEW_FILE_TREE_FALLBACK_ITEM_HEIGHT_PX);
  });

  test("computes the offset between the list node and the scroll container", () => {
    const scrollContainer = document.createElement("div");
    const listNode = document.createElement("div");
    Object.defineProperty(listNode, "offsetTop", { value: 12 });
    Object.defineProperty(listNode, "offsetParent", { value: scrollContainer });

    expect(getReviewFileTreeOffset(listNode, scrollContainer)).toBe(12);
  });
});
