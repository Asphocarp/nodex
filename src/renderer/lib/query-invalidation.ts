import {
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

const trailingRefreshes = new WeakMap<
  QueryClient,
  Map<string, Promise<void>>
>();

/**
 * Invalidates one canonical query and closes TanStack Query's initial-fetch
 * dedupe window with one coalesced trailing read.
 */
export const invalidateExactQuery = (
  queryClient: QueryClient,
  queryKey: QueryKey,
): Promise<void> => {
  const state = queryClient.getQueryState(queryKey);
  const needsTrailingRead = state?.fetchStatus === "fetching"
    && state.data === undefined;
  if (!needsTrailingRead) {
    return queryClient.invalidateQueries({ queryKey, exact: true });
  }

  const queryHash = hashKey(queryKey);
  const clientRefreshes = trailingRefreshes.get(queryClient) ?? new Map();
  const existing = clientRefreshes.get(queryHash);
  if (existing) return existing;
  trailingRefreshes.set(queryClient, clientRefreshes);

  const refresh = queryClient
    .invalidateQueries({ queryKey, exact: true })
    .then(() => queryClient.refetchQueries({
      queryKey,
      exact: true,
      type: "active",
    }))
    .finally(() => {
      if (clientRefreshes.get(queryHash) !== refresh) return;
      clientRefreshes.delete(queryHash);
      if (clientRefreshes.size === 0) trailingRefreshes.delete(queryClient);
    });
  clientRefreshes.set(queryHash, refresh);
  return refresh;
};
