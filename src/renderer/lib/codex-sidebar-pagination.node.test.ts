import { describe, expect, test } from "vite-plus/test";
import {
  CODEX_SIDEBAR_PAGE_INCREMENT,
  CODEX_SIDEBAR_PROJECT_GROUP_MAX_GROUPS,
  CODEX_SIDEBAR_PROJECTLESS_THREAD_MAX_ITEMS,
  CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
  paginateCodexSidebarItems,
} from "./codex-sidebar-pagination";

function items(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item-${index + 1}`);
}

describe("paginateCodexSidebarItems", () => {
  test("matches Codex project thread page sizes", () => {
    const allItems = items(30);
    const collapsed = paginateCodexSidebarItems({
      items: allItems,
      getKey: (item) => item,
      maxItems: CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
      expanded: false,
      extraPageCount: 1,
    });
    const expandedFirst = paginateCodexSidebarItems({
      items: allItems,
      getKey: (item) => item,
      maxItems: CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
      expanded: true,
      extraPageCount: 1,
    });
    const expandedSecond = paginateCodexSidebarItems({
      items: allItems,
      getKey: (item) => item,
      maxItems: CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
      expanded: true,
      extraPageCount: 2,
    });

    expect(CODEX_SIDEBAR_PAGE_INCREMENT).toBe(10);
    expect(collapsed.visibleItems.length).toBe(5);
    expect(expandedFirst.visibleItems.length).toBe(15);
    expect(expandedSecond.visibleItems.length).toBe(25);
  });

  test("matches Codex project group max count", () => {
    const result = paginateCodexSidebarItems({
      items: items(8),
      getKey: (item) => item,
      maxItems: CODEX_SIDEBAR_PROJECT_GROUP_MAX_GROUPS,
      expanded: false,
      extraPageCount: 1,
    });

    expect(result.visibleItems.length).toBe(5);
    expect(result.showPager).toBe(true);
  });

  test("starts projectless chats at fifty with pager controls", () => {
    const result = paginateCodexSidebarItems({
      items: items(55),
      getKey: (item) => item,
      maxItems: CODEX_SIDEBAR_PROJECTLESS_THREAD_MAX_ITEMS,
      expanded: false,
      extraPageCount: 1,
    });

    expect(result.visibleItems.length).toBe(50);
    expect(result.hiddenItems.length).toBe(5);
    expect(result.showPager).toBe(true);
  });

  test("filters suppressed items before slicing", () => {
    const result = paginateCodexSidebarItems({
      items: items(7),
      getKey: (item) => item,
      maxItems: CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
      expanded: false,
      extraPageCount: 1,
      suppressedKeys: new Set(["item-1", "item-3"]),
    });

    expect(JSON.stringify(result.visibleItems)).toBe(
      JSON.stringify(["item-2", "item-4", "item-5", "item-6", "item-7"]),
    );
    expect(result.showPager).toBe(false);
  });

  test("appends a forced visible overflow item once", () => {
    const result = paginateCodexSidebarItems({
      items: items(8),
      getKey: (item) => item,
      maxItems: CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
      expanded: false,
      extraPageCount: 1,
      forcedVisibleKey: "item-8",
    });

    expect(JSON.stringify(result.visibleItems)).toBe(
      JSON.stringify(["item-1", "item-2", "item-3", "item-4", "item-5", "item-8"]),
    );
    expect(result.showPager).toBe(true);
  });

  test("does not charge a forced visible item against the page quota", () => {
    const result = paginateCodexSidebarItems({
      items: items(8),
      getKey: (item) => item,
      maxItems: CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
      expanded: false,
      extraPageCount: 1,
      forcedVisibleKey: "item-1",
    });

    expect(JSON.stringify(result.visibleItems)).toBe(
      JSON.stringify(["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"]),
    );
    expect(result.showPager).toBe(true);
  });
});
