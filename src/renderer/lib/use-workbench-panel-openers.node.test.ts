import { describe, expect, test } from "vitest";

import type { WorkbenchSessionRenderProjection } from "./workbench-session-presentation";
import { findCanvasStageTab } from "./use-workbench-panel-openers";

function makeSession(): Pick<WorkbenchSessionRenderProjection, "tabs"> {
  return {
    tabs: [
      {
        id: "canvas-a",
        sessionId: "session-1",
        projectId: "project-1",
        panelId: "right",
        kind: "canvas_stage",
        title: "Canvas A",
        order: 0,
        config: {
          projectId: "project-1",
          canvasBlockId: "canvas-1",
        },
        browserTabId: null,
        stateKey: 0,
        state: null,
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
      {
        id: "canvas-b",
        sessionId: "session-1",
        projectId: "project-1",
        panelId: "bottom",
        kind: "canvas_stage",
        title: "Canvas B",
        order: 0,
        config: {
          projectId: "project-1",
          canvasBlockId: "canvas-2",
        },
        browserTabId: null,
        stateKey: 0,
        state: null,
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    ],
  };
}

describe("findCanvasStageTab", () => {
  test("deduplicates the same public Canvas identity across panel leaves", () => {
    const session = makeSession();

    expect(findCanvasStageTab(session, "project-1", "canvas-1")?.id)
      .toBe("canvas-a");
    expect(findCanvasStageTab(session, "project-1", "canvas-2")?.id)
      .toBe("canvas-b");
    expect(findCanvasStageTab(session, "project-2", "canvas-1")).toBeNull();
  });
});
