import { describe, expect, test } from "vitest";

import { createDefaultWorkbenchLayoutSnapshot } from "../workbench-layout";
import { WorkbenchLayoutSnapshotSchema } from "./workbench-layout";

describe("WorkbenchLayoutSnapshotSchema", () => {
  test("migrates the v1 Card navigation vocabulary to Page coordinates", () => {
    const current = createDefaultWorkbenchLayoutSnapshot();
    const legacyBase: Record<string, unknown> = { ...current };
    delete legacyBase.activePagesTabId;
    delete legacyBase.recentPageSessions;
    delete legacyBase.pageStage;
    const parsed = WorkbenchLayoutSnapshotSchema.parse({
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
      version: 2,
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
    const current = createDefaultWorkbenchLayoutSnapshot();
    const legacy: Record<string, unknown> = { ...current };
    delete legacy.projectOrder;

    const parsed = WorkbenchLayoutSnapshotSchema.parse({
      ...legacy,
      spaceOrder: ["ops", "default"],
    });

    expect(parsed.projectOrder).toEqual(["ops", "default"]);
    expect("spaceOrder" in parsed).toBe(false);
  });
});
