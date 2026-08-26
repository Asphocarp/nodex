import { useEffect, useRef } from "react";
import type { SuggestionMenuCloseReason } from "@blocknote/core/extensions";

// Hook which closes the suggestion after a certain number of consecutive
// invalid queries are made. An invalid query is one which returns no items, and
// each invalid query must be longer than the previous one to close the menu
export function useCloseSuggestionMenuNoItems<Item>(
  items: Item[],
  usedQuery: string | undefined,
  closeMenu: (reason?: SuggestionMenuCloseReason) => void,
  invalidQueries = 3,
  itemsFresh: () => boolean = () => true,
  autoCloseWhenNoItems = true,
  settled = true,
  isComposing = false,
) {
  const lastUsefulQueryLength = useRef(0);

  useEffect(() => {
    if (
      isComposing ||
      !autoCloseWhenNoItems ||
      !settled ||
      usedQuery === undefined ||
      !itemsFresh()
    ) {
      return;
    }

    if (items.length > 0) {
      lastUsefulQueryLength.current = usedQuery.length;
    } else if (
      usedQuery.length - lastUsefulQueryLength.current >
      invalidQueries
    ) {
      closeMenu("invalid-query");
    }
  }, [
    autoCloseWhenNoItems,
    closeMenu,
    invalidQueries,
    items.length,
    itemsFresh,
    isComposing,
    settled,
    usedQuery,
  ]);
}
