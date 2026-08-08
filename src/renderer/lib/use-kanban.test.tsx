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
}));

vi.mock("./kanban-store", () => ({
  getKanbanProjectStore: () => ({
    subscribe: () => () => undefined,
    getSnapshot: () => testState.snapshot,
    fetchBoard: vi.fn(),
    loadMore: vi.fn(),
    loadMoreGroup: vi.fn(),
    setError: testState.setError,
    runOptimisticMutation: vi.fn(async () => testState.mutationOutcome),
    applyRemoteCard: testState.applyRemoteCard,
    applyRemoteCardSummary: vi.fn(),
    resolveConflict: vi.fn(),
    refreshBoard: vi.fn(),
  }),
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
  });

  test("returns the committed Page on success", async () => {
    testState.mutationOutcome = { ok: true, result: page };
    const { result } = renderHook(() => useKanban({ projectId: "project-test" }));

    let createResult: Awaited<ReturnType<typeof result.current.createPage>> | undefined;
    await act(async () => {
      createResult = await result.current.createPage("plan", {
        title: "Created Page",
      });
    });

    expect(createResult).toEqual({ status: "created", page });
    expect(testState.applyRemoteCard).toHaveBeenCalledWith(page);
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
});
