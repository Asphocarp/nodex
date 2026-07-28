import { describe, expect, test } from "vitest";

import {
  createDefaultWorkbenchLayoutSnapshotV3,
  createDefaultWorkbenchLayoutSnapshotV4,
} from "../workbench-layout";
import { createEmptyWorkbenchSessionView } from "../workbench-session-view";
import {
  WorkbenchLayoutSnapshotV3Schema,
  WorkbenchLayoutSnapshotV4Schema,
} from "./workbench-layout";

describe("WorkbenchLayoutSnapshotSchema", () => {
  test("migrates the v1 Card navigation vocabulary to Page coordinates", () => {
    const current = createDefaultWorkbenchLayoutSnapshotV3();
    const legacyBase: Record<string, unknown> = { ...current };
    delete legacyBase.activePagesTabId;
    delete legacyBase.recentPageSessions;
    delete legacyBase.pageStage;
    const parsed = WorkbenchLayoutSnapshotV3Schema.parse({
      ...legacyBase,
      version: 1,
      focusedStage: "cards",
      activeCardsTabId: "session:legacy",
      recentCardSessions: [{
        id: "legacy",
        projectId: "project-1",
        cardId: "page-1",
        titleSnapshot: "Legacy Page",
        lastOpenedAt: "2026-07-16T00:00:00.000Z",
      }],
      cardStage: {
        open: true,
        projectId: "project-1",
        cardId: "page-1",
      },
      dock: {
        width: 560,
        tree: {
          type: "leaf",
          id: "legacy-leaf",
          tabs: [{ id: "cardstage", kind: "cardstage", title: "Page" }],
          activeTabId: "cardstage",
        },
      },
    });

    expect(parsed).toMatchObject({
      version: 3,
      focusedStage: "pages",
      activePagesTabId: "session:legacy",
      recentPageSessions: [{ pageId: "page-1" }],
      pageStage: { pageId: "page-1" },
      dock: {
        tree: {
          tabs: [{ id: "pagestage", kind: "pagestage" }],
          activeTabId: "pagestage",
        },
      },
    });
  });

  test("migrates the v2 Space order key to Project order", () => {
    const current = createDefaultWorkbenchLayoutSnapshotV3();
    const legacy: Record<string, unknown> = { ...current };
    delete legacy.projectOrder;

    const parsed = WorkbenchLayoutSnapshotV3Schema.parse({
      ...legacy,
      version: 2,
      spaceOrder: ["ops", "default"],
    });

    expect(parsed.projectOrder).toEqual(["ops", "default"]);
    expect(parsed.version).toBe(3);
    expect(parsed.sessionViewsBySessionId).toEqual({});
    expect("spaceOrder" in parsed).toBe(false);
  });

  test("drops retired top-level sidebar section preferences", () => {
    const current = createDefaultWorkbenchLayoutSnapshotV3();
    const parsed = WorkbenchLayoutSnapshotV3Schema.parse({
      ...current,
      sidebar: {
        ...current.sidebar,
        topLevelSectionOrder: ["recents", "pages", "threads", "files"],
        topLevelSections: {
          recents: { visible: false, itemLimit: 5 },
        },
      },
    });

    expect("topLevelSectionOrder" in parsed.sidebar).toBe(false);
    expect("topLevelSections" in parsed.sidebar).toBe(false);
  });
});

describe("WorkbenchLayoutSnapshotV4Schema", () => {
  test("migrates v3 selection and preserves only live window state", () => {
    const legacy = createDefaultWorkbenchLayoutSnapshotV3();
    const sessionView = createEmptyWorkbenchSessionView("session:alpha");
    const parsed = WorkbenchLayoutSnapshotV4Schema.parse({
      ...legacy,
      activeProjectSessionId: "session:alpha",
      dbProjectId: "alpha",
      searchByProject: {
        alpha: "owner:me",
      },
      sessionViewsBySessionId: {
        "session:alpha": sessionView,
      },
      focusedStage: "files",
      projectOrder: ["alpha"],
      recentPageSessions: [{
        id: "recent",
        projectId: "alpha",
        pageId: "page:one",
        titleSnapshot: "Page",
        lastOpenedAt: "2026-07-28T00:00:00.000Z",
      }],
    });

    expect(parsed).toEqual({
      version: 4,
      location: {
        kind: "session",
        activeProjectId: "alpha",
        sessionId: "session:alpha",
      },
      databaseSearchByProject: {
        alpha: "owner:me",
      },
      sessionViewsBySessionId: {
        "session:alpha": sessionView,
      },
    });
    expect("focusedStage" in parsed).toBe(false);
    expect("projectOrder" in parsed).toBe(false);
    expect("recentPageSessions" in parsed).toBe(false);
  });

  test("keeps invalid selected session identity for catalog reconciliation", () => {
    const parsed = WorkbenchLayoutSnapshotV4Schema.parse({
      ...createDefaultWorkbenchLayoutSnapshotV4(),
      location: {
        kind: "session",
        activeProjectId: "alpha",
        sessionId: "session:not-in-catalog",
      },
    });

    expect(parsed.location).toEqual({
      kind: "session",
      activeProjectId: "alpha",
      sessionId: "session:not-in-catalog",
    });
  });

  test("folds a transient pending worktree route to its return location", () => {
    const parsed = WorkbenchLayoutSnapshotV4Schema.parse({
      ...createDefaultWorkbenchLayoutSnapshotV4(),
      location: {
        kind: "pending-worktree",
        clientThreadId: "client:one",
        returnTo: {
          kind: "session",
          activeProjectId: null,
          sessionId: "session:projectless",
        },
      },
    });

    expect(parsed.location).toEqual({
      kind: "session",
      activeProjectId: null,
      sessionId: "session:projectless",
    });
  });

  test("round trips deterministically", () => {
    const input = {
      version: 4,
      location: {
        kind: "library",
        target: {
          kind: "view",
          viewId: "view:alpha",
          accessProjectId: "alpha",
        },
        returnTo: {
          kind: "empty",
          activeProjectId: "alpha",
        },
      },
      databaseSearchByProject: {
        alpha: "status:open",
      },
      sessionViewsBySessionId: {},
    } as const;

    const first = WorkbenchLayoutSnapshotV4Schema.parse(input);
    const second = WorkbenchLayoutSnapshotV4Schema.parse(
      JSON.parse(JSON.stringify(first)),
    );

    expect(second).toEqual(first);
  });
});
