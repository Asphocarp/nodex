import type { CodexItemView } from "./types";
import { projectCodexMarkdownToPlainText } from "./codex-markdown-text";

const MAX_REASONING_FALLBACK_LINE_CHARS = 8_000;

export interface CodexReasoningSummaryPresentation {
  readonly itemId: string;
  readonly text: string;
}

type CodexReasoningSummarySource = Pick<
  CodexItemView,
  "itemId" | "semanticKind" | "normalizedKind" | "markdownText"
>;

function stripReasoningHtmlComments(markdownText: string): string {
  return markdownText.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => (
    comment.replace(/[^\r\n]/g, "")
  ));
}

/**
 * Mirrors Electron's `mxl`/`lAl` render-time reasoning fallback projection.
 * Reasoning remains a hidden transcript leaf; only its latest non-comment
 * summary line is surfaced when the surrounding activity needs a label.
 */
export function resolveCodexReasoningSummaryPresentation(
  items: readonly CodexReasoningSummarySource[],
): CodexReasoningSummaryPresentation | null {
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex];
    if (
      item?.semanticKind !== "reasoning"
      && item?.normalizedKind !== "reasoning"
    ) {
      continue;
    }

    const lines = stripReasoningHtmlComments(item.markdownText ?? "")
      .trimEnd()
      .split(/\r?\n/);
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const line = lines[lineIndex]?.trim() ?? "";
      if (line.length === 0) continue;

      const text = projectCodexMarkdownToPlainText(
        line.slice(0, MAX_REASONING_FALLBACK_LINE_CHARS),
      );
      if (text.length === 0) continue;
      return { itemId: item.itemId, text };
    }
  }

  return null;
}
