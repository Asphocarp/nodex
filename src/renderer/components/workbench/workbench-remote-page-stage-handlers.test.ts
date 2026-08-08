import { beforeEach, describe, expect, test, vi } from "vitest";

const testState = vi.hoisted(() => ({
  store: { id: "shared-board-store" },
  deleteKanbanPage: vi.fn(),
  moveKanbanPage: vi.fn(),
}));

vi.mock("@/lib/kanban-store", () => ({
  getKanbanProjectStore: vi.fn(() => testState.store),
}));

vi.mock("@/lib/kanban-page-mutation-command", () => ({
  deleteKanbanPage: testState.deleteKanbanPage,
  moveKanbanPage: testState.moveKanbanPage,
}));

vi.mock("@/lib/api", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/page-detail-metadata-runtime", () => ({
  isPageMetadataPatch: vi.fn(() => true),
}));
vi.mock("@/lib/page-metadata-board-runtime", () => ({
  commitPageMetadataPatchForBoard: vi.fn(),
}));

import { makeRemotePageStageHandlers } from "./workbench-remote-page-stage-handlers";

describe("remote Page Stage placement commands", () => {
  beforeEach(() => {
    testState.deleteKanbanPage.mockReset().mockResolvedValue(true);
    testState.moveKanbanPage.mockReset().mockResolvedValue(true);
  });

  test("delegates delete and move through the selected View store", async () => {
    const handlers = makeRemotePageStageHandlers("project-1", "view-1");

    await handlers.onMove?.("plan", "page-1", "ship");
    await handlers.onDelete?.("ship", "page-1");

    expect(testState.moveKanbanPage).toHaveBeenCalledWith(expect.objectContaining({
      store: testState.store,
      projectId: "project-1",
      move: {
        pageId: "page-1",
        fromStatus: "plan",
        toStatus: "ship",
      },
    }));
    expect(testState.deleteKanbanPage).toHaveBeenCalledWith(expect.objectContaining({
      store: testState.store,
      projectId: "project-1",
      columnId: "ship",
      pageId: "page-1",
    }));
  });
});
