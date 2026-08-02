import { describe, expect, test } from "vitest";
import {
  normalizeWorkbenchProfilePreferences,
  recordRecentPageLeaveInPreferences,
} from "./use-workbench-profile-preferences";

describe("Workbench profile preferences", () => {
  test("normalizes persisted preferences at the storage boundary", () => {
    const preferences = normalizeWorkbenchProfilePreferences({
      viewsByProject: {
        "project-a": "calendar",
        "project-b": "unsupported",
      },
      sidebar: {
        collapsed: true,
        width: 9_000,
        collapsibleSections: {
          pinned: true,
          chats: true,
        },
      },
      recentPageSessions: [
        {
          id: "recent-a",
          projectId: "project-a",
          pageId: "page-a",
          titleSnapshot: "Page A",
          lastOpenedAt: "2026-07-28T00:00:00.000Z",
        },
        { id: "invalid" },
      ],
    });

    expect(preferences.viewsByProject).toEqual({
      "project-a": "calendar",
    });
    expect(preferences.sidebar).toEqual({
      collapsed: true,
      width: 520,
      collapsibleSections: {
        pinned: true,
        pages: false,
        projects: false,
        chats: true,
      },
    });
    expect(preferences.recentPageSessions).toHaveLength(1);
  });

  test("preserves recent Page identity while refreshing its snapshot", () => {
    const recent = recordRecentPageLeaveInPreferences([
      {
        id: "stable-session",
        projectId: "project-a",
        pageId: "page-a",
        titleSnapshot: "Old title",
        lastOpenedAt: "2026-07-27T00:00:00.000Z",
      },
    ], {
      id: "unused-new-id",
      projectId: "project-a",
      pageId: "page-a",
      titleSnapshot: "New title",
      lastOpenedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(recent).toEqual([
      {
        id: "stable-session",
        projectId: "project-a",
        pageId: "page-a",
        titleSnapshot: "New title",
        lastOpenedAt: "2026-07-28T00:00:00.000Z",
      },
    ]);
  });

  test("keeps the recent Page list bounded", () => {
    const existing = Array.from({ length: 10 }, (_, index) => ({
      id: `recent-${index}`,
      projectId: "project-a",
      pageId: `page-${index}`,
      titleSnapshot: `Page ${index}`,
      lastOpenedAt: "2026-07-27T00:00:00.000Z",
    }));

    const recent = recordRecentPageLeaveInPreferences(existing, {
      id: "new-recent",
      projectId: "project-b",
      pageId: "new-page",
      titleSnapshot: "New Page",
      lastOpenedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(recent).toHaveLength(10);
    expect(recent[0]?.id).toBe("new-recent");
    expect(recent.some((session) => session.id === "recent-9"))
      .toBe(false);
  });
});
