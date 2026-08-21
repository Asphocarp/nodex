import { describe, expect, it } from "vitest";
import { resolveCodexReasoningSummaryPresentation } from "./codex-reasoning-presentation";

function reasoning(itemId: string, markdownText: string) {
  return {
    itemId,
    normalizedKind: "reasoning" as const,
    semanticKind: "reasoning" as const,
    markdownText,
  };
}

describe("resolveCodexReasoningSummaryPresentation", () => {
  it("projects the latest non-comment Markdown line", () => {
    expect(
      resolveCodexReasoningSummaryPresentation([
        reasoning("reasoning-1", "**Inspecting the bundle.**\n<!-- internal -->"),
        reasoning("reasoning-2", "- **Checking the live path.**"),
      ]),
    ).toEqual({
      itemId: "reasoning-2",
      text: "Checking the live path.",
    });
  });

  it("skips empty and comment-only reasoning items", () => {
    expect(
      resolveCodexReasoningSummaryPresentation([
        reasoning("reasoning-1", "<!-- internal -->\n\n"),
        { ...reasoning("reasoning-2", ""), semanticKind: undefined },
      ]),
    ).toBeNull();
  });

  it("preserves visible text after inline, multiline, and partial comments", () => {
    expect(
      resolveCodexReasoningSummaryPresentation([
        reasoning("reasoning-1", "<!-- internal --> **Preparing the patch.**"),
      ]),
    ).toEqual({
      itemId: "reasoning-1",
      text: "Preparing the patch.",
    });
    expect(
      resolveCodexReasoningSummaryPresentation([
        reasoning("reasoning-2", "<!-- internal\nstate -->\n**Applying changes.**"),
      ]),
    ).toEqual({
      itemId: "reasoning-2",
      text: "Applying changes.",
    });
    expect(
      resolveCodexReasoningSummaryPresentation([
        reasoning("reasoning-3", "**Still visible.**\n<!-- streaming internal"),
      ]),
    ).toEqual({
      itemId: "reasoning-3",
      text: "Still visible.",
    });
  });

  it("keeps a safe plain-text fallback for incomplete Markdown", () => {
    expect(
      resolveCodexReasoningSummaryPresentation([reasoning("reasoning-1", "**Drafting the patch")]),
    ).toEqual({
      itemId: "reasoning-1",
      text: "**Drafting the patch",
    });
  });

  it("bounds an oversized live line without changing its item identity", () => {
    const longLine = `Checking ${"a".repeat(9_000)}`;
    const result = resolveCodexReasoningSummaryPresentation([reasoning("reasoning-1", longLine)]);

    expect(result?.itemId).toBe("reasoning-1");
    expect(result?.text.length).toBeLessThanOrEqual(8_000);
  });
});
