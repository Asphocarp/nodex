import { describe, expect, it } from "vite-plus/test";
import fixtures from "../../shared/fixtures/task-shorthand-v1-conformance.json";
import { previewTaskShorthand, previewTaskShorthandInlineContent } from "./task-shorthand-preview";

describe("task shorthand preview", () => {
  it.each(fixtures)("keeps preview grammar aligned for $title", (fixture) => {
    const result = previewTaskShorthand(fixture.title);
    expect(Boolean(result)).toBe(fixture.match);
    if (!fixture.match || !result) return;
    expect(result).toMatchObject({
      priority: fixture.priority,
      estimate: fixture.estimate,
      tags: fixture.tags,
      title: fixture.rewrittenTitle,
    });
  });

  it("recognizes only prefixes completed before a rich-title boundary", () => {
    expect(
      previewTaskShorthandInlineContent([
        { type: "text", text: "1XL ", styles: {} },
        {
          type: "link",
          href: "https://nodex.dev",
          content: [{ type: "text", text: "Fix import", styles: {} }],
        },
      ]),
    ).toMatchObject({ priority: 1, estimate: "XL" });
    expect(
      previewTaskShorthandInlineContent([
        { type: "text", text: "1", styles: {} },
        {
          type: "link",
          href: "https://nodex.dev",
          content: [{ type: "text", text: "XL", styles: {} }],
        },
        { type: "text", text: " Fix import", styles: {} },
      ]),
    ).toBeNull();
    expect(
      previewTaskShorthandInlineContent([
        { type: "text", text: "4abc", styles: {} },
        { type: "pageMention", props: { targetPageId: "page-1" } },
      ]),
    ).toBeNull();
  });
});
