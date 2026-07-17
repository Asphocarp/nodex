import { describe, expect, test } from "vitest";
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
    expect(state.pinned).toBe(true);
    expect(state.projects).toBe(false);
    expect(state.chats).toBe(true);
    expect(JSON.stringify(Object.keys(state))).toBe(JSON.stringify(["pinned", "projects", "chats"]));
  });
});
