import { hashKey, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import type { AuthorizedReadStamp } from "../../shared/authorized-read-stamp";
import type { ContentAccessContext } from "../../shared/content-access-context";
import {
  type LibraryPageBacklink,
} from "../../shared/library-module";
import type { ProjectionScope } from "../../shared/projection-stream";
import { readLibraryModule } from "./api";
import { invalidateExactQuery } from "./query-invalidation";
import { queryKeys } from "./query-keys";
import { useProjectionRegistration } from "./projection-invalidation-context";
import {
  admitResourceAuthorityQuery,
  resourceAuthorityQueryMeta,
} from "./resource-authority-query-cache";
import { useLibraryMetadata } from "./use-library-navigation";

interface PageBacklinksPage {
  readonly items: readonly LibraryPageBacklink[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly total: number;
  readonly sourcePageCount: number;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly commitSeq: number;
  readonly authorization: AuthorizedReadStamp | null;
}

const resolvePageBacklinksAuthority = (
  _queryKey: readonly unknown[],
  data: unknown,
) => {
  const candidate = data as {
    readonly authorization?: AuthorizedReadStamp | null;
    readonly pages?: readonly PageBacklinksPage[];
  } | null;
  const authorizations = [
    ...(candidate?.authorization ? [candidate.authorization] : []),
    ...(candidate?.pages ?? []).map((page) => page.authorization),
  ]
    .filter((authorization): authorization is AuthorizedReadStamp => authorization !== null) ?? [];
  return authorizations.length > 0 ? { authorizations } : null;
};

const pageBacklinksMeta = resourceAuthorityQueryMeta(resolvePageBacklinksAuthority);

export interface PageBacklinksReadModel {
  readonly items: readonly LibraryPageBacklink[];
  readonly sourcePageCount: number;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly error: Error | null;
  readonly loadMore: () => Promise<void>;
}

export const usePageBacklinks = (
  accessContext: ContentAccessContext,
  targetPageId: string,
): PageBacklinksReadModel => {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.library.pageBacklinks(accessContext, targetPageId);
  const library = useLibraryMetadata(targetPageId.length > 0);
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<PageBacklinksPage> => {
      const result = await readLibraryModule(accessContext, {
        read: {
          mode: "page_backlinks",
          targetPageId,
          limit: 50,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      if (result.value.value.kind !== "page_backlinks") {
        throw new Error(`Library read returned ${result.value.value.kind}, expected page_backlinks`);
      }
      return await admitResourceAuthorityQuery({
        ...result.value.value,
        libraryId: result.value.libraryId,
        storeEpoch: result.value.storeEpoch,
        commitSeq: result.value.commitSeq,
        authorization: result.value.authorization,
      }, resolvePageBacklinksAuthority);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: targetPageId.length > 0,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    meta: pageBacklinksMeta,
  });
  const latestPage = query.data?.pages.at(-1);
  const libraryId = library.data?.libraryId ?? latestPage?.libraryId ?? null;
  const scope: ProjectionScope | null = libraryId === null
    ? null
    : accessContext.kind === "library"
      ? { kind: "library", libraryId }
      : { kind: "project", libraryId, projectId: accessContext.projectId };
  useProjectionRegistration(scope
    ? {
        scope,
        consumerKey: hashKey(queryKey),
        getDependencies: () => ({ pageIds: [targetPageId] }),
        getCursor: () => latestPage
          ? { storeEpoch: latestPage.storeEpoch, commitSeq: latestPage.commitSeq }
          : null,
        invalidate: () => invalidateExactQuery(queryClient, queryKey),
      }
    : null);

  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    sourcePageCount: query.data?.pages[0]?.sourcePageCount ?? 0,
    loading: query.status === "pending",
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    error: query.error instanceof Error ? query.error : null,
    loadMore: async () => {
      await query.fetchNextPage();
    },
  };
};
