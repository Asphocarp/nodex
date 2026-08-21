import { describe, expect, test } from "vite-plus/test";
import {
  makeDefaultSidebarCollapsibleSectionsState,
  normalizeSidebarCollapsibleSectionsState,
} from "./sidebar-section-prefs";

describe("sidebar-section-prefs", () => {
  test("normalizes collapsible section state and ignores unknown ids", () => {
    const defaults = makeDefaultSidebarCollapsibleSectionsState();
    const state = normalizeSidebarCollapsibleSectionsState({
      pinned: true,
      projects: "collapsed",
      chats: true,
      custom: true,
    });

    expect(defaults.pinned).toBe(false);
    expect(defaults.pages).toBe(false);
    expect(state.pinned).toBe(true);
    expect(state.projects).toBe(false);
    expect(state.chats).toBe(true);
    expect(JSON.stringify(Object.keys(state))).toBe(
      JSON.stringify(["pinned", "pages", "projects", "chats"]),
    );
  });

  test("migrates the retired Library collapse preference to Pages", () => {
    expect(normalizeSidebarCollapsibleSectionsState({ library: true }).pages).toBe(true);
  });
});
