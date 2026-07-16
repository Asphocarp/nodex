import { describe, expect, test } from "vitest";
import {
  makeDefaultSidebarCollapsibleSectionsState,
  makeDefaultSidebarTopLevelSectionsPrefs,
  moveSidebarTopLevelSection,
  normalizeSidebarCollapsibleSectionsState,
  normalizeSidebarTopLevelSectionOrder,
  normalizeSidebarTopLevelSectionsPrefs,
  resolveVisibleSidebarTopLevelSections,
} from "./sidebar-section-prefs";

describe("sidebar-section-prefs", () => {
  test("normalizes top-level section order and appends missing ids", () => {
    const order = normalizeSidebarTopLevelSectionOrder(["threads", "recents", "threads"]);

    expect(JSON.stringify(order)).toBe(JSON.stringify(["threads", "recents", "pages", "files"]));
  });

  test("normalizes section prefs and falls back to defaults", () => {
    const prefs = normalizeSidebarTopLevelSectionsPrefs({
      recents: { visible: false, itemLimit: 5 },
      pages: { visible: "yes", itemLimit: 999 },
    });

    expect(prefs.recents.visible).toBe(false);
    expect(prefs.recents.itemLimit).toBe(5);
    expect(prefs.pages.visible).toBe(true);
    expect(prefs.pages.itemLimit).toBe(10);
    expect(prefs.threads.visible).toBe(true);
    expect(prefs.files.itemLimit).toBe(10);
  });

  test("normalizes collapsible section state and ignores unknown ids", () => {
    const defaults = makeDefaultSidebarCollapsibleSectionsState();
    const state = normalizeSidebarCollapsibleSectionsState({
      pinned: true,
      projects: "collapsed",
      chats: true,
      custom: true,
    });

    expect(defaults.pinned).toBe(false);
    expect(state.pinned).toBe(true);
    expect(state.projects).toBe(false);
    expect(state.chats).toBe(true);
    expect(JSON.stringify(Object.keys(state))).toBe(JSON.stringify(["pinned", "projects", "chats"]));
  });

  test("resolves visible sections from order and visibility prefs", () => {
    const prefs = makeDefaultSidebarTopLevelSectionsPrefs();
    prefs.pages.visible = false;

    const visible = resolveVisibleSidebarTopLevelSections(["threads", "pages", "recents", "files"], prefs);

    expect(JSON.stringify(visible)).toBe(JSON.stringify(["threads", "recents", "files"]));
  });

  test("moves a visible section relative to visible peers while keeping hidden slots stable", () => {
    const prefs = makeDefaultSidebarTopLevelSectionsPrefs();
    prefs.pages.visible = false;

    const moved = moveSidebarTopLevelSection(["recents", "pages", "threads", "files"], prefs, "recents", 1);

    expect(JSON.stringify(moved)).toBe(JSON.stringify(["threads", "pages", "recents", "files"]));
  });
});
