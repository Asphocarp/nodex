import { describe, expect, test } from "vitest";
import { buildPagePromptContext } from "./page-prompt-context";

describe("page prompt context", () => {
  test("compiles canonical Page NFM into a stable prompt with image inputs", () => {
    const context = buildPagePromptContext({
      projectId: "project-a",
      pageId: "page-1",
      pageKey: "LAB-13",
      title: "Release plan",
      nfm: '<image source="nodex://assets/diagram.png">Architecture</image>\n\nShip it',
    });

    expect(context.source).toBe("nodex://pages/page-1");
    expect(context.pageKey).toBe("LAB-13");
    expect(context.promptInput.text).toBe(
      "Page: Release plan\nPage key: LAB-13\nSource: nodex://pages/page-1\n\n[Image #1] (caption: Architecture)\nShip it",
    );
    expect(context.promptInput.images).toEqual([{
      source: "nodex://assets/diagram.png",
      caption: "Architecture",
    }]);
  });

  test("uses the stable untitled label when the canonical title is empty", () => {
    const context = buildPagePromptContext({
      projectId: "project-a",
      pageId: "page-1",
      title: "  ",
      nfm: "Body",
    });

    expect(context.title).toBe("Untitled Page");
    expect(context.pageKey).toBeUndefined();
    expect(context.promptInput.text.startsWith("Page: Untitled Page")).toBe(true);
  });
});
