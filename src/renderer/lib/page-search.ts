import type { DatabasePageSummary } from "./types";
import { normalizeSearchText } from "./search-text";

export {
  matchesSearchTokens,
  tokenizeSearchQuery,
} from "./search-text";

export function buildPageSearchText(card: Pick<
  DatabasePageSummary,
  "id" | "title" | "descriptionPreview" | "tags" | "assignee"
>): string {
  return normalizeSearchText([
    card.id,
    card.title,
    card.descriptionPreview,
    card.tags.join(" "),
    card.assignee ?? "",
  ].join(" "));
}
