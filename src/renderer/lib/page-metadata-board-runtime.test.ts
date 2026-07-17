import { describe, expect, test } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents";
import type { DatabasePage } from "./types";
import {
  commitPageMetadataPatchForBoard,
  type PageMetadataBoardRuntimeDependencies,
} from "./page-metadata-board-runtime";

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
  result: Awaited<
    ReturnType<PageMetadataBoardRuntimeDependencies["commit"]>
  >,
  projected: DatabasePage | null = page(),
): PageMetadataBoardRuntimeDependencies => ({
  commit: async () => result,
  readBoardProjection: async () => projected,
});

describe("Page metadata Board adapter", () => {
  test("projects a canonical Page metadata receipt into the current Board result", async () => {
    const result = await commitPageMetadataPatchForBoard({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "priority-1",
      patch: { priority: "p1-high" },
      dependencies: dependencies({ status: "updated", didMutate: true }),
    });

    expect(result).toMatchObject({
      status: "updated",
      projectId: "project-1",
      pageId: "page-1",
      revision: 4,
      changedFields: ["priority"],
      didMutate: true,
    });
  });

  test("returns a fresh Board projection for a canonical conflict", async () => {
    const result = await commitPageMetadataPatchForBoard({
      projectId: "project-1",
      pageId: "page-1",
      operationId: "priority-2",
      patch: { priority: "p1-high" },
      dependencies: dependencies({ status: "conflict" }),
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
        { status: "updated", didMutate: true },
        page("page-2"),
      ),
    })).rejects.toThrow(
      "Board projection returned Page page-2 for requested Page page-1",
    );
  });
});
