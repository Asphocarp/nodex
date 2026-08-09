import { useEffect, useMemo, useRef, useState } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ContentAccessContext } from "../../../shared/content-access-context";
import type { WorkbenchDbViewSurfaceConfig } from "../../../shared/workbench-scene";
import type {
  DatabaseViewGroupScopeInput,
  DatabaseViewGroupsSnapshot,
  DatabaseViewWindowSnapshot,
} from "../../../shared/database-views";
import {
  readDatabaseViewGroups,
  readDatabaseViewWindow,
  readLibraryDatabaseViewGroups,
  readLibraryDatabaseViewWindow,
} from "../../lib/api";
import {
  buildDatabaseViewWindowRenderModel,
  groupScopeKeyForColumn,
  UNGROUPED_SCOPE_KEY,
} from "../../lib/database-view-render-model";
import type { ColumnPaginationState } from "../../lib/kanban-store";
import {
  invalidateExactQuery,
  projectionCursorForSnapshots,
} from "../../lib/query-invalidation";
import { queryKeys } from "../../lib/query-keys";
import { useProjectionInvalidationRegistry } from "../../lib/projection-invalidation-context";
import type { ProjectionInvalidationCause } from "../../lib/projection-invalidation-registry";
import {
  admitResourceAuthorityQuery,
  resourceAuthorityQueryMeta,
} from "../../lib/resource-authority-query-cache";
import { DatabaseViewTabSurface } from "./workbench-db-view-panel";

type DatabaseReadTarget =
  | { readonly databaseViewId: string }
  | { readonly databaseId: string };

type DatabaseSurfaceTarget = Exclude<
  WorkbenchDbViewSurfaceConfig["target"],
  { readonly kind: "project-default" }
>;

interface ScopedWindow {
  readonly scopeKey: string;
  readonly scope?: DatabaseViewGroupScopeInput;
  readonly snapshot: DatabaseViewWindowSnapshot<string | null>;
}

const resolveDatabaseSurfaceAuthority = (_queryKey: readonly unknown[], data: unknown) => {
  const snapshot = data as {
    readonly groups: DatabaseViewGroupsSnapshot<string | null>;
    readonly scopedWindows: readonly ScopedWindow[];
  } | undefined;
  return snapshot
    ? {
        authorizations: [
          snapshot.groups.authorization,
          ...snapshot.scopedWindows.map((window) => window.snapshot.authorization),
        ],
      }
    : null;
};

interface ContinuationState {
  readonly windows: readonly DatabaseViewWindowSnapshot<string | null>[];
  readonly loading: boolean;
  readonly error: string | null;
}

const readDatabaseWindowForContext = async (
  accessContext: ContentAccessContext,
  target: DatabaseReadTarget,
  input: {
    readonly after?: string;
    readonly groupScope?: DatabaseViewGroupScopeInput;
    readonly minimumCommitSeq?: number;
  } = {},
): Promise<DatabaseViewWindowSnapshot<string | null>> => {
  if (accessContext.kind === "project") {
    return await readDatabaseViewWindow(accessContext.projectId, {
      ...target,
      ...input,
      first: 50,
    });
  }
  return await readLibraryDatabaseViewWindow({
    ...target,
    ...input,
    first: 50,
  });
};

const readDatabaseGroupsForContext = async (
  accessContext: ContentAccessContext,
  target: DatabaseReadTarget,
  minimumCommitSeq = 0,
): Promise<DatabaseViewGroupsSnapshot<string | null>> => {
  if (accessContext.kind === "project") {
    return await readDatabaseViewGroups(accessContext.projectId, {
      ...target,
      ...(minimumCommitSeq > 0 ? { minimumCommitSeq } : {}),
    });
  }
  return await readLibraryDatabaseViewGroups({
    ...target,
    ...(minimumCommitSeq > 0 ? { minimumCommitSeq } : {}),
  });
};

