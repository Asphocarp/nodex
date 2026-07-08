import { describe, expect, test } from "bun:test";
import { stripCodexRemarkDirectiveLines } from "./codex-remark-directives";

describe("codex remark directives", () => {
  test("strips standalone directive lines and normalizes spacing", () => {
    const value = [
      "Summary complete.",
      "",
      "::inbox-item{title=\"Ready\" summary=\"Review it\"}",
      "",
      "",
      "::archive-thread{}",
      "Next step is clear.",
    ].join("\n");

    expect(stripCodexRemarkDirectiveLines(value)).toBe("Summary complete.\n\nNext step is clear.");
  });

  test("keeps inline directive-looking text visible", () => {
    expect(stripCodexRemarkDirectiveLines("Done. ::inbox-item{title=\"Inline\"}")).toBe(
      "Done. ::inbox-item{title=\"Inline\"}",
    );
  });
});
