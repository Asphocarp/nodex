import { describe, expect, test } from "vite-plus/test";
import { MAX_PAGE_TITLE_LENGTH } from "../page-limits";
import { parseInlineMarkdownTitle, serializeInlineMarkdownTitle } from "./agent-title";

describe("Agent inline Markdown titles", () => {
  test("round-trips plain text, styles, links, and title-safe mentions", () => {
    const markdown = [
      "Plan **bold** *italic* ~~strike~~ ",
      '<span underline="true">under</span> ',
      '<span color="blue">blue</span> ',
      "`code` [**docs**](https://example.com/a) ",
      '<mention-thread uuid="thread-1" /> ',
      '<mention-page url="nodex://pages/page-1" /> ',
      '<mention-date start="2026-07-16" format="ll" />',
    ].join("");
    const parsed = parseInlineMarkdownTitle(markdown);

    expect(parsed.some((item) => item.type === "link" && item.styles.bold)).toBe(true);
    expect(parsed.some((item) => item.type === "threadMention")).toBe(true);
    expect(parsed.some((item) => item.type === "pageMention")).toBe(true);
    expect(parsed.some((item) => item.type === "dateMention")).toBe(true);
    expect(parseInlineMarkdownTitle(serializeInlineMarkdownTitle(parsed))).toEqual(parsed);
  });

  test("canonicalizes escapes exactly once", () => {
    const parsed = parseInlineMarkdownTitle("Literal \\*stars\\* and \\[brackets\\]");
    const once = serializeInlineMarkdownTitle(parsed);
    const twice = serializeInlineMarkdownTitle(parseInlineMarkdownTitle(once));

    expect(once).toBe("Literal \\*stars\\* and \\[brackets\\]");
    expect(twice).toBe(once);
  });

  test("preserves blank, whitespace-only, and intentionally indented titles", () => {
    for (const markdown of ["", "   ", "  Leading spaces"]) {
      expect(serializeInlineMarkdownTitle(parseInlineMarkdownTitle(markdown))).toBe(markdown);
    }
  });

  test("rejects body Block syntax, tabs, newlines, and non-title inline atoms", () => {
    for (const markdown of [
      "# Heading",
      "- List item",
      "▶ Toggle",
      '<page uuid="card-1" />',
      '<page-ref url="nodex://pages/card-1" />',
      "parent\tchild",
      "first\nsecond",
      "first<br>second",
      '<attachment kind="file" mode="link" source="/tmp/a" name="a" />',
      '<agent-config mode="plan" />',
    ]) {
      expect(() => parseInlineMarkdownTitle(markdown), markdown).toThrow();
    }
  });

  test("enforces the canonical title length rather than markup length", () => {
    expect(() => parseInlineMarkdownTitle("x".repeat(MAX_PAGE_TITLE_LENGTH))).not.toThrow();
    expect(() => parseInlineMarkdownTitle("x".repeat(MAX_PAGE_TITLE_LENGTH + 1))).toThrow(
      /exceeds/u,
    );
  });
});
