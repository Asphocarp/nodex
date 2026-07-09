import { describe, expect, test } from "bun:test";
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

    expect(JSON.stringify(order)).toBe(JSON.stringify(["threads", "recents", "cards", "files"]));
  });

  test("normalizes section prefs and falls back to defaults", () => {
    const prefs = normalizeSidebarTopLevelSectionsPrefs({
      recents: { visible: false, itemLimit: 5 },
      cards: { visible: "yes", itemLimit: 999 },
    });

    expect(prefs.recents.visible).toBeFalse();
    expect(prefs.recents.itemLimit).toBe(5);
    expect(prefs.cards.visible).toBeTrue();
    expect(prefs.cards.itemLimit).toBe(10);
    expect(prefs.threads.visible).toBeTrue();
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

    expect(defaults.pinned).toBeFalse();
    expect(state.pinned).toBeTrue();
    expect(state.projects).toBeFalse();
    expect(state.chats).toBeTrue();
    expect(JSON.stringify(Object.keys(state))).toBe(JSON.stringify(["pinned", "projects", "chats"]));
  });

  test("resolves visible sections from order and visibility prefs", () => {
    const prefs = makeDefaultSidebarTopLevelSectionsPrefs();
    prefs.cards.visible = false;

    const visible = resolveVisibleSidebarTopLevelSections(["threads", "cards", "recents", "files"], prefs);

    expect(JSON.stringify(visible)).toBe(JSON.stringify(["threads", "recents", "files"]));
  });

  test("moves a visible section relative to visible peers while keeping hidden slots stable", () => {
    const prefs = makeDefaultSidebarTopLevelSectionsPrefs();
    prefs.cards.visible = false;

    const moved = moveSidebarTopLevelSection(["recents", "cards", "threads", "files"], prefs, "recents", 1);

    expect(JSON.stringify(moved)).toBe(JSON.stringify(["threads", "cards", "recents", "files"]));
  });
});
