import { describe, expect, test, vi } from "vitest";
import { runCopyConversationMarkdown } from "./copy-conversation-markdown";

describe("runCopyConversationMarkdown", () => {
  test("hydrates before rereading and writes the complete document byte-for-byte", async () => {
    const calls: string[] = [];
    const value = `# Transcript\n\n${"x".repeat(80_500)}\n`;
    const writeText = vi.fn(async (markdown: string) => {
      calls.push("write");
      expect(markdown).toBe(value);
    });
    const showSuccess = vi.fn();
    await runCopyConversationMarkdown({
      ensureCompleteHistory: async () => {
        calls.push("hydrate");
      },
      getMarkdown: async () => {
        calls.push("reread");
        return value;
      },
      writeText,
      showSuccess,
      showError: vi.fn(),
    });

    expect(calls).toEqual(["hydrate", "reread", "write"]);
    expect(showSuccess).toHaveBeenCalledOnce();
  });

  test("silently ignores empty output", async () => {
    const writeText = vi.fn();
    const showSuccess = vi.fn();
    const showError = vi.fn();
    await runCopyConversationMarkdown({
      ensureCompleteHistory: async () => {},
      getMarkdown: async () => "  ",
      writeText,
      showSuccess,
      showError,
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(showSuccess).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  test("uses the same failure toast for hydration, serialization, and clipboard errors", async () => {
    for (const failingStep of ["hydrate", "render", "clipboard"] as const) {
      const showError = vi.fn();
      await runCopyConversationMarkdown({
        ensureCompleteHistory: async () => {
          if (failingStep === "hydrate") throw new Error("hydrate");
        },
        getMarkdown: async () => {
          if (failingStep === "render") throw new Error("render");
          return "# Transcript\n";
        },
        writeText: async () => {
          if (failingStep === "clipboard") throw new Error("clipboard");
        },
        showSuccess: vi.fn(),
        showError,
      });
      expect(showError).toHaveBeenCalledOnce();
    }
  });
});