const readTargetFromIdentity = (identity: string): DatabaseReadTarget => {
  if (identity.startsWith("database:")) {
    return { databaseId: identity.slice("database:".length) };
  }
  return { databaseViewId: identity.slice("view:".length) };
};

const scopesFromGroups = (
  groups: DatabaseViewGroupsSnapshot<string | null>,
): readonly Omit<ScopedWindow, "snapshot">[] => {
  if (!groups.grouped) return [{ scopeKey: UNGROUPED_SCOPE_KEY }];
  if (groups.groups.length === 0) return [{ scopeKey: UNGROUPED_SCOPE_KEY }];
  return groups.groups.map((group) => group.groupKey === null
    ? {
        scopeKey: "unassigned",
        scope: { kind: "unassigned" as const },
      }
    : {
        scopeKey: groupScopeKeyForColumn(group.groupKey),
        scope: { kind: "key" as const, key: group.groupKey },
      });
};

const uniqueBy = <Value, Key>(
  values: readonly Value[],
  keyOf: (value: Value) => Key,
): readonly Value[] => {
  const keys = new Set<Key>();
  return values.filter((value) => {
    const key = keyOf(value);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
};

const mergeWindows = (
  windows: readonly DatabaseViewWindowSnapshot<string | null>[],
): DatabaseViewWindowSnapshot<string | null> | undefined => {
  const first = windows[0];
  if (!first) return undefined;
  return {
    ...first,
    commitSeq: Math.min(...windows.map((window) => window.commitSeq)),
    nextCursor: null,
    rows: uniqueBy(
      windows.flatMap((window) => window.rows),
      (row) => row.page.id,
    ),
    query: {
      ...first.query,
      rows: uniqueBy(
        windows.flatMap((window) => window.query.rows),
        (row) => row.page.pageId,
      ),
    },
  };
};

export function WorkbenchDatabaseViewSurface({
  accessContext,
  target,
  onOpenPage,
  onPresentationChange,
}: {
  readonly accessContext: ContentAccessContext;
  readonly target: DatabaseSurfaceTarget;
  readonly onOpenPage: (pageId: string, title: string) => void;
  readonly onPresentationChange?: (presentation: {
    readonly databaseName: string;
    readonly viewName: string;
  }) => void;
}) {
  const queryClient = useQueryClient();
  const projectionRegistry = useProjectionInvalidationRegistry();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const inFlightScopesRef = useRef(new Set<string>());
  const requiredMinimumCommitSeqRef = useRef(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [continuations, setContinuations] = useState<
    ReadonlyMap<string, ContinuationState>
  >(new Map());
  const accessProjectId = accessContext.kind === "project"
    ? accessContext.projectId
    : undefined;
  const targetIdentity = target.kind === "database-default"
    ? `database:${target.databaseId}`
    : `view:${target.databaseViewId}`;
  const queryKey = useMemo(
    () => queryKeys.libraryDatabases.view(accessProjectId, targetIdentity),
    [accessProjectId, targetIdentity],
  );
  // The floor is a monotonic read barrier, not semantic query identity.
  // Keeping it out of the key prevents one cache entry per LocalCommit while
  // invalidation still updates the barrier before refetching this entry.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const readTarget = readTargetFromIdentity(targetIdentity);
      const minimumCommitSeq = requiredMinimumCommitSeqRef.current;
      const readContext: ContentAccessContext = accessProjectId
        ? { kind: "project", projectId: accessProjectId }
        : { kind: "library" };
      const groups = await readDatabaseGroupsForContext(
        readContext,
        readTarget,
        minimumCommitSeq,
      );
      const scopedWindows = await Promise.all(
        scopesFromGroups(groups).map(async (scope): Promise<ScopedWindow> => ({
          ...scope,
          snapshot: await readDatabaseWindowForContext(
            readContext,
            readTarget,
            {
              ...(scope.scope ? { groupScope: scope.scope } : {}),
              ...(minimumCommitSeq > 0 ? { minimumCommitSeq } : {}),
            },
          ),
        })),
      );
      return await admitResourceAuthorityQuery(
        { groups, scopedWindows },
        resolveDatabaseSurfaceAuthority,
      );
    },
    meta: resourceAuthorityQueryMeta(resolveDatabaseSurfaceAuthority),
  });

  useEffect(() => {
    setContinuations(new Map());
    inFlightScopesRef.current.clear();
  }, [query.dataUpdatedAt]);

  useEffect(() => {
    setSearchQuery("");
    setSearchOpen(false);
  }, [targetIdentity]);

  const windowsByScope = useMemo(() => new Map(
    (query.data?.scopedWindows ?? []).map((base) => [
      base.scopeKey,
      [base.snapshot, ...(continuations.get(base.scopeKey)?.windows ?? [])],
    ]),
  ), [continuations, query.data?.scopedWindows]);
  const mergedWindow = useMemo(
    () => mergeWindows([...windowsByScope.values()].flat()),
    [windowsByScope],
  );
  const model = useMemo(
    () => mergedWindow
      ? buildDatabaseViewWindowRenderModel(mergedWindow)
      : undefined,
    [mergedWindow],
  );
  useEffect(() => {
    if (!model) return;
    onPresentationChange?.({
      databaseName: model.databaseName,
      viewName: model.viewName,
    });
  }, [model, onPresentationChange]);
  const groupTotals = useMemo(() => new Map(
    (query.data?.groups.groups ?? []).map((group) => [
      group.groupKey === null
        ? "unassigned"
        : groupScopeKeyForColumn(group.groupKey),
      group.totalRows,
    ]),
  ), [query.data?.groups.groups]);
  const groupPagination = useMemo<ReadonlyMap<string, ColumnPaginationState>>(
    () => new Map((query.data?.scopedWindows ?? []).map((base) => {
      const windows = windowsByScope.get(base.scopeKey) ?? [base.snapshot];
      const current = continuations.get(base.scopeKey);
      const loadedRows = uniqueBy(
        windows.flatMap((window) => window.query.rows),
        (row) => row.page.pageId,
      ).length;
      const totalRows = query.data?.groups.grouped
        ? groupTotals.get(base.scopeKey) ?? loadedRows
        : query.data?.groups.totalRows ?? loadedRows;
      return [base.scopeKey, {
        scopeKey: base.scopeKey,
        loadedRows,
        totalRows,
        hasMore: windows.at(-1)?.nextCursor !== null,
        loadingMore: current?.loading ?? false,
        error: current?.error ?? null,
      }];
    })),
    [continuations, groupTotals, query.data, windowsByScope],
  );

  useEffect(() => {
    const authority = mergedWindow;
    if (!authority) return;
    let revocationRepair: Promise<void> | null = null;
    return projectionRegistry.register({
      scope: accessProjectId
        ? {
            kind: "project",
            libraryId: authority.libraryId,
            projectId: accessProjectId,
          }
        : { kind: "library", libraryId: authority.libraryId },
      consumerKey: hashKey(["projection", queryKey]),
      getDependencies: () => ({
        databaseIds: [authority.query.database.databaseId],
        dataSourceIds: [authority.query.dataSource.dataSourceId],
        viewIds: [authority.query.view.viewId],
        pageIds: authority.query.rows.map((row) => row.page.pageId),
      }),
      getCursor: () => {
        const current = queryClient.getQueryData<{
          readonly groups: DatabaseViewGroupsSnapshot<string | null>;
          readonly scopedWindows: readonly ScopedWindow[];
        }>(queryKey);
        if (!current) return null;
        return projectionCursorForSnapshots([
          current.groups,
          ...current.scopedWindows.map((window) => window.snapshot),
        ]);
      },
      revoke: (cause) => {
        requiredMinimumCommitSeqRef.current = Math.max(
          requiredMinimumCommitSeqRef.current,
          cause.stream.commitSeq,
        );
        revocationRepair = queryClient.resetQueries({ queryKey, exact: true });
      },
      invalidate: async (cause: ProjectionInvalidationCause) => {
        requiredMinimumCommitSeqRef.current = Math.max(
          requiredMinimumCommitSeqRef.current,
          cause.stream.commitSeq,
        );
        if (cause.kind === "revocation") {
          await revocationRepair;
          revocationRepair = null;
          return;
        }
        await invalidateExactQuery(queryClient, queryKey);
      },
    });
  }, [
    accessProjectId,
    mergedWindow,
    projectionRegistry,
    queryClient,
    queryKey,
  ]);

  const loadMoreGroup = async (scopeKey: string): Promise<void> => {
    if (inFlightScopesRef.current.has(scopeKey)) return;
    const base = query.data?.scopedWindows.find(
      (candidate) => candidate.scopeKey === scopeKey,
    );
    if (!base) return;
    const current = continuations.get(scopeKey);
    const windows = [base.snapshot, ...(current?.windows ?? [])];
    const cursor = windows.at(-1)?.nextCursor;
    if (!cursor) return;
    const readTarget = readTargetFromIdentity(targetIdentity);

    inFlightScopesRef.current.add(scopeKey);
    setContinuations((states) => new Map(states).set(scopeKey, {
      windows: current?.windows ?? [],
      loading: true,
      error: null,
    }));
    try {
      const next = await readDatabaseWindowForContext(
        accessContext,
        readTarget,
        {
          after: cursor,
          ...(base.scope ? { groupScope: base.scope } : {}),
        },
      );
      setContinuations((states) => new Map(states).set(scopeKey, {
        windows: [...(states.get(scopeKey)?.windows ?? []), next],
        loading: false,
        error: null,
      }));
    } catch (error) {
      console.error("[database-view:continuation]", error);
      setContinuations((states) => new Map(states).set(scopeKey, {
        windows: states.get(scopeKey)?.windows ?? [],
        loading: false,
        error: "Couldn’t load more pages",
      }));
    } finally {
      inFlightScopesRef.current.delete(scopeKey);
    }
  };

  const openSearch = (selectQuery = false) => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      const input = searchInputRef.current;
      input?.focus();
      if (selectQuery) input?.select();
    });
  };
  const searchShortcutLabel =
    typeof navigator !== "undefined"
      && navigator.platform.toUpperCase().includes("MAC")
      ? "⌘F"
      : "Ctrl+F";

  useEffect(() => {
    if (!query.error) return;
    console.error("[database-view:read]", query.error);
  }, [query.error]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <div className="flex min-h-0 flex-1 flex-col">
        {query.error && model ? (
          <div
            role="alert"
            className="mx-3 mt-2 flex min-h-8 items-center gap-2 rounded-md bg-token-error-background/20 px-2.5 text-xs text-token-error-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              Couldn’t refresh this database
            </span>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-token-text-primary hover:bg-token-foreground/5"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          </div>
        ) : null}
        {query.isPending ? (
          <div className="py-20 text-center text-sm text-token-description-foreground" role="status">
            Opening Database…
          </div>
        ) : query.error && !model ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-token-description-foreground">
            <span role="alert">
              Couldn’t open this database
            </span>
            <button
              type="button"
              className="h-8 rounded-md px-2.5 text-token-text-primary hover:bg-token-list-hover-background"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          </div>
        ) : model ? (
          <DatabaseViewTabSurface
            model={model}
            groupPagination={groupPagination}
            onLoadMoreGroup={loadMoreGroup}
            activeSearchQuery={searchQuery}
            taskSearchOpen={searchOpen}
            searchShortcutLabel={searchShortcutLabel}
            taskSearchInputRef={searchInputRef}
            onSearchQueryChange={setSearchQuery}
            onOpenTaskSearch={openSearch}
            onCloseTaskSearch={() => setSearchOpen(false)}
            onOpenPage={onOpenPage}
            onCommitted={async () => {
              await query.refetch();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
