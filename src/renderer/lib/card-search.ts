import type { CardSummary } from "./types";
import { extractPlainText } from "./nfm/extract-text";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

export function buildCardSearchText(card: Pick<
  CardSummary,
  "id" | "title" | "tags" | "assignee" | "agentStatus"
> & { descriptionPreview?: string; description?: string }): string {
  const descriptionText = typeof card.descriptionPreview === "string"
    ? card.descriptionPreview
    : extractPlainText(card.description ?? "");
  return normalize([
    card.id,
    card.title,
    descriptionText,
    card.tags.join(" "),
    card.assignee ?? "",
    card.agentStatus ?? "",
  ].join(" "));
}

export function matchesSearchTokens(
  searchableText: string,
  tokens: string[],
): boolean {
  if (tokens.length === 0) return true;
  if (!searchableText) return false;
  return tokens.every((token) => searchableText.includes(token));
}
