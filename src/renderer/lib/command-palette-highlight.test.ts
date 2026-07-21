import { describe, expect, test } from "vitest";
import {
  buildCommandPaletteCharacterHighlightSegments,
  buildCommandPaletteTokenHighlightSegments,
  type CommandPaletteHighlightSegment,
} from "./command-palette-highlight";

function highlightedText(segments: readonly CommandPaletteHighlightSegment[]): string {
  return segments.filter((segment) => segment.highlight).map((segment) => segment.text).join("");
}

function fullText(segments: readonly CommandPaletteHighlightSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

describe("command palette character highlighting", () => {
  test("prefers an exact case-insensitive substring", () => {
    const segments = buildCommandPaletteCharacterHighlightSegments("Open Settings", "SET");

    expect(fullText(segments)).toBe("Open Settings");
    expect(highlightedText(segments)).toBe("Set");
  });

  test("highlights repeated and overlapping query tokens", () => {
    const segments = buildCommandPaletteTokenHighlightSegments("banana bandana", "ana nan ana");

    expect(fullText(segments)).toBe("banana bandana");
    expect(highlightedText(segments).length).toBeGreaterThanOrEqual(5);
  });

  test("supports fuzzy command subsequences and rolls back failed matches", () => {
    const matched = buildCommandPaletteCharacterHighlightSegments(
      "Command palette",
      "cmdpal",
      "fuzzy",
    );
    const failed = buildCommandPaletteCharacterHighlightSegments(
      "Command palette",
      "cmdxyz",
      "fuzzy",
    );

    expect(highlightedText(matched).toLocaleLowerCase()).toBe("cmdpal");
    expect(failed).toEqual([{ text: "Command palette", highlight: false }]);
  });

  test("keeps CJK, emoji, and combining marks in one code-point coordinate system", () => {
    const text = "修复 Cafe\u0301 😀 搜索";
    const cjk = buildCommandPaletteCharacterHighlightSegments(text, "修复");
    const emojiAndMark = buildCommandPaletteTokenHighlightSegments(text, "e\u0301 😀");

    expect(fullText(cjk)).toBe(text);
    expect(highlightedText(cjk)).toBe("修复");
    expect(fullText(emojiAndMark)).toBe(text);
    expect(highlightedText(emojiAndMark)).toBe("e\u0301😀");
  });

  test("preserves text for an empty query", () => {
    expect(buildCommandPaletteCharacterHighlightSegments("😀 Search", "")).toEqual([
      { text: "😀 Search", highlight: false },
    ]);
  });
});
