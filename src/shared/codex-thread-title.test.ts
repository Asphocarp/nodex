import { describe, expect, test } from "vitest";
import {
  cleanCodexAutoTitlePrompt,
  normalizeCodexGeneratedThreadTitle,
  normalizeCodexManualThreadTitle,
  resolveCodexElectronDisplayThreadTitle,
} from "./codex-thread-title";

describe("cleanCodexAutoTitlePrompt", () => {
  test("keeps the text after the final Codex request marker", () => {
    expect(cleanCodexAutoTitlePrompt("Context\n## My request for Codex:\nShip title parity")).toBe("Ship title parity");
  });

  test("does not strip markdown links or agent config lines", () => {
    const prompt = "<agent-config mode=\"plan\" />\nRead [docs](README.md)";
    expect(cleanCodexAutoTitlePrompt(prompt)).toBe(prompt);
  });

  test("truncates to 2000 characters", () => {
    expect(cleanCodexAutoTitlePrompt("x".repeat(2_500)).length).toBe(2_000);
  });
});

describe("normalizeCodexGeneratedThreadTitle", () => {
  test("normalizes generated titles like Codex Electron", () => {
    expect(normalizeCodexGeneratedThreadTitle("  x  ")).toBe("x");
    expect(normalizeCodexGeneratedThreadTitle("  title: \"Fix flaky test.\"  ")).toBe("Fix flaky test");
    expect(normalizeCodexGeneratedThreadTitle("\n\n`Add new thread title!`\nignored")).toBe("Add new thread title");
  });

  test("returns null for empty generated titles", () => {
    expect(normalizeCodexGeneratedThreadTitle(" \n\t ")).toBe(null);
  });

  test("truncates generated titles to 36 characters", () => {
    expect(normalizeCodexGeneratedThreadTitle("x".repeat(37))).toBe(`${"x".repeat(35)}…`);
  });
});

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

describe("resolveCodexElectronDisplayThreadTitle", () => {
  test("prefers explicit thread names", () => {
    expect(resolveCodexElectronDisplayThreadTitle({
      threadName: "Generated title",
      threadPreview: "Preview",
      fallback: "New thread",
    })).toBe("Generated title");
  });

  test("derives fallback display titles from preview text", () => {
    expect(resolveCodexElectronDisplayThreadTitle({
      threadName: "",
      threadPreview: "x".repeat(61),
      fallback: "New thread",
    })).toBe(`${"x".repeat(59)}…`);
  });

  test("uses fallback when no title source exists", () => {
    expect(resolveCodexElectronDisplayThreadTitle({
      threadName: "",
      threadPreview: "",
      fallback: "New thread",
    })).toBe("New thread");
  });
});
