import { useEffect, useMemo } from "react";
import { hashKey, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Database, LayoutList } from "lucide-react";

import type { LibraryRouteTarget } from "../../../shared/library-module";
import type {
  DatabaseViewWindowSnapshot,
  LibraryDatabaseViewWindowSnapshot,
} from "../../../shared/database-views";
import {
  CoreApiError,
  readDatabaseViewWindow,
  readLibraryDatabaseViewWindow,
} from "../../lib/api";
import {
  invalidateExactQuery,
  projectionCursorForSnapshots,
} from "../../lib/query-invalidation";
import { queryKeys } from "../../lib/query-keys";
import { useProjectionInvalidationRegistry } from "../../lib/projection-invalidation-context";

type DatabaseRouteTarget = Extract<
  LibraryRouteTarget,
  { readonly kind: "database" | "view" }
>;

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const readDatabaseWindowForContext = async (
  accessProjectId: string | undefined,
  target:
    | { readonly databaseViewId: string }
    | { readonly databaseId: string },
  after: string | null,
): Promise<DatabaseViewWindowSnapshot | LibraryDatabaseViewWindowSnapshot> => {
  if (accessProjectId) {
    return await readDatabaseViewWindow(accessProjectId, {
      ...target,
      after: after ?? undefined,
      first: 100,
    });
  }
  return await readLibraryDatabaseViewWindow({
    ...target,
    after: after ?? undefined,
    first: 100,
  });
};

