import { useEffect, useMemo } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Database, LayoutList } from "lucide-react";

import type { LibraryRouteTarget } from "../../../shared/library-module";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type LibraryDatabaseReadV2,
} from "../../../shared/database-module-v2";
import type { DatabaseViewId } from "../../../shared/database-identities";
import {
  readLibraryDatabaseModule,
  readDatabaseModule,
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

const readDatabaseForContext = async (
  accessProjectId: string | undefined,
  read: LibraryDatabaseReadV2,
) => {
  if (accessProjectId) {
    return await readDatabaseModule(accessProjectId, {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: accessProjectId,
      read,
    });
  }
  return await readLibraryDatabaseModule({
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    read,
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
  const descriptorKey = useMemo(
    () => queryKeys.libraryDatabases.descriptor(
      accessProjectId,
      databaseId,
      directViewId,
    ),
    [accessProjectId, databaseId, directViewId],
  );
  const descriptor = useQuery({
    queryKey: descriptorKey,
    queryFn: async () => {
      if (directViewId) return { viewId: directViewId } as const;
      if (!databaseId) throw new Error("Library Database target is unavailable");
      const result = await readDatabaseForContext(accessProjectId, {
          target: { kind: "database", databaseId },
          mode: "database",
      });
      if (!result.ok) throw new Error(result.error.message);
      if (result.value.value.kind !== "database") {
        throw new Error("Library Database read returned the wrong resource kind");
      }
      const viewId = result.value.value.value.database.defaultViewId;
      if (!viewId) throw new Error("Database has no default View");
      return {
        viewId,
        libraryId: result.value.libraryId,
        storeEpoch: result.value.storeEpoch,
        changeLogSeq: result.value.changeLogSeq,
      } as const;
    },
  });
  const viewId = descriptor.data?.viewId ?? null;
  const queryKey = useMemo(
    () => queryKeys.libraryDatabases.view(accessProjectId, viewId),
    [accessProjectId, viewId],
  );
  const query = useQuery({
    queryKey,
    enabled: viewId !== null,
    queryFn: async () => {
      const result = await readDatabaseForContext(accessProjectId, {
          target: { kind: "view", viewId: viewId as DatabaseViewId },
          mode: "query",
      });
      if (!result.ok) throw new Error(result.error.message);
      if (result.value.value.kind !== "query") {
        throw new Error("Library View read returned the wrong resource kind");
      }
      return {
        libraryId: result.value.libraryId,
        storeEpoch: result.value.storeEpoch,
        changeLogSeq: result.value.changeLogSeq,
        query: result.value.value.value,
      };
    },
  });

  useEffect(() => {
    const authority = query.data;
    if (!authority) return;
    const value = authority.query;
    return projectionRegistry.register({
      scope: accessProjectId
        ? {
            kind: "project",
            libraryId: authority.libraryId,
            projectId: accessProjectId,
          }
        : { kind: "library", libraryId: authority.libraryId },
      consumerKey: hashKey(["projection", descriptorKey, queryKey]),
      getDependencies: () => {
        const current = queryClient.getQueryData<typeof authority>(queryKey)?.query
          ?? value;
        return {
          databaseIds: [current.database.databaseId],
          dataSourceIds: [current.dataSource.dataSourceId],
          viewIds: [current.view.viewId],
          pageIds: current.rows.map((row) => row.page.pageId),
        };
      },
      getCursor: () => {
        const snapshots: unknown[] = [
          queryClient.getQueryData<typeof authority>(queryKey),
        ];
        if (!directViewId) {
          snapshots.push(queryClient.getQueryData(descriptorKey));
        }
        return projectionCursorForSnapshots(snapshots);
      },
      invalidate: async () => {
        await Promise.all([
          invalidateExactQuery(queryClient, descriptorKey),
          invalidateExactQuery(queryClient, queryKey),
        ]);
      },
    });
  }, [
    accessProjectId,
    descriptorKey,
    directViewId,
    projectionRegistry,
    query.data,
    queryClient,
    queryKey,
    viewId,
  ]);

  const error = descriptor.error ?? query.error;
  const value = query.data?.query;
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
        {descriptor.isPending || query.isPending ? (
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
