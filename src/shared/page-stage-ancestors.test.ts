import { describe, expect, test } from "vitest";
import {
  appendPageStageAncestor,
  MAX_PAGE_STAGE_ANCESTOR_DEPTH,
} from "./page-stage-ancestors";

describe("Page Stage ancestors", () => {
  test("appends the current Page while collapsing repeated ancestry", () => {
    expect(appendPageStageAncestor([
      { pageId: "root" },
      { pageId: "child" },
    ], {
      pageId: "root",
    })).toEqual([
      { pageId: "root" },
    ]);
  });

  test("keeps the nearest bounded ancestor trail", () => {
    const ancestors = Array.from({ length: MAX_PAGE_STAGE_ANCESTOR_DEPTH }, (_, index) => ({
      pageId: `page-${index}`,
    }));

    const result = appendPageStageAncestor(ancestors, {
      pageId: "current",
    });

    expect(result).toHaveLength(MAX_PAGE_STAGE_ANCESTOR_DEPTH);
    expect(result[0]?.pageId).toBe("page-1");
    expect(result.at(-1)?.pageId).toBe("current");
  });
});
