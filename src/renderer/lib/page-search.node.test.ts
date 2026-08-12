import { describe, expect, test } from "vitest";
import {
  buildPageSearchText,
  matchesSearchTokens,
  tokenizeSearchQuery,
} from "./page-search";
import type { DatabasePageSummary } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents/portable-rich-text";

function makeCard(overrides: Partial<DatabasePageSummary> = {}): DatabasePageSummary {
  const title = overrides.title ?? "Improve NFM search";
  return {
    id: "abc1234",
    status: "triage",
    archived: false,
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
    descriptionPreview: "Use token based matching for board search.",
    descriptionLength: "Use token based matching for board search.".length,
    hasDescription: true,
    priority: "p2-medium",
    tags: ["o_AAAAAAAA", "o_BBBBBBBB"],
    assignee: "alice",
    created: new Date("2026-02-10T00:00:00.000Z"),
    order: 0,
    ...overrides,
  };
}

describe("card search", () => {
  test("tokenizeSearchQuery splits on whitespace and normalizes case", () => {
    expect(JSON.stringify(tokenizeSearchQuery("  NFM   Search   "))).toBe(
      JSON.stringify(["nfm", "search"])
    );
  });

  test("matchesSearchTokens requires all tokens to be present", () => {
    const text = "nfm editor search";
    expect(matchesSearchTokens(text, ["nfm", "search"])).toBe(true);
    expect(matchesSearchTokens(text, ["nfm", "missing"])).toBe(false);
  });

  test("buildPageSearchText includes searchable card fields", () => {
    const card = makeCard();
    const searchable = buildPageSearchText(card, ["Editor", "Search"]);

    expect(searchable.includes("abc1234")).toBe(true);
    expect(searchable.includes("improve nfm search")).toBe(true);
    expect(searchable.includes("token based matching")).toBe(true);
    expect(searchable.includes("editor search")).toBe(true);
    expect(searchable.includes("o_aaaaaaaa")).toBe(false);
    expect(searchable.includes("alice")).toBe(true);
  });
});
