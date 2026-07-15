import { describe, expect, test } from "vitest";
import {
  buildCardSearchText,
  matchesSearchTokens,
  tokenizeSearchQuery,
} from "./card-search";
import type { CardSummary } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents";

function makeCard(overrides: Partial<CardSummary> = {}): CardSummary {
  const title = overrides.title ?? "Improve NFM search";
  return {
    id: "abc1234",
    status: "draft",
    archived: false,
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
    descriptionPreview: "Use token based matching for board search.",
    descriptionLength: "Use token based matching for board search.".length,
    hasDescription: true,
    priority: "p2-medium",
    tags: ["editor", "search"],
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

  test("buildCardSearchText includes searchable card fields", () => {
    const card = makeCard();
    const searchable = buildCardSearchText(card);

    expect(searchable.includes("abc1234")).toBe(true);
    expect(searchable.includes("improve nfm search")).toBe(true);
    expect(searchable.includes("token based matching")).toBe(true);
    expect(searchable.includes("editor search")).toBe(true);
    expect(searchable.includes("alice")).toBe(true);
  });
});
