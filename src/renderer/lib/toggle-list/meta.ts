import { getPriorityShortLabel } from "../priority-presentation";
import { EMPTY_DISPLAY_VALUE_TOKEN } from "./meta-chips";
import type { ToggleListCard, ToggleListPropertyKey } from "./types";

export const EMPTY_DISPLAY_VALUE_LABEL = `[${EMPTY_DISPLAY_VALUE_TOKEN}]`;

export interface FormatMetaOptions {
  showEmptyEstimate?: boolean;
  showEmptyPriority?: boolean;
}

export function formatMeta(
  card: ToggleListCard,
  propertyOrder: ToggleListPropertyKey[],
  hiddenProperties: ToggleListPropertyKey[],
  showEmptyEstimateOrOptions: boolean | FormatMetaOptions = false,
): string {
  const options: FormatMetaOptions =
    typeof showEmptyEstimateOrOptions === "boolean"
      ? { showEmptyEstimate: showEmptyEstimateOrOptions }
      : showEmptyEstimateOrOptions;

  const hidden = new Set(hiddenProperties);
  const tokens = propertyOrder
    .filter((property) => !hidden.has(property))
    .flatMap((property) => formatPropertyTokens(card, property, options));

  return tokens.join(" ");
}

function formatPropertyTokens(
  card: ToggleListCard,
  property: ToggleListPropertyKey,
  options: FormatMetaOptions,
): string[] {
  switch (property) {
    case "priority":
      if (card.priority) return [`[${getPriorityShortLabel(card.priority)}]`];
      return options.showEmptyPriority ? [EMPTY_DISPLAY_VALUE_LABEL] : [];
    case "estimate":
      if (card.estimate) return [`[${card.estimate.toUpperCase()}]`];
      return options.showEmptyEstimate ? [EMPTY_DISPLAY_VALUE_LABEL] : [];
    case "status":
      return [`[${card.columnName}]`];
    case "tags":
      return card.tags.map((tag) => `[${tag}]`);
    default:
      return [];
  }
}
