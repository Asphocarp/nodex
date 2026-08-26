import { describe, expect, it } from "vitest";

import { markdownToHtml } from "./markdownToHtml.js";

describe("markdown code fence parsing", () => {
  it("closes fences with the same character and at least the opening length", () => {
    expect(markdownToHtml("````ts\nconst value = 1;\n  `````")).toBe(
      '<pre><code data-language="ts">const value = 1;</code></pre>',
    );
    expect(markdownToHtml("~~~\nvalue\n~~~")).toBe(
      "<pre><code>value</code></pre>",
    );
  });

  it("does not treat a fence indented by four spaces as closing", () => {
    expect(markdownToHtml("```\nvalue\n    ```\nafter\n```")).toBe(
      "<pre><code>value\n    ```\nafter</code></pre>",
    );
  });

  it("handles long user-provided fences without constructing a regular expression", () => {
    const fence = "`".repeat(256);

    expect(markdownToHtml(`${fence}\nvalue\n${fence}`)).toBe(
      "<pre><code>value</code></pre>",
    );
  });
});

describe("linear-time block tokenization", () => {
  it.each([
    ["# Heading ###", "<h1>Heading</h1>"],
    ["## heading###", "<h2>heading###</h2>"],
    ["Heading\n===", "<h1>Heading</h1>"],
    ["Paragraph\n---", "<h2>Paragraph</h2>"],
    ["* * *", "<hr>"],
    [
      "> quote\ncontinued",
      "<blockquote><p>quote<br>\ncontinued</p></blockquote>",
    ],
    [
      "- item\n  - nested",
      "<ul><li><p>item</p><ul><li><p>nested</p></li></ul></li></ul>",
    ],
    [
      "1. ordered\n   continuation",
      "<ol><li><p>ordered</p><p>continuation</p></li></ol>",
    ],
    [
      "- [x] done",
      '<ul><li><input type="checkbox" disabled checked><p>done</p></li></ul>',
    ],
    [
      "| A | B |\n| :--- | ---: |\n| 1 | 2 |",
      '<table><thead><tr><th align="left">A</th><th align="right">B</th></tr></thead><tbody><tr><td align="left">1</td><td align="right">2</td></tr></tbody></table>',
    ],
    ["Paragraph\nnext line   ", "<p>Paragraph<br>\nnext line</p>"],
  ])("preserves block parsing for %j", (markdown, expectedHtml) => {
    expect(markdownToHtml(markdown)).toBe(expectedHtml);
  });

  it("handles adversarial delimiter repetitions without backtracking", () => {
    const repeatedTableCells = `|${"a|".repeat(10_000)}`;
    const repeatedListWhitespace = `*${"\t".repeat(10_000)}value`;
    const repeatedSeparatorWhitespace = `${"-\t".repeat(10_000)}|`;

    expect(markdownToHtml(repeatedTableCells)).toContain("<p>");
    expect(markdownToHtml(repeatedListWhitespace)).toContain("<ul>");
    expect(markdownToHtml(`header\n${repeatedSeparatorWhitespace}`)).toContain(
      "<p>",
    );
  });
});
