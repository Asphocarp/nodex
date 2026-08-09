import { beforeEach, describe, expect, test, vi } from "vitest";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import type { DataSourcePropertyRecordV2 } from "../../shared/database-module-v2";
import type { BoardSummary, DatabasePage } from "./types";

const state = vi.hoisted(() => ({
  snapshot: { databaseView: null } as { databaseView: null | {
    primaryWriteCompatible: boolean;
    readOnlyReason?: string | null;
    query: { properties: DataSourcePropertyRecordV2[] };
  } },
  setError: vi.fn(),
  fetchBoard: vi.fn(),
  runOptimisticMutation: vi.fn(),
  applyRemoteCard: vi.fn(),
  setDatabaseRowDetail: vi.fn(),
  commitPageLifecycleIntent: vi.fn(),
}));

vi.mock("./kanban-store", () => ({
  getKanbanProjectStore: () => ({
    getSnapshot: () => state.snapshot,
    setError: state.setError,
    fetchBoard: state.fetchBoard,
    runOptimisticMutation: state.runOptimisticMutation,
    applyRemoteCard: state.applyRemoteCard,
  }),
}));

vi.mock("./database-row-detail-store", () => ({
  setDatabaseRowDetail: state.setDatabaseRowDetail,
}));

vi.mock("./page-lifecycle-runtime", () => ({
  commitPageLifecycleIntent: state.commitPageLifecycleIntent,
}));

import { createKanbanPage } from "./kanban-page-create-command";

const page: DatabasePage = {
  id: "0198a4f1-b850-7000-8000-000000000001",
  status: "plan",
  archived: false,
  title: "Created Page",
  richTitle: plainTextToPortableRichText("Created Page"),
  description: "",
  tags: [],
  created: new Date("2026-08-08T00:00:00.000Z"),
  order: 0,
};

describe("createKanbanPage", () => {
  beforeEach(() => {
    state.snapshot = {
      databaseView: {
        primaryWriteCompatible: true,
        readOnlyReason: null,
        query: { properties: [] },
      },
    };
    state.setError.mockReset();
    state.fetchBoard.mockReset();
    state.runOptimisticMutation.mockReset().mockImplementation(
      async (options: { runRemote: () => Promise<DatabasePage> }) => ({
        ok: true,
        result: await options.runRemote(),
      }),
    );
    state.applyRemoteCard.mockReset();
    state.setDatabaseRowDetail.mockReset();
    state.commitPageLifecycleIntent.mockReset().mockResolvedValue({
      boardProjection: page,
    });
  });

  test("preserves the optimistic-to-canonical create boundary without a mounted Board", async () => {
    const result = await createKanbanPage({
      projectId: "project-test",
      databaseViewId: "view-test",
      clientSessionId: "session-test",
      status: "plan",
      input: {
        title: "Created Page",
        priority: "p1-high",
        estimate: "m",
        tags: ["Product"],
      },
      placement: "top",
    });

    expect(result).toEqual({ status: "created", page });
    expect(state.commitPageLifecycleIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "create",
      projectId: "project-test",
      clientSessionId: "session-test",
      status: "plan",
      placement: "top",
      input: expect.objectContaining({
        title: "Created Page",
        priority: undefined,
        estimate: undefined,
        tags: [],
      }),
    }));
    const optimisticMutation = state.runOptimisticMutation.mock.calls[0]?.[0] as {
      apply: (board: BoardSummary) => BoardSummary;
    };
    const optimisticBoard = optimisticMutation.apply({
      columns: [{ id: "plan", name: "Plan", cards: [] }],
    });
    expect(optimisticBoard.columns[0]?.cards[0]?.status).toBe("plan");
    expect(state.setDatabaseRowDetail).toHaveBeenCalledWith("project-test", page);
    expect(state.applyRemoteCard).toHaveBeenCalledWith(page);
  });

  test("loads and rechecks the exact View before rejecting a stale target", async () => {
    state.snapshot = { databaseView: null };
    state.fetchBoard.mockImplementation(async () => {
      state.snapshot = {
        databaseView: {
          primaryWriteCompatible: false,
          readOnlyReason: "Grouping is no longer writable",
          query: { properties: [] },
        },
      };
      return true;
    });

    const result = await createKanbanPage({
      projectId: "project-test",
      databaseViewId: "view-test",
      status: "plan",
      input: { title: "Created Page" },
    });

    expect(result).toEqual({
      status: "error",
      error: "Grouping is no longer writable",
    });
    expect(state.fetchBoard).toHaveBeenCalledOnce();
    expect(state.runOptimisticMutation).not.toHaveBeenCalled();
  });
});
