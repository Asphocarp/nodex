import { describe, expect, test, vi } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents/portable-rich-text";
import type { DatabasePage } from "./types";
import {
  commitPageMetadataPatchForBoard,
  commitPageMetadataPatchForBoardWithReceipt,
  type PageMetadataBoardRuntimeDependencies,
} from "./page-metadata-board-runtime";
import type {
  PageDetailMetadataMutationEnvelope,
} from "./page-detail-metadata-runtime";

const page = (id = "page-1"): DatabasePage => ({
  id,
  status: "triage",
  title: "Page",
  richTitle: plainTextToPortableRichText("Page"),
  description: "",
  priority: "p1-high",
  tags: [],
  isAllDay: false,
  reminders: [],
  archived: false,
  revision: 4,
  created: new Date("2026-07-16T00:00:00.000Z"),
  order: 0,
});

const dependencies = (
  committed: PageDetailMetadataMutationEnvelope,
  readBoardProjection: PageMetadataBoardRuntimeDependencies["readBoardProjection"] =
    async () => page(),
): PageMetadataBoardRuntimeDependencies => ({
  commit: async () => committed,
  readBoardProjection,
});

const updated = (
  commitSeq = 5,
): PageDetailMetadataMutationEnvelope => ({
  result: { status: "updated", didMutate: true },
  commitCursor: { storeEpoch: "epoch-1", commitSeq },
});

describe("Page metadata Board adapter", () => {
  test("projects a canonical Page metadata receipt into the current Board result", async () => {
    const readBoardProjection = vi.fn(async () => page());
    const result = await commitPageMetadataPatchForBoard({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "priority-1",
      patch: { priority: "p1-high" },
      dependencies: dependencies(updated(8), readBoardProjection),
    });

    expect(result).toMatchObject({
      status: "updated",
      projectId: "project-1",
      pageId: "page-1",
      revision: 4,
      changedFields: ["priority"],
      didMutate: true,
    });
    expect(readBoardProjection).toHaveBeenCalledWith(
      "project-1",
      "page-1",
      { storeEpoch: "epoch-1", commitSeq: 8 },
    );
  });

  test("returns a fresh Board projection for a canonical conflict", async () => {
    const result = await commitPageMetadataPatchForBoard({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "priority-2",
      patch: { priority: "p1-high" },
      dependencies: dependencies({
        result: { status: "conflict" },
        commitCursor: null,
      }),
    });

    expect(result).toEqual({ status: "conflict", page: page() });
  });

  test("rejects a Board projection for another Page", async () => {
    await expect(commitPageMetadataPatchForBoard({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "priority-3",
      patch: { priority: "p1-high" },
      dependencies: dependencies(
        { result: { status: "conflict" }, commitCursor: null },
        async () => page("page-2"),
      ),
    })).rejects.toThrow(
      "Board projection returned Page page-2 for requested Page page-1",
    );
  });

  test("keeps a durable acknowledgement when its Board projection read fails", async () => {
    const result = await commitPageMetadataPatchForBoardWithReceipt({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "priority-4",
      patch: { priority: "p1-high" },
      dependencies: dependencies(updated(11), async () => {
        throw new Error("projection unavailable");
      }),
    });

    expect(result).toEqual({
      result: {
        status: "updated",
        projectId: "project-1",
        pageId: "page-1",
        changedFields: ["priority"],
        didMutate: true,
      },
      commitCursor: { storeEpoch: "epoch-1", commitSeq: 11 },
    });
  });
});
