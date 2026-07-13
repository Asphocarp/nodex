import { useEffect, useEffectEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CardTargetReadModel } from "../../shared/card-targets";
import type { DatabaseViewReadModel } from "../../shared/database-views";
import {
  readDatabaseViewReference,
  resolveCardTarget,
} from "./api";
import { queryKeys } from "./query-keys";
import { resolveRendererTransport } from "./renderer-transport";
import { createProjectBoardChangeSubscriptionHub } from "./project-board-change-subscription-hub";

interface ReferenceQueryResult<T> {
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
  const queryKey = queryKeys.cardTargets.byId(
    requestingProjectId,
    targetBlockId,
  );
  const query = useQuery({
    queryKey,
    queryFn: () => resolveCardTarget({ requestingProjectId, targetBlockId }),
    enabled,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  const targetProjectId = query.data?.status === "available"
    ? query.data.card.projectId
    : null;
  useBoardChangeRefresh(targetProjectId, JSON.stringify(queryKey), query.refetch);
  return {
    data: query.data ?? null,
    loading: enabled && query.status === "pending",
    error: toError(query.error),
  };
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
