import { useEffect, useRef } from "react";

// Hook which closes the suggestion after a certain number of consecutive
// invalid queries are made. An invalid query is one which returns no items, and
// each invalid query must be longer than the previous one to close the menu
export function useCloseSuggestionMenuNoItems<Item>(
  items: Item[],
  usedQuery: string | undefined,
  closeMenu: () => void,
  invalidQueries = 3,
  itemsFresh: () => boolean = () => true,
  autoCloseWhenNoItems = true,
  settled = true,
) {
  const lastUsefulQueryLength = useRef(0);

  useEffect(() => {
    if (!autoCloseWhenNoItems || !settled || usedQuery === undefined || !itemsFresh()) {
      return;
    }

    if (items.length > 0) {
      lastUsefulQueryLength.current = usedQuery.length;
    } else if (
      usedQuery.length - lastUsefulQueryLength.current >
      invalidQueries
    ) {
      closeMenu();
    }
  }, [
    autoCloseWhenNoItems,
    closeMenu,
    invalidQueries,
    items.length,
    itemsFresh,
    settled,
    usedQuery,
  ]);
}
