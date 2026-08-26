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
