import { describe, expect, test } from "vitest";

import { buildPageDetailStoryResult } from "@/components/kanban/page-stage/page-stage-story-page-detail";
import { buildPageStageStoryPage } from "@/components/kanban/page-stage/page-stage-dev-story-data";
import {
  pageDetailDataDependencies,
  pageDetailDocumentDependencies,
} from "./page-detail-projection-dependencies";

const detail = () => {
  const result = buildPageDetailStoryResult(
    "project-1",
    buildPageStageStoryPage({
      runInTarget: "localProject",
      existingWorktree: false,
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe("Page Detail projection dependencies", () => {
  test("tracks the owning Database and Data Source for schema invalidation", () => {
    const value = detail();
    expect(pageDetailDataDependencies(value, value.page.pageId)).toEqual({
      pageIds: [value.page.pageId],
      databaseIds: [value.dataSourceContext.kind === "member"
        ? value.dataSourceContext.database.databaseId
        : ""],
      dataSourceIds: [value.dataSourceContext.kind === "member"
        ? value.dataSourceContext.dataSource.dataSourceId
        : ""],
    });
  });

  test("keeps Document invalidation independent from schema invalidation", () => {
    const value = detail();
    expect(pageDetailDocumentDependencies(value, value.page.pageId)).toEqual({
      pageIds: [value.page.pageId],
      documentIds: [value.page.documentId],
    });
  });
});
