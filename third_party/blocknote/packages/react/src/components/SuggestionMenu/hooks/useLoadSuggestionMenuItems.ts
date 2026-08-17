import { useEffect, useMemo, useRef, useState } from "react";

// Hook which loads the items for a suggestion menu and returns them along with
// information whether the current query is still being processed, and the
// query that was used to retrieve the last set of items.
export function useLoadSuggestionMenuItems<T>(
  query: string,
  getItems: (query: string) => Promise<T[]>,
  getImmediateItems?: (query: string) => T[],
  requestScopeKey?: string,
): {
  items: T[];
  usedQuery: string | undefined;
  usedRequestScopeKey: string | undefined;
  loadingState: "loading-initial" | "loading" | "loaded";
} {
  const [items, setItems] = useState<T[]>([]);
  const immediateItems = useMemo(
    () => getImmediateItems?.(query),
    [getImmediateItems, query, requestScopeKey],
  );
  const [loading, setLoading] = useState(false);

  const currentQuery = useRef<string | undefined>(undefined);
  const currentRequestScopeKey = useRef<string | undefined>(undefined);
  const usedQuery = useRef<string | undefined>(undefined);
  const usedRequestScopeKey = useRef<string | undefined>(undefined);
  const latestRequestId = useRef(0);

  useEffect(() => {
    const thisQuery = query;
    const thisRequestScopeKey = requestScopeKey;
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    currentQuery.current = query;
    currentRequestScopeKey.current = requestScopeKey;
    if (usedRequestScopeKey.current !== thisRequestScopeKey) {
      setItems([]);
      usedQuery.current = undefined;
      usedRequestScopeKey.current = undefined;
    }

    setLoading(true);

    void getItems(query).then((items) => {
      if (
        latestRequestId.current !== requestId ||
        currentQuery.current !== thisQuery ||
        currentRequestScopeKey.current !== thisRequestScopeKey
      ) {
        // outdated query returned, ignore the result
        return;
      }

      setItems(items);
      setLoading(false);
      usedQuery.current = thisQuery;
      usedRequestScopeKey.current = thisRequestScopeKey;
    }).catch(() => {
      if (
        latestRequestId.current !== requestId ||
        currentQuery.current !== thisQuery ||
        currentRequestScopeKey.current !== thisRequestScopeKey
      ) {
        return;
      }

      setItems([]);
      setLoading(false);
      usedQuery.current = thisQuery;
      usedRequestScopeKey.current = thisRequestScopeKey;
    });
  }, [query, getItems, requestScopeKey]);

  const scopeIsCurrent = currentRequestScopeKey.current === requestScopeKey;
  const currentAsyncItems = scopeIsCurrent && usedQuery.current === query && !loading;
  const usingImmediateItems = immediateItems !== undefined && !currentAsyncItems;
  return {
    items: usingImmediateItems ? immediateItems : scopeIsCurrent ? items : [],
    // The query that was used to retrieve the last set of items may not be the
    // same as the current query as the items from the current query may not
    // have been retrieved yet. This is useful when using the returns of this
    // hook in other hooks.
    usedQuery: usingImmediateItems ? query : scopeIsCurrent ? usedQuery.current : undefined,
    usedRequestScopeKey: usingImmediateItems
      ? requestScopeKey
      : scopeIsCurrent ? usedRequestScopeKey.current : undefined,
    loadingState:
      usingImmediateItems
        ? "loading"
        : !scopeIsCurrent || usedQuery.current === undefined
        ? "loading-initial"
        : loading
          ? "loading"
          : "loaded",
  };
}
