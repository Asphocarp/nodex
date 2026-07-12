import { describe, expect, test } from "vitest";
import {
  CONTENT_SEARCH_LOCAL_MATCH_LIMIT,
  buildContentSearchResultLabel,
  cycleContentSearchDomain,
  readSingleLineSelectionText,
} from "./content-search-model";

describe("content search model", () => {
  test("cycles domains with browser only when a browser target is available", () => {
    expect(cycleContentSearchDomain("conversation", false)).toBe("diff");
    expect(cycleContentSearchDomain("diff", false)).toBe("conversation");
    expect(cycleContentSearchDomain("diff", true)).toBe("browser");
    expect(cycleContentSearchDomain("browser", true)).toBe("conversation");
  });

  test("uses only single-line selected text as a seed", () => {
    expect(readSingleLineSelectionText(" selected text ")).toBe("selected text");
    expect(readSingleLineSelectionText("first\nsecond")).toBe(null);
    expect(readSingleLineSelectionText("   ")).toBe(null);
  });

  test("builds capped local result labels", () => {
    const label = buildContentSearchResultLabel({
      domain: "conversation",
      query: "needle",
      loading: false,
      activeIndex: 0,
      localResult: {
        query: "needle",
        matches: [],
        totalMatches: CONTENT_SEARCH_LOCAL_MATCH_LIMIT,
        capped: true,
      },
    });

    expect(label).toBe("1 / 150+ results");
  });

  test("builds browser result labels from browser find state", () => {
    const label = buildContentSearchResultLabel({
      domain: "browser",
      query: "needle",
      loading: false,
      activeIndex: 0,
      browserFindState: {
        open: true,
        query: "needle",
        activeMatchOrdinal: 3,
        matchCount: 12,
        caseSensitive: false,
      },
    });

    expect(label).toBe("3 / 12 results");
  });
});
