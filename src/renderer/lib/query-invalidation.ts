import {
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { ProjectionCursor } from "../../shared/projection-stream";

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

/** Invalidates each materialized member of a query family as an exact key. */
export const invalidateQueryFamilyExactly = async (
  queryClient: QueryClient,
  familyKey: QueryKey,
): Promise<void> => {
  const queries = queryClient.getQueryCache().findAll({ queryKey: familyKey });
  await Promise.all(
    queries.map((query) => invalidateExactQuery(queryClient, query.queryKey)),
  );
};

interface CursorBearingSnapshot {
  readonly storeEpoch: string;
  readonly commitSeq: number;
}

const snapshotCursor = (data: unknown): ProjectionCursor | null => {
  if (!data || typeof data !== "object") return null;
  if ("storeEpoch" in data && "commitSeq" in data) {
    const snapshot = data as CursorBearingSnapshot;
    if (
      typeof snapshot.storeEpoch !== "string"
      || !snapshot.storeEpoch
      || !Number.isSafeInteger(snapshot.commitSeq)
      || snapshot.commitSeq < 0
    ) {
      return null;
    }
    return {
      storeEpoch: snapshot.storeEpoch,
      commitSeq: snapshot.commitSeq,
    };
  }
  if (!("pages" in data) || !Array.isArray(data.pages) || data.pages.length === 0) {
    return null;
  }
  return commonCursor(data.pages.map(snapshotCursor));
};

const commonCursor = (
  cursors: readonly (ProjectionCursor | null)[],
): ProjectionCursor | null => {
  if (cursors.length === 0 || cursors.some((cursor) => cursor === null)) return null;
  const present = cursors as readonly ProjectionCursor[];
  const storeEpoch = present[0]?.storeEpoch;
  if (!storeEpoch || present.some((cursor) => cursor.storeEpoch !== storeEpoch)) return null;
  return {
    storeEpoch,
    commitSeq: Math.min(...present.map((cursor) => cursor.commitSeq)),
  };
};

/** Cursor satisfied by every supplied canonical snapshot. */
export const projectionCursorForSnapshots = (
  snapshots: readonly unknown[],
): ProjectionCursor | null => commonCursor(snapshots.map(snapshotCursor));

/** Cursor satisfied by every family member TanStack does not classify as disabled. */
export const queryFamilyProjectionCursor = (
  queryClient: QueryClient,
  familyKey: QueryKey,
): ProjectionCursor | null => {
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: familyKey })
    .filter((query) => !query.isDisabled());
  return projectionCursorForSnapshots(queries.map((query) => query.state.data));
};
