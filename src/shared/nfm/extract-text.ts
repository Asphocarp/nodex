import type { NfmBlock, NfmInlineContent } from "./types";
import { formatDateMentionPlainText } from "./date-mention";
import { parseNfm } from "./parser";
import { buildCardDeepLink } from "../card-deeplink";

export function extractPlainText(nfm: string, maxLength?: number): string {
  if (!nfm) return "";

  const blocks = parseNfm(nfm);
  const parts: string[] = [];
  collectText(blocks, parts);

  const result = parts.join(" ").replace(/\s+/g, " ").trim();
  if (maxLength && result.length > maxLength) {
    const contentLength = Math.max(0, maxLength - 3);
    return `${result.slice(0, contentLength).trimEnd()}...`;
  }
  return result;
}

function collectText(blocks: NfmBlock[], parts: string[]): void {
  for (const block of blocks) {
    if ("content" in block && Array.isArray(block.content)) {
      collectInlineText(block.content, parts);
    }

    if (block.type === "image") {
      collectInlineText(block.caption, parts);
    }

    if (block.type === "codeBlock") {
      parts.push(block.code);
    }

    if (block.type === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectInlineText(cell.content, parts);
        }
      }
    }

    if (block.type === "cardRef") {
      parts.push(block.cardId);
    }

    if (block.type === "mentionCard") {
      parts.push(buildCardDeepLink({ cardId: block.targetBlockId }));
    }

    if (block.type === "databaseViewRef") {
      parts.push(block.displayHint || block.databaseViewId);
    }

    if (block.type === "syncedBlockRef") {
      parts.push(block.sourceBlockId);
    }

    if (block.type === "templateRef") {
      parts.push(block.sourceBlockId);
    }

    if (block.type === "cardToggle") {
      parts.push(block.cardId, block.meta);
    }

    if (block.type === "threadSection") {
      if (block.label) parts.push(block.label);
      if (block.threadId) parts.push(block.threadId);
    }

    if (block.children.length === 0) continue;
    collectText(block.children, parts);
  }
}

function collectInlineText(items: NfmInlineContent[], parts: string[]): void {
  for (const item of items) {
    if (item.type === "text" || item.type === "link") {
      parts.push(item.text);
      continue;
    }

    if (item.type === "linebreak") {
      parts.push(" ");
      continue;
    }

    if (item.type === "threadMention") {
      parts.push(item.uuid);
      continue;
    }

    if (item.type === "dateMention") {
      parts.push(formatDateMentionPlainText(item));
      continue;
    }

    if (item.type === "attachment") {
      parts.push(item.name);
      continue;
    }

    if (item.type === "agentConfig") {
      const fields = [item.mode, item.model, item.reasoning].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      parts.push(...fields);
    }
  }
}
