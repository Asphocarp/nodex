import { useEffect, useEffectEvent } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PageTargetReadModel } from "../../shared/page-targets";
import type { DatabaseViewReadModel } from "../../shared/database-views";
import {
  readDatabaseViewReference,
  resolvePageTarget,
} from "./api";
import { queryKeys } from "./query-keys";
import { resolveRendererTransport } from "./renderer-transport";
import { createProjectBoardChangeSubscriptionHub } from "./project-board-change-subscription-hub";
import { createProjectPageTargetChangeSubscriptionHub } from "./project-page-target-change-subscription-hub";

export interface ReferenceQueryResult<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

const toError = (error: unknown): Error | null => {
  if (error === null || error === undefined) return null;
  return error instanceof Error ? error : new Error(String(error));
};

const boardChangeSubscriptions = createProjectBoardChangeSubscriptionHub({
  subscribeToProject: (projectId, listener) =>
    resolveRendererTransport().subscribeBoardChanges(projectId, listener),
});

const pageTargetChangeSubscriptions =
  createProjectPageTargetChangeSubscriptionHub({
    subscribeToProject: (projectId, listener) =>
      resolveRendererTransport().subscribePageTargetChanges(projectId, listener),
  });

interface PageTargetChangeSubscription {
  readonly requestingProjectId: string;
  readonly targetBlockId: string;
}

const pageTargetQueryOptions = (
  requestingProjectId: string,
  targetBlockId: string,
) => ({
  queryKey: queryKeys.pageTargets.byId(requestingProjectId, targetBlockId),
  queryFn: () => resolvePageTarget({
    requestingProjectId,
    targetPageId: targetBlockId,
  }),
  enabled: requestingProjectId.length > 0 && targetBlockId.length > 0,
  staleTime: 5_000,
  refetchOnWindowFocus: true,
});

const usePageTargetChangeRefresh = (
  targets: readonly PageTargetChangeSubscription[],
): void => {
  const queryClient = useQueryClient();
  const subscriptionFingerprint = JSON.stringify(targets);
  const subscribeToTargets = useEffectEvent(() => {
    const unsubscribers = targets.map((target) => {
      const queryKey = queryKeys.pageTargets.byId(
        target.requestingProjectId,
        target.targetBlockId,
      );
      return pageTargetChangeSubscriptions.subscribe(
        target.requestingProjectId,
        target.targetBlockId,
        JSON.stringify(queryKey),
        () => {
          void queryClient.invalidateQueries({ queryKey, exact: true });
        },
      );
    });
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  });

  useEffect(() => subscribeToTargets(), [subscriptionFingerprint]);
};

const useBoardChangeRefresh = (
  projectId: string | null,
  consumerKey: string,
  refresh: () => Promise<unknown>,
): void => {
  const refreshQuery = useEffectEvent(() => {
    void refresh();
  });

  useEffect(() => {
    if (!projectId) return;
    return boardChangeSubscriptions.subscribe(projectId, consumerKey, () => {
      refreshQuery();
    });
  }, [consumerKey, projectId]);
};

export const usePageTargetReadModel = (
  requestingProjectId: string,
  targetBlockId: string,
): ReferenceQueryResult<PageTargetReadModel> => {
  const enabled = requestingProjectId.length > 0 && targetBlockId.length > 0;
  const query = useQuery(pageTargetQueryOptions(requestingProjectId, targetBlockId));
  usePageTargetChangeRefresh([{
    requestingProjectId,
    targetBlockId,
  }]);
  return {
    data: query.data ?? null,
    loading: enabled && query.status === "pending",
    error: toError(query.error),
  };
};

/**
 * Resolve a dynamic identity path without violating the Rules of Hooks. Every
 * available target stays subscribed to its identity-specific change stream,
 * including ancestors currently collapsed into breadcrumb overflow.
 */
export const usePageTargetReadModels = (
  requestingProjectId: string,
  targetBlockIds: readonly string[],
): readonly ReferenceQueryResult<PageTargetReadModel>[] => {
  const queries = useQueries({
    queries: targetBlockIds.map((targetBlockId) =>
      pageTargetQueryOptions(requestingProjectId, targetBlockId)),
  });
  usePageTargetChangeRefresh(targetBlockIds.map((targetBlockId) => ({
    requestingProjectId,
    targetBlockId,
  })));

  return queries.map((query, index) => ({
    data: query.data ?? null,
    loading:
      requestingProjectId.length > 0
      && (targetBlockIds[index]?.length ?? 0) > 0
      && query.status === "pending",
    error: toError(query.error),
  }));
};

export const useDatabaseViewReadModel = (
  requestingProjectId: string,
  databaseViewId: string,
  hostBlockId?: string,
): ReferenceQueryResult<DatabaseViewReadModel> => {
  const enabled = requestingProjectId.length > 0 && databaseViewId.length > 0;
  const queryKey = queryKeys.blockReferences.databaseView(
    requestingProjectId,
    databaseViewId,
    hostBlockId,
  );
  const query = useQuery({
    queryKey,
    queryFn: () => readDatabaseViewReference({
      requestingProjectId,
      databaseViewId,
      ...(hostBlockId ? { hostBlockId } : {}),
    }),
    enabled,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  useBoardChangeRefresh(
    query.data?.view.projectId ?? null,
    JSON.stringify(queryKey),
    query.refetch,
  );
  return {
    data: query.data ?? null,
    loading: enabled && query.status === "pending",
    error: toError(query.error),
  };
};
