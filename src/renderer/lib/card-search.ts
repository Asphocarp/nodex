import type { CardSummary } from "./types";
import { normalizeSearchText } from "./search-text";

export {
  matchesSearchTokens,
  tokenizeSearchQuery,
} from "./search-text";

export function buildCardSearchText(card: Pick<
  CardSummary,
  "id" | "title" | "descriptionPreview" | "tags" | "assignee" | "agentStatus"
>): string {
  return normalizeSearchText([
    card.id,
    card.title,
    card.descriptionPreview,
    card.tags.join(" "),
    card.assignee ?? "",
    card.agentStatus ?? "",
  ].join(" "));
}
