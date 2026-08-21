import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  store: { id: "shared-board-store" },
  deleteBoardPage: vi.fn(),
  moveBoardPage: vi.fn(),
}));

vi.mock("@/lib/board-store", () => ({
  getBoardProjectStore: vi.fn(() => testState.store),
}));

vi.mock("@/lib/board-page-mutation-command", () => ({
  deleteBoardPage: testState.deleteBoardPage,
  moveBoardPage: testState.moveBoardPage,
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
    testState.deleteBoardPage.mockReset().mockResolvedValue(true);
    testState.moveBoardPage.mockReset().mockResolvedValue(true);
  });

  test("delegates delete and move through the selected View store", async () => {
    const handlers = makeRemotePageStageHandlers("project-1", "view-1");

    await handlers.onMove?.("plan", "page-1", "ship");
    await handlers.onDelete?.("ship", "page-1");

    expect(testState.moveBoardPage).toHaveBeenCalledWith(
      expect.objectContaining({
        store: testState.store,
        projectId: "project-1",
        move: {
          pageId: "page-1",
          fromStatus: "plan",
          toStatus: "ship",
        },
      }),
    );
    expect(testState.deleteBoardPage).toHaveBeenCalledWith(
      expect.objectContaining({
        store: testState.store,
        projectId: "project-1",
        columnId: "ship",
        pageId: "page-1",
      }),
    );
  });
});
