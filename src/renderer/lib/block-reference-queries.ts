import { useEffect, useEffectEvent } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PageTargetReadModel } from "../../shared/page-targets";
import type { PageOwnershipPathReadModel } from "../../shared/page-ownership-paths";
import type { DatabaseViewReadModel } from "../../shared/database-views";
import {
  readDatabaseViewReference,
  resolvePageOwnershipPath,
  resolvePageTarget,
} from "./api";
import { queryKeys } from "./query-keys";
import { resolveRendererTransport } from "./renderer-transport";
import { createProjectEventSubscriptionHub } from "./project-event-subscription-hub";
import { invalidateExactQuery } from "./query-invalidation";
import { useProjectionInvalidationRegistry } from "./projection-invalidation-context";
import type { ProjectionDependencies } from "./projection-invalidation-registry";
import type { ProjectionCursor, ProjectionScope } from "../../shared/projection-stream";
import { useLibraryMetadata } from "./use-library-navigation";

export interface ReferenceQueryResult<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

const toError = (error: unknown): Error | null => {
  if (error === null || error === undefined) return null;
  return error instanceof Error ? error : new Error(String(error));
};

const pageOwnershipPathChangeSubscriptions =
  createProjectEventSubscriptionHub({
    subscribeToProject: (projectId, listener) =>
      resolveRendererTransport().subscribePageOwnershipPathChanges(
        projectId,
        listener,
      ),
  });

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

const useProjectionQueryRefresh = (input: {
  readonly scope: ProjectionScope | null;
  readonly dependencies: ProjectionDependencies;
  readonly cursor: ProjectionCursor | null;
  readonly queryKey: readonly unknown[];
}): void => {
  const queryClient = useQueryClient();
  const registry = useProjectionInvalidationRegistry();
  const consumerKey = hashKey(input.queryKey);
  const scopeKey = hashKey(["projection-scope", input.scope]);
  const getDependencies = useEffectEvent(() => input.dependencies);
  const getCursor = useEffectEvent(() => {
    const current = queryClient.getQueryData<{
      readonly storeEpoch: string;
      readonly changeLogSeq: number;
    }>(input.queryKey);
    return current
      ? {
          storeEpoch: current.storeEpoch,
          changeLogSeq: current.changeLogSeq,
        }
      : input.cursor;
  });
  const invalidate = useEffectEvent(() =>
    invalidateExactQuery(queryClient, input.queryKey),
  );
  const subscribe = useEffectEvent(() => {
    if (!input.scope) return;
    return registry.register({
      scope: input.scope,
      consumerKey,
      getDependencies,
      getCursor,
      invalidate,
    });
  });

  useEffect(() => {
    return subscribe();
  }, [consumerKey, scopeKey]);
};

export const usePageTargetReadModel = (
  requestingProjectId: string,
  targetBlockId: string,
): ReferenceQueryResult<PageTargetReadModel> => {
  const enabled = requestingProjectId.length > 0 && targetBlockId.length > 0;
  const library = useLibraryMetadata(enabled);
  const query = useQuery(pageTargetQueryOptions(requestingProjectId, targetBlockId));
  const libraryId = library.data?.libraryId ?? query.data?.libraryId ?? null;
  const queryKey = queryKeys.pageTargets.byId(requestingProjectId, targetBlockId);
  useProjectionQueryRefresh({
    scope: enabled && libraryId
      ? {
          kind: "project",
          libraryId,
          projectId: requestingProjectId,
        }
      : null,
    dependencies: { pageIds: [targetBlockId] },
    cursor: query.data
      ? { storeEpoch: query.data.storeEpoch, changeLogSeq: query.data.changeLogSeq }
      : null,
    queryKey,
  });
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
  const library = useLibraryMetadata(enabled);
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
  const libraryId = library.data?.libraryId ?? query.data?.libraryId ?? null;
  const observedPageIds = query.data?.status === "available"
    ? [targetPageId, ...query.data.ancestors.map((ancestor) => ancestor.pageId)]
    : [targetPageId];
  useProjectionQueryRefresh({
    scope: enabled && libraryId
      ? {
          kind: "project",
          libraryId,
          projectId: requestingProjectId,
        }
      : null,
    dependencies: { pageIds: observedPageIds },
    cursor: query.data
      ? { storeEpoch: query.data.storeEpoch, changeLogSeq: query.data.changeLogSeq }
      : null,
    queryKey,
  });

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
  const library = useLibraryMetadata(enabled);
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
  const libraryId = library.data?.libraryId ?? data?.libraryId ?? null;
  useProjectionQueryRefresh({
    scope: enabled && libraryId
      ? {
          kind: "project",
          libraryId,
          projectId: requestingProjectId,
        }
      : null,
    dependencies: {
      databaseIds: data ? [data.view.databaseBlockId] : [],
      dataSourceIds: data ? [data.dataSourceId] : [],
      viewIds: [databaseViewId],
      pageIds: data?.rows.map((row) => row.page.id) ?? [],
    },
    cursor: data
      ? { storeEpoch: data.storeEpoch, changeLogSeq: data.changeLogSeq }
      : null,
    queryKey,
  });
  return {
    data: data ?? null,
    loading: enabled && status === "pending",
    error: toError(error),
  };
};
