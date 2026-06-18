import { describe, expect, test } from "bun:test";
import { normalizeCodexManualThreadTitle } from "./codex-thread-title";

describe("normalizeCodexManualThreadTitle", () => {
  test("trims and folds whitespace", () => {
    expect(normalizeCodexManualThreadTitle("  hello   world\nagain  ")).toBe("hello world again");
  });

  test("returns null for empty or whitespace-only titles", () => {
    expect(normalizeCodexManualThreadTitle("")).toBe(null);
    expect(normalizeCodexManualThreadTitle(" \t\n ")).toBe(null);
  });

  test("keeps a 60 character title unchanged", () => {
    const title = "x".repeat(60);
    expect(normalizeCodexManualThreadTitle(title)).toBe(title);
  });

  test("truncates over 60 characters with an ellipsis", () => {
    expect(normalizeCodexManualThreadTitle("x".repeat(61))).toBe(`${"x".repeat(59)}…`);
  });
});
