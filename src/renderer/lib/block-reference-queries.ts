import { useEffect, useEffectEvent } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CardTargetReadModel } from "../../shared/card-targets";
import type { DatabaseViewReadModel } from "../../shared/database-views";
import {
  readDatabaseViewReference,
  resolveCardTarget,
} from "./api";
import { queryKeys } from "./query-keys";
import { resolveRendererTransport } from "./renderer-transport";
import { createProjectBoardChangeSubscriptionHub } from "./project-board-change-subscription-hub";
import { createProjectCardTargetChangeSubscriptionHub } from "./project-card-target-change-subscription-hub";

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

const cardTargetChangeSubscriptions =
  createProjectCardTargetChangeSubscriptionHub({
    subscribeToProject: (projectId, listener) =>
      resolveRendererTransport().subscribeCardTargetChanges(projectId, listener),
  });

interface CardTargetChangeSubscription {
  readonly requestingProjectId: string;
  readonly targetBlockId: string;
  readonly targetProjectId: string | null;
}

const cardTargetQueryOptions = (
  requestingProjectId: string,
  targetBlockId: string,
) => ({
  queryKey: queryKeys.cardTargets.byId(requestingProjectId, targetBlockId),
  queryFn: () => resolveCardTarget({ requestingProjectId, targetBlockId }),
  enabled: requestingProjectId.length > 0 && targetBlockId.length > 0,
  staleTime: 5_000,
  refetchOnWindowFocus: true,
});

const readTargetProjectId = (
  model: CardTargetReadModel | null | undefined,
): string | null => {
  if (model?.status === "available") return model.card.projectId;
  if (model?.status === "deleted") return model.projectId;
  return null;
};

const useCardTargetChangeRefresh = (
  targets: readonly CardTargetChangeSubscription[],
): void => {
  const queryClient = useQueryClient();
  const activeTargets = targets.flatMap((target) =>
    target.targetProjectId
      ? [{ ...target, targetProjectId: target.targetProjectId }]
      : []);
  const subscriptionFingerprint = JSON.stringify(activeTargets);
  const subscribeToTargets = useEffectEvent(() => {
    const unsubscribers = activeTargets.map((target) => {
      const queryKey = queryKeys.cardTargets.byId(
        target.requestingProjectId,
        target.targetBlockId,
      );
      return cardTargetChangeSubscriptions.subscribe(
        target.targetProjectId,
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

export const useCardTargetReadModel = (
  requestingProjectId: string,
  targetBlockId: string,
): ReferenceQueryResult<CardTargetReadModel> => {
  const enabled = requestingProjectId.length > 0 && targetBlockId.length > 0;
  const query = useQuery(cardTargetQueryOptions(requestingProjectId, targetBlockId));
  useCardTargetChangeRefresh([{
    requestingProjectId,
    targetBlockId,
    targetProjectId: readTargetProjectId(query.data),
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
export const useCardTargetReadModels = (
  requestingProjectId: string,
  targetBlockIds: readonly string[],
): readonly ReferenceQueryResult<CardTargetReadModel>[] => {
  const queries = useQueries({
    queries: targetBlockIds.map((targetBlockId) =>
      cardTargetQueryOptions(requestingProjectId, targetBlockId)),
  });
  useCardTargetChangeRefresh(targetBlockIds.map((targetBlockId, index) => ({
    requestingProjectId,
    targetBlockId,
    targetProjectId: readTargetProjectId(queries[index]?.data),
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