export function LibraryDatabaseRoute({
  target,
  accessProjectId,
  onBack,
  onOpenPage,
}: {
  target: DatabaseRouteTarget;
  accessProjectId?: string;
  onBack: () => void;
  onOpenPage: (pageId: string, title: string) => void;
}) {
  const queryClient = useQueryClient();
  const projectionRegistry = useProjectionInvalidationRegistry();
  const databaseId = target.kind === "database" ? target.databaseId : null;
  const directViewId = target.kind === "view" ? target.viewId : null;
  const targetIdentity = directViewId
    ? `view:${directViewId}`
    : databaseId
    ? `database:${databaseId}`
    : null;
  const queryKey = useMemo(
    () => queryKeys.libraryDatabases.view(accessProjectId, targetIdentity),
    [accessProjectId, targetIdentity],
  );
  const query = useInfiniteQuery({
    queryKey,
    enabled: targetIdentity !== null,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (targetIdentity?.startsWith("view:")) {
        return await readDatabaseWindowForContext(
          accessProjectId,
          { databaseViewId: targetIdentity.slice("view:".length) },
          pageParam,
        );
      }
      if (targetIdentity?.startsWith("database:")) {
        return await readDatabaseWindowForContext(
          accessProjectId,
          { databaseId: targetIdentity.slice("database:".length) },
          pageParam,
        );
      }
      throw new Error("Library Database target is unavailable");
    },
    getNextPageParam: (window) => window.nextCursor ?? undefined,
  });

  // A rejected continuation is disposable read state: drop the cached pages
  // and converge from the first window instead of surfacing an error.
  const queryError = query.error;
  useEffect(() => {
    if (
      queryError instanceof CoreApiError
      && queryError.isCursorRejection({ requestHadCursor: true })
    ) {
      void queryClient.resetQueries({ queryKey });
    }
  }, [queryClient, queryError, queryKey]);

  const windows = query.data?.pages;
  const firstWindow = windows?.[0];
  const value = useMemo(() => {
    if (!firstWindow || !windows) return undefined;
    return {
      ...firstWindow.query,
      rows: windows.flatMap((window) => window.query.rows),
    };
  }, [firstWindow, windows]);

  useEffect(() => {
    const authority = firstWindow;
    if (!authority) return;
    const initialValue = value;
    if (!initialValue) return;
    return projectionRegistry.register({
      scope: accessProjectId
        ? {
            kind: "project",
            libraryId: authority.libraryId,
            projectId: accessProjectId,
          }
        : { kind: "library", libraryId: authority.libraryId },
      consumerKey: hashKey(["projection", queryKey]),
      getDependencies: () => {
        const current = value ?? initialValue;
        return {
          databaseIds: [current.database.databaseId],
          dataSourceIds: [current.dataSource.dataSourceId],
          viewIds: [current.view.viewId],
          pageIds: current.rows.map((row) => row.page.pageId),
        };
      },
      getCursor: () => {
        return projectionCursorForSnapshots([
          queryClient.getQueryData(queryKey),
        ]);
      },
      invalidate: async () => {
        await invalidateExactQuery(queryClient, queryKey);
      },
    });
  }, [
    accessProjectId,
    firstWindow,
    projectionRegistry,
    query.data,
    queryClient,
    queryKey,
    value,
  ]);

  const error = query.error;
  const visibleProperties = value?.properties.filter(
    (property) =>
      property.lifecycle === "active" &&
      value.view.config.display.propertyIds.includes(property.propertyId),
  ) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-token-border/70 px-3">
        <button
          type="button"
          aria-label="Back to Library"
          className="flex size-7 items-center justify-center rounded-md text-token-text-secondary hover:bg-token-list-hover-background hover:text-token-text-primary"
          onClick={onBack}
        >
          <ArrowLeft className="icon-sm" />
        </button>
        {value ? (
          <>
            <Database className="ml-1 icon-sm text-token-text-secondary" aria-hidden />
            <span className="min-w-0 truncate text-sm font-medium text-token-text-primary">
              {value.database.name || "Untitled Database"}
            </span>
            <span className="text-token-description-foreground">/</span>
            <LayoutList className="icon-xs text-token-text-secondary" aria-hidden />
            <span className="truncate text-sm text-token-text-secondary">
              {value.view.name || "Untitled View"}
            </span>
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {query.isPending ? (
          <div className="py-20 text-center text-sm text-token-description-foreground" role="status">
            Opening Database…
          </div>
        ) : error ? (
          <div className="py-20 text-center text-sm text-token-description-foreground">
            {error instanceof Error ? error.message : "Database is unavailable."}
          </div>
        ) : value ? (
          <div className="mx-auto w-full max-w-6xl">
            <div className="mb-5">
              <h1 className="text-2xl font-semibold tracking-tight text-token-text-primary">
                {value.database.name || "Untitled Database"}
              </h1>
              <p className="mt-1 text-sm text-token-description-foreground">
                {value.rows.length} {value.rows.length === 1 ? "Page" : "Pages"} · {value.view.name}
              </p>
            </div>
            <div className="min-w-max border-y border-token-border/70">
              <div
                className="grid h-9 items-center gap-4 border-b border-token-border/70 px-3 text-xs font-medium text-token-text-secondary"
                style={{ gridTemplateColumns: `minmax(16rem,1.5fr) repeat(${visibleProperties.length},minmax(9rem,1fr))` }}
              >
                <span>Page</span>
                {visibleProperties.map((property) => (
                  <span key={property.propertyId} className="truncate">{property.name}</span>
                ))}
              </div>
              {value.rows.map((row) => (
                <button
                  type="button"
                  key={row.page.pageId}
                  className="grid h-11 w-full items-center gap-4 border-b border-token-border/50 px-3 text-left text-sm last:border-b-0 hover:bg-token-list-hover-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                  style={{ gridTemplateColumns: `minmax(16rem,1.5fr) repeat(${visibleProperties.length},minmax(9rem,1fr))` }}
                  onClick={() => onOpenPage(
                    row.page.pageId,
                    row.page.title || "Untitled",
                  )}
                >
                  <span className="truncate font-medium text-token-text-primary">
                    {row.page.title || "Untitled"}
                  </span>
                  {visibleProperties.map((property) => (
                    <span key={property.propertyId} className="truncate text-token-text-secondary">
                      {displayValue(row.values[property.propertyId]?.value)}
                    </span>
                  ))}
                </button>
              ))}
              {value.rows.length === 0 ? (
                <div className="px-3 py-12 text-center text-sm text-token-description-foreground">
                  This View has no Pages.
                </div>
              ) : null}
            </div>
            {query.hasNextPage ? (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  className="text-sm font-medium text-token-text-secondary hover:text-token-text-primary"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? "Loading…" : "Show more"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
