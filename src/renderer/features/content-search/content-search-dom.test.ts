import { describe, expect, test } from "vitest";
import {
  CONTENT_SEARCH_ACTIVE_MARK_CLASS,
  CONTENT_SEARCH_MATCH_ID_ATTRIBUTE,
  applyContentSearchDomMarks,
  clearContentSearchMarks,
} from "./content-search-dom";

describe("content search DOM marks", () => {
  test("wraps matches and clears marks without losing text", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>alpha beta alpha</p>";

    const result = applyContentSearchDomMarks({
      root,
      query: "alpha",
      idPrefix: "test",
      activeMatchId: "test:1",
    });

    expect(result.totalMatches).toBe(2);
    expect(root.querySelectorAll("mark.codex-thread-find-match").length).toBe(2);
    expect(Boolean(root.querySelector(`mark.${CONTENT_SEARCH_ACTIVE_MARK_CLASS}`))).toBe(true);
    expect(root.querySelectorAll("mark")[1]?.getAttribute(CONTENT_SEARCH_MATCH_ID_ATTRIBUTE)).toBe("test:1");

    clearContentSearchMarks(root);

    expect(root.querySelectorAll("mark").length).toBe(0);
    expect(root.textContent).toBe("alpha beta alpha");
  });

  test("skips collapsed and editable content", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      "<p>visible needle</p>",
      '<p data-thread-find-skip="true">hidden needle</p>',
      '<textarea>editable needle</textarea>',
      '<div contenteditable="true">editable needle</div>',
    ].join("");

    const result = applyContentSearchDomMarks({
      root,
      query: "needle",
      idPrefix: "skip",
    });

    expect(result.totalMatches).toBe(1);
    expect(root.querySelectorAll("mark.codex-thread-find-match").length).toBe(1);
  });

  test("caps marked matches", () => {
    const root = document.createElement("div");
    root.textContent = "needle needle needle";

    const result = applyContentSearchDomMarks({
      root,
      query: "needle",
      idPrefix: "cap",
      limit: 2,
    });

    expect(result.totalMatches).toBe(2);
    expect(result.capped).toBe(true);
    expect(root.querySelectorAll("mark.codex-thread-find-match").length).toBe(2);
  });
});
