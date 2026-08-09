import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import type { DatabasePage } from "./types";

const testState = vi.hoisted(() => ({
  snapshot: {
    databaseView: null,
  } as unknown,
  mutationOutcome: {
    ok: false,
    error: new Error("Core is unavailable"),
  } as unknown,
  setError: vi.fn(),
  applyRemoteCard: vi.fn(),
  invoke: vi.fn(),
  runOptimisticMutation: vi.fn(),
  commitPageLifecycleIntent: vi.fn(),
  commitDatabasePageDrag: vi.fn(),
}));

vi.mock("./kanban-store", () => ({
  getKanbanProjectStore: () => ({
    subscribe: () => () => undefined,
    getSnapshot: () => testState.snapshot,
    fetchBoard: vi.fn(),
    loadMore: vi.fn(),
    loadMoreGroup: vi.fn(),
    setError: testState.setError,
    runOptimisticMutation: testState.runOptimisticMutation,
    applyRemoteCard: testState.applyRemoteCard,
    applyRemoteCardSummary: vi.fn(),
    resolveConflict: vi.fn(),
    refreshBoard: vi.fn(),
  }),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  invoke: testState.invoke,
}));

vi.mock("./page-lifecycle-runtime", () => ({
  commitPageLifecycleIntent: testState.commitPageLifecycleIntent,
}));

vi.mock("./database-page-drag-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./database-page-drag-runtime")>()),
  commitDatabasePageDrag: testState.commitDatabasePageDrag,
}));

import { useKanban } from "./use-kanban";

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

describe("useKanban createPage result", () => {
  beforeEach(() => {
    testState.snapshot = { databaseView: null };
    testState.mutationOutcome = {
      ok: false,
      error: new Error("Core is unavailable"),
    };
    testState.setError.mockClear();
    testState.applyRemoteCard.mockClear();
    testState.invoke.mockReset();
    testState.commitPageLifecycleIntent.mockReset();
    testState.commitDatabasePageDrag.mockReset();
    testState.runOptimisticMutation.mockReset().mockImplementation(
      async () => testState.mutationOutcome,
    );
  });

  test("returns the committed Page on success", async () => {
    testState.mutationOutcome = {
      ok: true,
      result: {
        receipt: { storeEpoch: "epoch-test", commitSeq: 2 },
        boardProjection: page,
      },
    };
    const { result } = renderHook(() => useKanban({ projectId: "project-test" }));

    let createResult: Awaited<ReturnType<typeof result.current.createPage>> | undefined;
    await act(async () => {
      createResult = await result.current.createPage("plan", {
        title: "Created Page",
      });
    });

    expect(createResult).toEqual({ status: "created", page });
    expect(testState.applyRemoteCard).not.toHaveBeenCalled();
  });

  test("preserves the optimistic mutation error for the modal", async () => {
    const { result } = renderHook(() => useKanban({ projectId: "project-test" }));

    let createResult: Awaited<ReturnType<typeof result.current.createPage>> | undefined;
    await act(async () => {
      createResult = await result.current.createPage("plan", {
        title: "Created Page",
      });
    });

    expect(createResult).toEqual({
      status: "error",
      error: "Core is unavailable",
    });
  });

  test("returns the selected View read-only reason before mutation", async () => {
    testState.snapshot = {
      databaseView: {
        primaryWriteCompatible: false,
        readOnlyReason: "Grouping is not writable",
      },
    };
    const { result } = renderHook(() => useKanban({
      projectId: "project-test",
      databaseViewId: "view-test",
    }));

    let createResult: Awaited<ReturnType<typeof result.current.createPage>> | undefined;
    await act(async () => {
      createResult = await result.current.createPage("plan", {
        title: "Created Page",
      });
    });

    expect(createResult).toEqual({
      status: "error",
      error: "Grouping is not writable",
    });
    expect(testState.setError).toHaveBeenCalledWith("Grouping is not writable");
  });

  test("routes a resolved occurrence rejection through optimistic rollback", async () => {
    testState.invoke.mockResolvedValue({
      success: false,
      error: "Page is not scheduled",
    });
    let remoteDisposition: "unobserved" | "acknowledged" | "rejected" = "unobserved";
    testState.runOptimisticMutation.mockImplementationOnce(async (options) => {
      try {
        const result = await options.runRemote();
        remoteDisposition = "acknowledged";
        return { ok: true, result };
      } catch (error) {
        remoteDisposition = "rejected";
        return { ok: false, error };
      }
    });
    const { result } = renderHook(() => useKanban({ projectId: "project-test" }));

    let completed: boolean | undefined;
    await act(async () => {
      completed = await result.current.completeOccurrence({
        pageId: "page-1",
        occurrenceStart: new Date("2026-08-09T00:00:00.000Z"),
        source: "calendar",
      });
    });

    expect(completed).toBe(false);
    expect(remoteDisposition).toBe("rejected");
    expect(testState.invoke).toHaveBeenCalledWith(
      "page:occurrence:complete",
      "project-test",
      expect.objectContaining({ pageId: "page-1" }),
      undefined,
    );
  });

  test("keeps the Page lifecycle receipt as the delete acknowledgement", async () => {
    const committed = {
      receipt: {
        lifecycle: "deleted",
        storeEpoch: "epoch-test",
        commitSeq: 17,
      },
      boardProjection: null,
    };
    testState.commitPageLifecycleIntent.mockResolvedValue(committed);
    let acknowledged: unknown;
    let commitCursor: { storeEpoch: string; commitSeq: number } | null | undefined;
    testState.runOptimisticMutation.mockImplementationOnce(async (options) => {
      acknowledged = await options.runRemote();
      commitCursor = options.getCommitCursor?.(acknowledged);
      return { ok: true, result: acknowledged };
    });
    const { result } = renderHook(() => useKanban({ projectId: "project-test" }));

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.deletePage("plan", "page-1");
    });

    expect(deleted).toBe(true);
    expect(acknowledged).toBe(committed);
    expect(commitCursor).toEqual({ storeEpoch: "epoch-test", commitSeq: 17 });
    expect(testState.commitPageLifecycleIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "delete",
        projectId: "project-test",
        pageId: "page-1",
      }),
    );
  });

  test("threads the Database receipt commit floor through a Page drag", async () => {
    testState.snapshot = {
      databaseView: {
        primaryWriteCompatible: true,
        accessContext: { kind: "project", projectId: "project-test" },
        libraryId: "library-test",
        storeEpoch: "epoch-test",
        commitSeq: 3,
        query: {},
      },
    };
    const receipt = { storeEpoch: "epoch-test", commitSeq: 23 };
    testState.commitDatabasePageDrag.mockResolvedValue(receipt);
    let commitCursor: { storeEpoch: string; commitSeq: number } | null | undefined;
    testState.runOptimisticMutation.mockImplementationOnce(async (options) => {
      const acknowledged = await options.runRemote();
      commitCursor = options.getCommitCursor?.(acknowledged);
      return { ok: true, result: acknowledged };
    });
    const { result } = renderHook(() => useKanban({ projectId: "project-test" }));

    let moved: boolean | undefined;
    await act(async () => {
      moved = await result.current.movePage({
        pageId: "page-1",
        fromStatus: "plan",
        toStatus: "ship",
      });
    });

    expect(moved).toBe(true);
    expect(commitCursor).toEqual({ storeEpoch: "epoch-test", commitSeq: 23 });
    expect(testState.commitDatabasePageDrag).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-test",
        move: expect.objectContaining({ pageId: "page-1", toStatus: "ship" }),
      }),
    );
  });
});
