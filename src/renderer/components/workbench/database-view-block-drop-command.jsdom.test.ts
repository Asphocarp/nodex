import { beforeEach, describe, expect, test, vi } from "vitest";
import { createDatabaseViewMutationHistory } from "./database-view-mutation-history";
import { commitDatabaseViewBlockDrop } from "./database-view-block-drop-command";
import type { LocalBlockDragSession } from "./block-transfer/cross-surface-drag";

const mocks = vi.hoisted(() => ({
  transferBlocks: vi.fn(),
  toastDanger: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  transferBlocks: mocks.transferBlocks,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    danger: mocks.toastDanger,
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const session: LocalBlockDragSession = {
  sessionId: "drag-session-missing-participant",
  sourceSurfaceId: "surface-missing-participant",
  payload: {
    version: 2,
    kind: "block_transfer",
    sessionId: "drag-session-missing-participant",
    sourceSurfaceId: "surface-missing-participant",
    projectId: "project-1",
    storeEpoch: "epoch-1",
    source: { kind: "page", pageId: "page-source" },
    rootBlockIds: ["block-source"],
    displayHints: ["paragraph"],
  },
};

describe("Database View Block drop command", () => {
  beforeEach(() => {
    mocks.transferBlocks.mockReset();
    mocks.toastDanger.mockReset();
  });

  test("fails closed when the mounted source editor cannot prepare a causal head", async () => {
    const committed = await commitDatabaseViewBlockDrop({
      session,
      projectId: "project-1",
      storeEpoch: "epoch-1",
      dataSourceId: "data-source-1",
      placement: {
        kind: "direct",
        viewId: "view-1",
        presentationOverride: { layout: "board" },
        groupKey: null,
      },
      altKey: false,
      shiftKey: false,
      mutationHistory: createDatabaseViewMutationHistory("view-1"),
    });

    expect(committed).toBe(false);
    expect(mocks.transferBlocks).not.toHaveBeenCalled();
    expect(mocks.toastDanger).toHaveBeenCalledWith(
      "The dragged Page editor changed; start the drag again.",
    );
  });
});
