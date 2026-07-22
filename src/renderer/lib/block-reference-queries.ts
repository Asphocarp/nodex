import { useEffect, useEffectEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PageTargetReadModel } from "../../shared/page-targets";
import type { PageOwnershipPathReadModel } from "../../shared/page-ownership-paths";
import type { DatabaseViewReadModel } from "../../shared/database-views";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";
import {
  readDatabaseViewReference,
  resolvePageOwnershipPath,
  resolvePageTarget,
} from "./api";
import { queryKeys } from "./query-keys";
import { resolveRendererTransport } from "./renderer-transport";
import { createProjectBoardChangeSubscriptionHub } from "./project-board-change-subscription-hub";
import { createProjectPageTargetChangeSubscriptionHub } from "./project-page-target-change-subscription-hub";
import { invalidateExactQuery } from "./query-invalidation";

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

const pageOwnershipPathChangeSubscriptions =
  createProjectBoardChangeSubscriptionHub({
    subscribeToProject: (projectId, listener) =>
      resolveRendererTransport().subscribePageOwnershipPathChanges(
        projectId,
        listener,
      ),
  });

interface PageTargetChangeSubscription {
  readonly requestingProjectId: string;
  readonly targetBlockId: string;
  readonly queryKey: readonly unknown[];
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
    const targetUnsubscribers = targets.map((target) => {
      return pageTargetChangeSubscriptions.subscribe(
        target.requestingProjectId,
        target.targetBlockId,
        JSON.stringify(target.queryKey),
        () => {
          void invalidateExactQuery(queryClient, target.queryKey);
        },
      );
    });
    const projectUnsubscribers = [...new Set(
      targets.map((target) => target.requestingProjectId),
    )].map((projectId) =>
      resolveRendererTransport().subscribeAuthorityResync(projectId, () => {
        for (const target of targets) {
          if (target.requestingProjectId !== projectId) continue;
          void invalidateExactQuery(queryClient, target.queryKey);
        }
      })
    );
    return () => {
      for (const unsubscribe of [
        ...targetUnsubscribers,
        ...projectUnsubscribers,
      ]) unsubscribe();
    };
  });

  useEffect(() => subscribeToTargets(), [subscriptionFingerprint]);
};

const useBoardChangeRefresh = (
  projectId: string | null,
  consumerKey: string,
  queryKey: readonly unknown[],
): void => {
  const queryClient = useQueryClient();
  const refreshQuery = useEffectEvent(() => {
    void invalidateExactQuery(queryClient, queryKey);
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
  usePageTargetChangeRefresh(enabled ? [{
    requestingProjectId,
    targetBlockId,
    queryKey: queryKeys.pageTargets.byId(requestingProjectId, targetBlockId),
  }] : []);
  return {
    data: query.data ?? null,
    loading: enabled && query.status === "pending",
    error: toError(query.error),
  };
};

export const usePageOwnershipPathReadModel = (
  requestingProjectId: string,
  targetPageId: string,
): ReferenceQueryResult<PageOwnershipPathReadModel> => {
  const queryClient = useQueryClient();
  const enabled = requestingProjectId.length > 0 && targetPageId.length > 0;
  const queryKey = queryKeys.pageOwnershipPaths.byPage(
    requestingProjectId,
    targetPageId,
  );
  const query = useQuery({
    queryKey,
    queryFn: () => resolvePageOwnershipPath({
      requestingProjectId,
      targetPageId,
    }),
    enabled,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  const observedPageIds = query.data?.status === "available"
    ? [targetPageId, ...query.data.ancestors.map((ancestor) => ancestor.pageId)]
    : [targetPageId];
  usePageTargetChangeRefresh((enabled ? observedPageIds : []).map((targetBlockId) => ({
    requestingProjectId,
    targetBlockId,
    queryKey,
  })));

  useEffect(() => {
    if (!enabled) return;
    return pageOwnershipPathChangeSubscriptions.subscribe(
      requestingProjectId,
      "page-ownership-paths",
      () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.pageOwnershipPaths.byProject(requestingProjectId),
        });
      },
    );
  }, [enabled, queryClient, requestingProjectId]);

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
  const queryClient = useQueryClient();
  const queryKey = queryKeys.blockReferences.databaseView(
    requestingProjectId,
    databaseViewId,
    hostBlockId,
  );
  const { data, error, status } = useQuery({
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
    data?.view.projectId ?? null,
    JSON.stringify(queryKey),
    queryKey,
  );
  const pageEventAffectsView = useEffectEvent((
    event: PageTargetChangedEvent,
  ): boolean => {
    if (!data) return true;
    if (event.affectedDatabaseIds.includes(data.view.databaseBlockId)) {
      return true;
    }
    return data.rows.some((row) => row.page.id === event.targetPageId);
  });
  const refreshView = useEffectEvent(() => {
    void invalidateExactQuery(queryClient, queryKey);
  });
  useEffect(() => {
    if (!enabled) return;
    const transport = resolveRendererTransport();
    const unsubscribePageTarget = transport.subscribePageTargetChanges(
      requestingProjectId,
      (event) => {
        if (!pageEventAffectsView(event)) return;
        refreshView();
      },
    );
    const unsubscribeAuthorityResync = transport.subscribeAuthorityResync(
      requestingProjectId,
      refreshView,
    );
    return () => {
      unsubscribePageTarget();
      unsubscribeAuthorityResync();
    };
  }, [enabled, requestingProjectId]);
  return {
    data: data ?? null,
    loading: enabled && status === "pending",
    error: toError(error),
  };
};
