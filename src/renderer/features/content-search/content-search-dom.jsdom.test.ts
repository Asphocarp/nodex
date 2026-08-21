import { describe, expect, test } from "vitest";
import {
  CONTENT_SEARCH_ACTIVE_MARK_CLASS,
  CONTENT_SEARCH_MATCH_ID_ATTRIBUTE,
  CONTENT_SEARCH_SHADOW_STYLE_ID,
  applyContentSearchDiffDomMarks,
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
    expect(root.querySelectorAll("mark")[1]?.getAttribute(CONTENT_SEARCH_MATCH_ID_ATTRIBUTE)).toBe(
      "test:1",
    );

    clearContentSearchMarks(root);

    expect(root.querySelectorAll("mark").length).toBe(0);
    expect(root.textContent).toBe("alpha beta alpha");
  });

  test("skips collapsed and editable content", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      "<p>visible needle</p>",
      '<p data-thread-find-skip="true">hidden needle</p>',
      "<textarea>editable needle</textarea>",
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

  test("marks a query spanning syntax token nodes inside a shadow root", () => {
    const root = document.createElement("div");
    const diffHost = document.createElement("diffs-container");
    root.append(diffHost);
    const shadowRoot = diffHost.attachShadow({ mode: "open" });
    const line = document.createElement("span");
    line.innerHTML = "<span>need</span><span>le</span>";
    shadowRoot.append(line);

    const result = applyContentSearchDomMarks({
      root,
      query: "needle",
      idPrefix: "shadow",
      includeShadowRoots: true,
      matchIds: ["diff:src/app.ts:0:4"],
    });

    const mark = shadowRoot.querySelector("mark.codex-thread-find-match");
    expect(result.matches.map((match) => match.id)).toEqual(["diff:src/app.ts:0:4"]);
    expect(mark?.textContent).toBe("needle");
    expect(mark?.getAttribute(CONTENT_SEARCH_MATCH_ID_ATTRIBUTE)).toBe("diff:src/app.ts:0:4");
    expect(shadowRoot.getElementById(CONTENT_SEARCH_SHADOW_STYLE_ID)).not.toBeNull();

    clearContentSearchMarks(root, { includeShadowRoots: true });
    expect(shadowRoot.querySelector("mark")).toBeNull();
    expect(line.textContent).toBe("needle");
  });

  test("targets an exact diff line before marking repeated shadow text", () => {
    const root = document.createElement("div");
    root.textContent = "needle in file stats";
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const additions = document.createElement("div");
    additions.setAttribute("data-additions", "");
    const firstLine = document.createElement("div");
    firstLine.dataset.line = "1";
    firstLine.textContent = "needle on first line";
    const secondLine = document.createElement("div");
    secondLine.dataset.line = "2";
    secondLine.append("nee");
    const token = document.createElement("span");
    token.textContent = "dle on second line";
    secondLine.append(token);
    additions.append(firstLine, secondLine);
    shadow.append(additions);
    root.append(host);

    const result = applyContentSearchDiffDomMarks({
      root,
      query: "needle",
      activeMatchId: "diff:file:0:1",
      sourceMatches: [
        {
          id: "diff:file:0:1",
          hunkId: "0",
          lineStart: 2,
          lineEnd: 2,
          side: "additions",
        },
      ],
    });

    expect(result.matches).toHaveLength(1);
    expect(firstLine.querySelector("mark")).toBeNull();
    expect(root.querySelector("mark")).toBeNull();
    expect(secondLine.querySelector("mark")?.textContent).toBe("needle");
    expect(
      secondLine.querySelector("mark")?.classList.contains(CONTENT_SEARCH_ACTIVE_MARK_CLASS),
    ).toBe(true);
  });
});
