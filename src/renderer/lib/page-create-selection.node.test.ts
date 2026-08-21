import { describe, expect, test } from "vitest";
import { MAX_PAGE_TITLE_LENGTH } from "../../shared/page-limits";
import { normalizePageCreateSelectionText } from "./page-create-selection";

describe("Page create selection normalization", () => {
  test("collapses Unicode whitespace and trims the selected title", () => {
    expect(normalizePageCreateSelectionText("  Fix\t release\n\u00a0notes  ")).toBe(
      "Fix release notes",
    );
    expect(normalizePageCreateSelectionText(" \n\t ")).toBeNull();
  });

  test("respects the UTF-16 title limit without splitting a surrogate pair", () => {
    const prefix = "x".repeat(MAX_PAGE_TITLE_LENGTH - 1);
    const normalized = normalizePageCreateSelectionText(`${prefix}😀tail`);

    expect(normalized).toBe(prefix);
    expect(normalized?.length).toBe(MAX_PAGE_TITLE_LENGTH - 1);
  });
});
