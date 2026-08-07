import {
  CoreApiError,
  readDatabaseViewGroups,
  readDatabaseViewWindow,
  subscribeBoardChanges,
} from "./api";
import type {
  BoardSummary,
  DatabasePage,
  PageInput,
  DatabasePageSummary,
} from "./types";
import type {
  DatabaseViewGroupScopeInput,
  DatabaseViewGroupsInput,
  DatabaseViewGroupsSnapshot,
  DatabaseViewWindowInput,
  DatabaseViewWindowSnapshot,
} from "../../shared/database-views";
import {
  buildPatchPageTransform,
  conflictKeysForPatch,
  overlap,
  type BoardTransform,
} from "./kanban-optimistic-ops";
import { toDatabasePageSummary } from "../../shared/page-summary";
import {
  applyBoardChangeEventToBoard,
  removePageSummaryFromBoard,
  upsertCardSummaryInBoard,
} from "./board-summary-events";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import {
  UNGROUPED_SCOPE_KEY,
  buildDatabaseViewWindowRenderModel,
  groupScopeKeyForColumn,
  type DatabaseViewRenderModel,
} from "./database-view-render-model";
import { getActiveProjectionInvalidationRegistry } from "./projection-invalidation-context";
import type {
  ProjectionInvalidationRegistry,
} from "./projection-invalidation-registry";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import {
  projectionCoordinateFromSnapshot,
  type ProjectionCoordinate,
  type ProjectionEffect,
} from "../../shared/projection-stream";
import {
  CausalProjectionRuntime,
  type ProjectionRepairRequest,
} from "./causal-projection-runtime";
import { projectCoreDatabaseQueryRow } from "../../shared/core-database-row-projection";

const DEFAULT_BOARD_FRESHNESS_MS = 30_000;
const GROUP_WINDOW_FIRST = 50;
const GROUP_WINDOW_MAX_FIRST = 200;
const CONSISTENT_WINDOW_READ_ATTEMPTS = 4;

export interface IndexedPage extends DatabasePageSummary {
  columnId: string;
  columnName: string;
  boardIndex: number;
}

/**
 * Stable key of one independently paged group window; see the definitions in
 * `database-view-render-model.ts`, which every render column also carries.
 */
export type GroupWindowScopeKey = string;

export { UNGROUPED_SCOPE_KEY, groupScopeKeyForColumn };

export interface ColumnPaginationState {
  readonly scopeKey: GroupWindowScopeKey;
  readonly loadedRows: number;
  readonly totalRows: number | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
}

export interface KanbanStoreSnapshot {
  board: BoardSummary | null;
  databaseView: DatabaseViewRenderModel | null;
  pageIndex: ReadonlyMap<string, IndexedPage>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  pendingMutationCount: number;
  lastMutationError: string | null;
  groupPagination: ReadonlyMap<GroupWindowScopeKey, ColumnPaginationState>;
  totalRows: number | null;
}

/**
 * Cursor carried by a direct local projection delta. The delta may be applied
 * before the full Database View projection has caught up, so it must still
 * participate in the same store-epoch/commit-seq ordering rules as a read.
 */
export interface LocalProjectionCursor {
  readonly storeEpoch: string;
  readonly commitSeq: number;
}

export interface OptimisticMutationResult<T> {
  ok: boolean;
  result?: T;
  error?: Error;
  superseded: boolean;
  opId: number;
}

type StoreListener = () => void;

type ReadViewWindowFn = (
  projectId: string,
  input: DatabaseViewWindowInput,
) => Promise<DatabaseViewWindowSnapshot>;
type ReadViewGroupsFn = (
  projectId: string,
  input: DatabaseViewGroupsInput,
) => Promise<DatabaseViewGroupsSnapshot>;
type SubscribeBoardChangesFn = (projectId: string, callback: (event: BoardChangeEvent) => void) => () => void;
type NowFn = () => number;

export interface KanbanStoreDependencies {
  readViewWindow: ReadViewWindowFn;
  readViewGroups: ReadViewGroupsFn;
  subscribeBoardChanges: SubscribeBoardChangesFn;
  getProjectionInvalidationRegistry: () => ProjectionInvalidationRegistry | null;
  now: NowFn;
}

export interface EnsureFreshBoardOptions {
  maxAgeMs?: number;
  force?: boolean;
}

export interface LocalOverlayOptions {
  kind: string;
  conflictKeys: string[];
  apply: BoardTransform;
}

export interface RunOptimisticMutationOptions<T> {
  kind: string;
  conflictKeys: string[];
  apply: BoardTransform;
  runRemote: () => Promise<T>;
  refreshOnSuccess?: boolean;
  refreshOnFailure?: boolean;
  suppressErrorWhenSuperseded?: boolean;
}

interface RunOptimisticPatchOptions<T> {
  columnId: string;
  pageId: string;
  updates: Partial<PageInput>;
  runRemote: () => Promise<T>;
}

interface OptimisticEntry {
  opId: number;
  kind: string;
  conflictKeys: string[];
  apply: BoardTransform;
  pending: boolean;
  superseded: boolean;
  retainUntilSuperseded: boolean;
}

const defaultDependencies: KanbanStoreDependencies = {
  readViewWindow: readDatabaseViewWindow,
  readViewGroups: readDatabaseViewGroups,
  subscribeBoardChanges,
  getProjectionInvalidationRegistry: getActiveProjectionInvalidationRegistry,
  now: () => Date.now(),
};

function buildPageIndex(board: BoardSummary | null): ReadonlyMap<string, IndexedPage> {
  if (!board) return new Map();

  const index = new Map<string, IndexedPage>();
  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
    const column = board.columns[columnIndex];
    if (!column) continue;

    for (let pageIndex = 0; pageIndex < column.cards.length; pageIndex += 1) {
      const card = column.cards[pageIndex];
      if (!card) continue;

      index.set(card.id, {
        ...card,
        columnId: column.id,
        columnName: column.name,
        boardIndex: columnIndex * 100_000 + pageIndex,
      });
    }
  }

  return index;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  return new Error("Unknown error");
}

interface GroupWindowScope {
  readonly scopeKey: GroupWindowScopeKey;
  readonly scope: DatabaseViewGroupScopeInput | null;
}

interface GroupWindowState {
  readonly scope: DatabaseViewGroupScopeInput | null;
  readonly snapshot: DatabaseViewWindowSnapshot;
  readonly loadingMore: boolean;
  readonly inlineError: string | null;
}

type ProjectionSnapshot = Pick<
  DatabaseViewWindowSnapshot,
  "storeEpoch" | "projection"
>;

const hasSameProjectionAuthority = (
  left: ProjectionSnapshot,
  right: ProjectionSnapshot,
): boolean =>
  left.storeEpoch === right.storeEpoch
  && left.projection.scopeKey === right.projection.scopeKey
  && left.projection.schemaVersion === right.projection.schemaVersion
  && left.projection.revision === right.projection.revision
  && left.projection.effectHash === right.projection.effectHash;

const scopeContainsGroup = (
  scope: DatabaseViewGroupScopeInput | null,
  groupKey: string | null,
): boolean => {
  if (scope === null) return true;
  if (scope.kind === "unassigned") return groupKey === null;
  return scope.key === groupKey;
};

const scopesFromGroups = (
  groups: DatabaseViewGroupsSnapshot,
): GroupWindowScope[] => {
  if (!groups.grouped) {
    return [{ scopeKey: UNGROUPED_SCOPE_KEY, scope: null }];
  }
  return groups.groups.map((group) => group.groupKey === null
    ? { scopeKey: "unassigned", scope: { kind: "unassigned" } }
    : {
        scopeKey: groupScopeKeyForColumn(group.groupKey),
        scope: { kind: "key", key: group.groupKey },
      });
};

const mergeBoards = (boards: readonly BoardSummary[]): BoardSummary => {
  const first = boards[0];
  if (!first) return { columns: [] };
  const seenCards = new Set<string>();
  return {
    columns: first.columns.map((column) => ({
      ...column,
      cards: boards.flatMap((board) =>
        (board.columns.find((candidate) => candidate.id === column.id)?.cards ?? [])
          .filter((card) => {
            if (seenCards.has(card.id)) return false;
            seenCards.add(card.id);
            return true;
          })),
    })),
  };
};

/**
 * Composes the loaded group windows into one snapshot for the existing render
 * pipeline (board summary, render model, optimistic transforms). Continuation
 * state stays per group; the merged snapshot never exposes a global cursor.
 * The invalidation cursor is the oldest window's, so no event is skipped.
 */
const mergeGroupWindows = (
  windows: readonly DatabaseViewWindowSnapshot[],
): DatabaseViewWindowSnapshot | null => {
  const first = windows[0];
  if (!first) return null;
  const projection = first.projection;
  if (windows.some((window) =>
    window.storeEpoch !== first.storeEpoch
    || window.projection.scopeKey !== projection.scopeKey
    || window.projection.schemaVersion !== projection.schemaVersion
    || window.projection.revision !== projection.revision
    || window.projection.effectHash !== projection.effectHash
  )) {
    throw new Error("Database View windows crossed a projection revision");
  }
  const seenRows = new Set<string>();
  const rows = windows.flatMap((window) =>
    window.rows.filter((row) => {
      if (seenRows.has(row.page.id)) return false;
      seenRows.add(row.page.id);
      return true;
    }));
  const seenQueryRows = new Set<string>();
  const queryRows = windows.flatMap((window) =>
    window.query.rows.filter((row) => {
      if (seenQueryRows.has(row.page.pageId)) return false;
      seenQueryRows.add(row.page.pageId);
      return true;
    }));
  return {
    ...first,
    commitSeq: Math.min(...windows.map((window) => window.commitSeq)),
    projection: {
      ...projection,
      coveredCommitSeq: Math.min(
        ...windows.map((window) => window.projection.coveredCommitSeq),
      ),
    },
    nextCursor: null,
    rows,
    board: mergeBoards(windows.map((window) => window.board)),
    query: { ...first.query, rows: queryRows },
  };
};

const groupPaginationEquals = (
  left: ReadonlyMap<GroupWindowScopeKey, ColumnPaginationState>,
  right: ReadonlyMap<GroupWindowScopeKey, ColumnPaginationState>,
): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [scopeKey, state] of left) {
    const other = right.get(scopeKey);
    if (
      !other
      || other.loadedRows !== state.loadedRows
      || other.totalRows !== state.totalRows
      || other.hasMore !== state.hasMore
      || other.loadingMore !== state.loadingMore
      || other.error !== state.error
    ) {
      return false;
    }
  }
  return true;
};

const appendWindow = (
  current: DatabaseViewWindowSnapshot,
  next: DatabaseViewWindowSnapshot,
): DatabaseViewWindowSnapshot => {
  if (
    !hasSameProjectionAuthority(current, next)
    || current.viewId !== next.viewId
  ) {
    throw new Error("Database View continuation crossed a projection revision");
  }
  const existingIds = new Set(current.rows.map((row) => row.page.id));
  return {
    ...next,
    rows: [
      ...current.rows,
      ...next.rows.filter((row) => !existingIds.has(row.page.id)),
    ],
    board: mergeBoards([current.board, next.board]),
    query: {
      ...next.query,
      rows: [
        ...current.query.rows,
        ...next.query.rows.filter((row) => !existingIds.has(row.page.pageId)),
      ],
    },
  };
};

class KanbanProjectStore {
  private readonly listeners = new Set<StoreListener>();

  private snapshot: KanbanStoreSnapshot = {
    board: null,
    databaseView: null,
    pageIndex: new Map(),
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: null,
    pendingMutationCount: 0,
    lastMutationError: null,
    groupPagination: new Map(),
    totalRows: null,
  };

  private baseBoard: BoardSummary | null = null;

  private baseBoardAuthority: DatabaseViewWindowSnapshot | null = null;

  private baseDatabaseView: DatabaseViewRenderModel | null = null;

  private groupWindows = new Map<GroupWindowScopeKey, GroupWindowState>();

  private groupsSnapshot: DatabaseViewGroupsSnapshot | null = null;

  private optimisticEntries: OptimisticEntry[] = [];

  private nextOpId = 1;

  private inFlightFetch: Promise<boolean> | null = null;

  private unsubscribeBoardChanges: (() => void) | null = null;

  private unsubscribeProjectionInvalidation: (() => void) | null = null;

  private causalProjectionRuntime: CausalProjectionRuntime | null = null;

  private requiredMinimumCommitSeq = 0;

  private requiredRefreshGeneration = 0;

  private completedRefreshGeneration = 0;

  private lastFetchedAt = 0;

  private stale = true;

  constructor(
    private readonly projectId: string,
    private readonly databaseViewId: string | null,
    private readonly dependencies: KanbanStoreDependencies,
  ) {}

  getSnapshot = (): KanbanStoreSnapshot => this.snapshot;

  subscribe = (listener: StoreListener): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.ensureRealtimeSubscription();
      void this.ensureFreshBoard();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;

      this.teardownRealtimeSubscription();
    };
  };

  private windowInputBase(minimumCommitSeq = 0): DatabaseViewWindowInput {
    return this.databaseViewId
      ? {
          databaseViewId: this.databaseViewId,
          ...(minimumCommitSeq > 0 ? { minimumCommitSeq } : {}),
        }
      : minimumCommitSeq > 0 ? { minimumCommitSeq } : {};
  }

  private groupsInput(minimumCommitSeq = 0): DatabaseViewGroupsInput {
    return this.databaseViewId
      ? {
          databaseViewId: this.databaseViewId,
          ...(minimumCommitSeq > 0 ? { minimumCommitSeq } : {}),
        }
      : minimumCommitSeq > 0 ? { minimumCommitSeq } : {};
  }

  /** Span-preserving first-window size: a refresh re-reads what was loaded. */
  private firstForScope(scopeKey: GroupWindowScopeKey): number {
    const loaded = this.groupWindows.get(scopeKey)?.snapshot.rows.length ?? 0;
    return Math.min(
      Math.max(GROUP_WINDOW_FIRST, loaded),
      GROUP_WINDOW_MAX_FIRST,
    );
  }

  private async readScopedWindow(
    scope: GroupWindowScope,
    first: number,
    after?: string,
    minimumCommitSeq = 0,
  ): Promise<DatabaseViewWindowSnapshot> {
    return await this.dependencies.readViewWindow(this.projectId, {
      ...this.windowInputBase(minimumCommitSeq),
      ...(scope.scope ? { groupScope: scope.scope } : {}),
      ...(after ? { after } : {}),
      first,
    });
  }

  private async readConsistentFirstWindows(
    minimumCommitSeq: number,
  ): Promise<{
    readonly groups: DatabaseViewGroupsSnapshot;
    readonly windows: readonly {
      readonly scope: GroupWindowScope;
      readonly snapshot: DatabaseViewWindowSnapshot;
    }[];
  }> {
    let floor = minimumCommitSeq;
    for (let attempt = 0; attempt < CONSISTENT_WINDOW_READ_ATTEMPTS; attempt += 1) {
      const groups = await this.dependencies.readViewGroups(
        this.projectId,
        this.groupsInput(floor),
      );
      const scopes = scopesFromGroups(groups);
      // An empty grouped View still needs one window for its descriptor.
      const fetchScopes: GroupWindowScope[] = scopes.length > 0
        ? scopes
        : [{ scopeKey: UNGROUPED_SCOPE_KEY, scope: null }];
      const windows = await Promise.all(fetchScopes.map(async (scope) => ({
        scope,
        snapshot: await this.readScopedWindow(
          scope,
          this.firstForScope(scope.scopeKey),
          undefined,
          floor,
        ),
      })));
      if (windows.every(({ snapshot }) =>
        hasSameProjectionAuthority(groups, snapshot)
      )) {
        return { groups, windows };
      }
      floor = Math.max(
        floor,
        groups.commitSeq,
        groups.projection.coveredCommitSeq,
        ...windows.flatMap(({ snapshot }) => [
          snapshot.commitSeq,
          snapshot.projection.coveredCommitSeq,
        ]),
      );
    }
    throw new Error(
      "Database View changed faster than a consistent window snapshot could be read",
    );
  }

  private rebuildFromGroups(): void {
    const merged = mergeGroupWindows(
      [...this.groupWindows.values()].map((group) => group.snapshot),
    );
    this.baseBoardAuthority = merged;
    this.baseBoard = merged?.board ?? null;
    this.baseDatabaseView = merged
      ? buildDatabaseViewWindowRenderModel(merged)
      : null;
  }

  private fetchBoardOnce = async (
    minimumCommitSeq: number,
    refreshGeneration: number,
  ): Promise<boolean> => {
    let succeeded = false;
    const hasReadableBase = this.databaseViewId
      ? this.baseDatabaseView !== null
      : this.baseBoard !== null;
    const shouldShowLoading = !hasReadableBase && !this.snapshot.loading;
    if (shouldShowLoading) {
      this.setSnapshot({
        ...this.snapshot,
        loading: true,
      });
    }

    try {
      const { groups, windows } = await this.readConsistentFirstWindows(
        minimumCommitSeq,
      );
      const currentAuthority = this.baseBoardAuthority;
      const incomingSeq = Math.min(
        ...windows.map((window) => window.snapshot.commitSeq),
      );
      if (incomingSeq < minimumCommitSeq) {
        throw new Error(
          `Database View read did not reach local commit ${minimumCommitSeq}`,
        );
      }
      const incomingAuthority = windows[0]?.snapshot;
      if (
        currentAuthority
        && incomingAuthority
        && incomingAuthority.storeEpoch === currentAuthority.storeEpoch
        && incomingAuthority.projection.scopeKey
          === currentAuthority.projection.scopeKey
        && (
          incomingAuthority.projection.revision
            < currentAuthority.projection.revision
          || (
            incomingAuthority.projection.revision
              === currentAuthority.projection.revision
            && incomingAuthority.projection.coveredCommitSeq
              < currentAuthority.projection.coveredCommitSeq
          )
        )
      ) {
        // Every fetched window predates what is already on screen; keep the
        // newer state and only refresh bookkeeping.
        this.lastFetchedAt = this.dependencies.now();
        this.stale = false;
        this.ensureProjectionSubscription();
        this.recomputeSnapshot({ loading: false, error: null });
        succeeded = true;
        return true;
      }
      if (
        currentAuthority
        && incomingAuthority
        && incomingAuthority.storeEpoch === currentAuthority.storeEpoch
        && incomingAuthority.projection.scopeKey
          === currentAuthority.projection.scopeKey
        && incomingAuthority.projection.revision
          === currentAuthority.projection.revision
        && currentAuthority.projection.effectHash !== null
        && incomingAuthority.projection.effectHash !== null
        && incomingAuthority.projection.effectHash
          !== currentAuthority.projection.effectHash
      ) {
        throw new Error("Database View canonical read conflicts with its projection revision");
      }
      this.groupsSnapshot = groups;
      this.groupWindows = new Map(windows.map(({ scope, snapshot }) => [
        scope.scopeKey,
        {
          scope: scope.scope,
          snapshot,
          loadingMore: false,
          inlineError: null,
        },
      ]));
      this.rebuildFromGroups();
      this.lastFetchedAt = this.dependencies.now();
      this.stale = false;
      this.ensureProjectionSubscription();
      this.recomputeSnapshot({
        loading: false,
        error: null,
      });
      succeeded = true;
      return true;
    } catch (error) {
      this.stale = true;
      this.recomputeSnapshot({
        loading: false,
        error: toError(error).message,
      });
      return false;
    } finally {
      if (succeeded) {
        this.completedRefreshGeneration = Math.max(
          this.completedRefreshGeneration,
          refreshGeneration,
        );
      }
    }
  };

  fetchBoard = async (minimumCommitSeq = 0): Promise<boolean> => {
    this.requiredMinimumCommitSeq = Math.max(
      this.requiredMinimumCommitSeq,
      minimumCommitSeq,
    );
    while (true) {
      const requestedMinimumCommitSeq = this.requiredMinimumCommitSeq;
      const requestedRefreshGeneration = this.requiredRefreshGeneration;
      let succeeded: boolean;
      if (this.inFlightFetch) {
        succeeded = await this.inFlightFetch;
      } else {
        const inFlight = this.fetchBoardOnce(
          requestedMinimumCommitSeq,
          requestedRefreshGeneration,
        );
        this.inFlightFetch = inFlight;
        try {
          succeeded = await inFlight;
        } finally {
          if (this.inFlightFetch === inFlight) this.inFlightFetch = null;
        }
      }
      if (!succeeded) return false;
      if (
        this.requiredMinimumCommitSeq <= requestedMinimumCommitSeq
        && this.completedRefreshGeneration >= requestedRefreshGeneration
      ) return true;
    }
  };

  /**
   * Silently converges one group from its first window, preserving the loaded
   * span. This is the consumer half of the cursor contract: a rejected
   * continuation is disposable read state, never a user-facing failure.
   */
  private refetchGroup = async (
    scopeKey: GroupWindowScopeKey,
  ): Promise<void> => {
    const group = this.groupWindows.get(scopeKey);
    if (!group) return;
    try {
      const snapshot = await this.readScopedWindow(
        { scopeKey, scope: group.scope },
        this.firstForScope(scopeKey),
        undefined,
        group.snapshot.commitSeq,
      );
      const current = this.groupWindows.get(scopeKey);
      if (!current) return;
      if (
        !hasSameProjectionAuthority(snapshot, current.snapshot)
      ) {
        this.stale = true;
        await this.fetchBoard(snapshot.projection.coveredCommitSeq).catch(() => {});
        return;
      }
      if (snapshot.commitSeq < current.snapshot.commitSeq) {
        return;
      }
      this.groupWindows = new Map(this.groupWindows).set(scopeKey, {
        ...current,
        snapshot,
        inlineError: null,
      });
      this.rebuildFromGroups();
      this.recomputeSnapshot();
    } catch (error) {
      this.setGroupState(scopeKey, { inlineError: toError(error).message });
    }
  };

  private setGroupState(
    scopeKey: GroupWindowScopeKey,
    patch: Partial<Pick<GroupWindowState, "loadingMore" | "inlineError">>,
  ): void {
    const current = this.groupWindows.get(scopeKey);
    if (!current) return;
    this.groupWindows = new Map(this.groupWindows).set(scopeKey, {
      ...current,
      ...patch,
    });
    this.recomputeSnapshot();
  }

  loadMoreGroup = async (scopeKey: GroupWindowScopeKey): Promise<void> => {
    const group = this.groupWindows.get(scopeKey);
    const after = group?.snapshot.nextCursor;
    if (!group || !after || group.loadingMore || this.inFlightFetch) return;
    this.setGroupState(scopeKey, { loadingMore: true, inlineError: null });
    try {
      const next = await this.readScopedWindow(
        { scopeKey, scope: group.scope },
        GROUP_WINDOW_FIRST,
        after,
        group.snapshot.commitSeq,
      );
      const current = this.groupWindows.get(scopeKey);
      if (!current || current.snapshot.nextCursor !== after) return;
      if (
        !hasSameProjectionAuthority(next, current.snapshot)
        || next.viewId !== current.snapshot.viewId
      ) {
        // Continuations are valid only inside one exact projection revision.
        // Dispose the cursor and converge the whole Board from first windows.
        this.stale = true;
        await this.fetchBoard(next.projection.coveredCommitSeq).catch(() => {});
        return;
      }
      this.groupWindows = new Map(this.groupWindows).set(scopeKey, {
        ...current,
        snapshot: appendWindow(current.snapshot, next),
        inlineError: null,
      });
      this.rebuildFromGroups();
      this.recomputeSnapshot({ error: null });
    } catch (error) {
      if (error instanceof CoreApiError
        && error.isCursorRejection({ requestHadCursor: true })) {
        const current = this.groupWindows.get(scopeKey);
        if (current) {
          this.groupWindows = new Map(this.groupWindows).set(scopeKey, {
            ...current,
            snapshot: { ...current.snapshot, nextCursor: null },
          });
        }
        await this.refetchGroup(scopeKey);
        return;
      }
      this.setGroupState(scopeKey, { inlineError: toError(error).message });
    } finally {
      this.setGroupState(scopeKey, { loadingMore: false });
    }
  };

  /** Advances every group that still has a continuation (flat list views). */
  loadMoreAll = async (): Promise<void> => {
    const pending = [...this.groupWindows.entries()]
      .filter(([, group]) => group.snapshot.nextCursor !== null)
      .map(([scopeKey]) => this.loadMoreGroup(scopeKey));
    await Promise.all(pending);
  };

  loadMore = async (): Promise<void> => {
    await this.loadMoreAll();
  };

  ensureFreshBoard = async (options: EnsureFreshBoardOptions = {}): Promise<void> => {
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_BOARD_FRESHNESS_MS;
    const hasReadableBase = this.databaseViewId
      ? this.baseDatabaseView !== null
      : this.baseBoard !== null;
    const boardIsFresh = hasReadableBase
      && !this.stale
      && this.dependencies.now() - this.lastFetchedAt <= maxAgeMs;
    if (!options.force && boardIsFresh) return;

    await this.fetchBoard();
  };

  refreshBoardAtLeast = async (minimumCommitSeq = 0): Promise<void> => {
    this.stale = true;
    this.requiredRefreshGeneration += 1;
    await this.fetchBoard(minimumCommitSeq);
  };

  refreshBoard = async (): Promise<void> => {
    await this.refreshBoardAtLeast();
  };

  setError = (message: string): void => {
    this.recomputeSnapshot({
      error: message,
    });
  };

  clearLastMutationError = (): void => {
    this.recomputeSnapshot({
      lastMutationError: null,
    });
  };

  resolveConflict = (conflictKeys: string[]): void => {
    this.supersedeConflicts(conflictKeys);
    this.recomputeSnapshot({
      lastMutationError: null,
    });
  };

  applyRemoteCard = (
    card: DatabasePage,
    cursor?: LocalProjectionCursor,
  ): void => {
    this.applyRemoteCardSummary(toDatabasePageSummary(card), cursor);
  };

  applyRemoteCardSummary = (
    card: DatabasePageSummary,
    cursor?: LocalProjectionCursor,
  ): void => {
    if (!this.baseBoard) return;

    const authority = this.baseBoardAuthority;
    if (
      cursor
      && authority
      && (
        authority.storeEpoch !== cursor.storeEpoch
        || cursor.commitSeq < authority.commitSeq
      )
    ) {
      // A delayed row read or tailer replay must never move an already newer
      // local projection backwards. The subsequent floor refresh can still
      // reconcile a row that was not covered by this delta.
      return;
    }

    const nextBoard = upsertCardSummaryInBoard(this.baseBoard, card);
    if (nextBoard === this.baseBoard && !cursor) return;

    this.baseBoard = nextBoard;
    if (authority && cursor) {
      // A DatabasePage summary is enough for the Board card, but it does not
      // carry the exact Data Source membership/property evidence required to
      // invent a new query row. Keep the query surface honest until the
      // cursor-fenced canonical read supplies that row.
      const hasWindowRow = authority.rows.some((row) => row.page.id === card.id);
      const hasQueryRow = authority.query.rows.some(
        (row) => row.page.pageId === card.id,
      );
      const nextAuthority: DatabaseViewWindowSnapshot = {
        ...authority,
        board: nextBoard,
        commitSeq: Math.max(authority.commitSeq, cursor.commitSeq),
        rows: hasWindowRow
          ? authority.rows.map((row) =>
              row.page.id === card.id ? { ...row, page: card } : row
            )
          : authority.rows,
        query: {
          ...authority.query,
          rows: hasQueryRow
            ? authority.query.rows.map((row) =>
                row.page.pageId === card.id
                  ? { ...row, page: { ...row.page, ...card } }
                  : row
              )
            : authority.query.rows,
        },
      };
      this.baseBoardAuthority = nextAuthority;
      if (hasQueryRow) {
        this.baseDatabaseView = buildDatabaseViewWindowRenderModel(nextAuthority);
      }
      this.requiredMinimumCommitSeq = Math.max(
        this.requiredMinimumCommitSeq,
        cursor.commitSeq,
      );
    }
    this.recomputeSnapshot();
  };

  private projectionCoordinate = (): ProjectionCoordinate | null => {
    const authority = this.baseBoardAuthority;
    return authority
      ? projectionCoordinateFromSnapshot(authority)
      : null;
  };

  private ensureCausalProjectionRuntime(): CausalProjectionRuntime | null {
    const coordinate = this.projectionCoordinate();
    if (!coordinate) return null;
    if (this.causalProjectionRuntime) return this.causalProjectionRuntime;
    this.causalProjectionRuntime = new CausalProjectionRuntime({
      scopeKey: coordinate.scopeKey,
      schemaVersion: coordinate.schemaVersion,
      getCoordinate: this.projectionCoordinate,
      apply: this.applyProjectionEffect,
      readAtLeast: this.repairProjection,
      onIntegrityFailure: (error) => {
        this.recomputeSnapshot({ error: error.message });
      },
    });
    return this.causalProjectionRuntime;
  }

  private applyProjectionEffect = (effect: ProjectionEffect): void => {
    const authority = this.baseBoardAuthority;
    const board = this.baseBoard;
    const patch = effect.patch;
    if (!authority || !board || !patch) {
      throw new Error("Database View projection has no patchable base");
    }
    if (
      patch.kind !== "database_row_upsert"
      && patch.kind !== "database_row_remove"
    ) {
      throw new Error("Database View received a patch for another projection module");
    }
    if (
      patch.projectId !== this.projectId
      || patch.databaseId !== authority.databaseId
      || patch.dataSourceId !== authority.dataSourceId
      || patch.viewId !== authority.viewId
    ) {
      throw new Error("Database View projection patch targets another scope");
    }

    const pageId = patch.kind === "database_row_upsert"
      ? patch.row.id
      : patch.pageId;
    const groupKey = patch.kind === "database_row_upsert"
      ? patch.effectiveGroupKey
      : patch.groupKey;
    const advanceWindow = (
      snapshot: DatabaseViewWindowSnapshot,
      groupScope: DatabaseViewGroupScopeInput | null,
    ): DatabaseViewWindowSnapshot => {
      const includesUpsert = patch.kind === "database_row_upsert"
        && scopeContainsGroup(groupScope, patch.effectiveGroupKey);
      const nextRows = [
        ...snapshot.rows.filter((row) => row.page.id !== pageId),
        ...(includesUpsert
          ? [{
              page: patch.row,
              groupKey: patch.effectiveGroupKey,
              rankKey:
                patch.rankKey ?? "ffffffffffffffffffffffffffffffff",
            }]
          : []),
      ].sort((left, right) =>
        left.rankKey.localeCompare(right.rankKey)
        || left.page.id.localeCompare(right.page.id)
      );
      const queryRowsByPageId = new Map(
        snapshot.query.rows
          .filter((row) => row.page.pageId !== pageId)
          .map((row) => [row.page.pageId, row] as const),
      );
      if (includesUpsert) {
        queryRowsByPageId.set(pageId, projectCoreDatabaseQueryRow(
          patch.sourceRow,
          {
            libraryId: snapshot.libraryId,
            dataSourceId: snapshot.query.dataSource.dataSourceId,
            properties: snapshot.query.properties,
          },
        ));
      }
      const nextBoard = patch.kind === "database_row_upsert"
        ? upsertCardSummaryInBoard(snapshot.board, patch.row)
        : removePageSummaryFromBoard(snapshot.board, patch.pageId);
      return {
        ...snapshot,
        commitSeq: Math.max(snapshot.commitSeq, effect.coveredCommitSeq),
        projection: {
          scopeKey: effect.scope.canonical_key,
          schemaVersion: effect.scope.schema_version,
          revision: effect.resultRevision,
          coveredCommitSeq: effect.coveredCommitSeq,
          effectHash: effect.effectHash,
        },
        nextCursor: effect.requiresReadAtLeast ? null : snapshot.nextCursor,
        rows: nextRows,
        board: nextBoard,
        query: {
          ...snapshot.query,
          rows: nextRows.flatMap((row) => {
            const queryRow = queryRowsByPageId.get(row.page.id);
            return queryRow ? [queryRow] : [];
          }),
        },
      };
    };

    const nextAuthority = advanceWindow(authority, null);
    this.baseBoard = nextAuthority.board;
    this.baseBoardAuthority = nextAuthority;
    this.baseDatabaseView = buildDatabaseViewWindowRenderModel(
      nextAuthority,
    );
    this.groupWindows = new Map(
      [...this.groupWindows].map(([scopeKey, state]) => [scopeKey, {
        ...state,
        snapshot: advanceWindow(state.snapshot, state.scope),
      }]),
    );
    if (this.groupsSnapshot) {
      const nextGroups = this.groupsSnapshot.groups
        .map((group) => group.groupKey === groupKey && patch.groupTotal !== null
          ? { ...group, totalRows: patch.groupTotal }
          : group)
        .filter((group) => group.totalRows > 0);
      if (
        this.groupsSnapshot.grouped
        && patch.groupTotal !== null
        && patch.groupTotal > 0
        && !nextGroups.some((group) => group.groupKey === groupKey)
      ) {
        nextGroups.push({ groupKey, totalRows: patch.groupTotal });
      }
      this.groupsSnapshot = {
        ...this.groupsSnapshot,
        commitSeq: Math.max(
          this.groupsSnapshot.commitSeq,
          effect.coveredCommitSeq,
        ),
        projection: nextAuthority.projection,
        totalRows: patch.totalRows,
        groups: nextGroups,
      };
    }
    this.requiredMinimumCommitSeq = Math.max(
      this.requiredMinimumCommitSeq,
      effect.coveredCommitSeq,
    );
    this.lastFetchedAt = this.dependencies.now();
    this.stale = effect.requiresReadAtLeast;
    this.recomputeSnapshot({ error: null });
  };

  private repairProjection = async (
    request: ProjectionRepairRequest,
  ): Promise<void> => {
    const current = this.projectionCoordinate();
    if (current && current.scopeKey !== request.scopeKey) {
      throw new Error("Projection repair targets another Database View scope");
    }
    await this.refreshBoardAtLeast(request.minimumCommitSeq);
  };

  enqueueLocalOverlay = (options: LocalOverlayOptions): boolean => {
    this.supersedeConflicts(options.conflictKeys);
    const before = this.baseBoard ? this.composeBoard(this.baseBoard) : null;
    const entry = this.createEntry({
      ...options,
      pending: false,
      retainUntilSuperseded: true,
    });
    this.optimisticEntries.push(entry);
    const after = this.baseBoard ? this.composeBoard(this.baseBoard) : null;
    if (this.baseBoard && after === before) {
      this.optimisticEntries = this.optimisticEntries.filter((candidate) => candidate.opId !== entry.opId);
      return false;
    }

    this.recomputeSnapshot();
    return true;
  };

  applyLocalPatch = (
    columnId: string,
    pageId: string,
    updates: Partial<PageInput>,
  ): boolean => {
    return this.enqueueLocalOverlay({
      kind: "page:patch-local",
      conflictKeys: conflictKeysForPatch(pageId, updates),
      apply: buildPatchPageTransform(columnId, pageId, updates),
    });
  };

  runOptimisticPatch = async <T,>({
    columnId,
    pageId,
    updates,
    runRemote,
  }: RunOptimisticPatchOptions<T>): Promise<T> => {
    const outcome = await this.runOptimisticMutation({
      kind: "block:properties",
      conflictKeys: conflictKeysForPatch(pageId, updates),
      apply: buildPatchPageTransform(columnId, pageId, updates),
      runRemote,
    });

    if (outcome.ok && outcome.result !== undefined) {
      return outcome.result;
    }
    throw outcome.error ?? new Error("Mutation failed");
  };

  runOptimisticMutation = async <T,>(options: RunOptimisticMutationOptions<T>): Promise<OptimisticMutationResult<T>> => {
    this.supersedeConflicts(options.conflictKeys);
    const entry = this.createEntry({
      ...options,
      pending: true,
      retainUntilSuperseded: false,
    });
    this.optimisticEntries.push(entry);
    this.recomputeSnapshot();

    try {
      const result = await options.runRemote();
      entry.pending = false;
      this.pruneEntries();
      if (options.refreshOnSuccess !== false) {
        await this.refreshBoard();
      }
      this.recomputeSnapshot();
      return {
        ok: true,
        result,
        superseded: entry.superseded,
        opId: entry.opId,
      };
    } catch (error) {
      const normalized = toError(error);
      entry.pending = false;
      this.pruneEntries();

      const shouldSurfaceError = !entry.superseded || options.suppressErrorWhenSuperseded === false;
      if (shouldSurfaceError) {
        this.recomputeSnapshot({
          error: normalized.message,
          lastMutationError: normalized.message,
        });
      }

      if (options.refreshOnFailure !== false) {
        await this.refreshBoard();
      }
      this.recomputeSnapshot();
      return {
        ok: false,
        error: normalized,
        superseded: entry.superseded,
        opId: entry.opId,
      };
    }
  };

  private composeBoard(baseBoard: BoardSummary): BoardSummary {
    let next = baseBoard;
    for (const entry of this.optimisticEntries) {
      if (entry.superseded) continue;
      next = entry.apply(next);
    }
    return next;
  }

  private activePendingCount(): number {
    return this.optimisticEntries.filter((entry) => entry.pending && !entry.superseded).length;
  }

  private buildGroupPagination(): ReadonlyMap<
    GroupWindowScopeKey,
    ColumnPaginationState
  > {
    const totals = new Map<GroupWindowScopeKey, number>();
    for (const group of this.groupsSnapshot?.groups ?? []) {
      totals.set(groupScopeKeyForColumn(group.groupKey), group.totalRows);
    }
    if (this.groupsSnapshot && !this.groupsSnapshot.grouped) {
      totals.set(UNGROUPED_SCOPE_KEY, this.groupsSnapshot.totalRows);
    }
    const pagination = new Map<GroupWindowScopeKey, ColumnPaginationState>();
    for (const [scopeKey, group] of this.groupWindows) {
      pagination.set(scopeKey, {
        scopeKey,
        loadedRows: group.snapshot.rows.length,
        totalRows: totals.get(scopeKey) ?? null,
        hasMore: group.snapshot.nextCursor !== null,
        loadingMore: group.loadingMore,
        error: group.inlineError,
      });
    }
    return pagination;
  }

  private recomputeSnapshot(
    overrides: Partial<
      Pick<
        KanbanStoreSnapshot,
        "loading" | "loadingMore" | "error" | "lastMutationError"
      >
    > = {},
  ): void {
    this.pruneConvergedEntries();
    const board = this.baseBoard ? this.composeBoard(this.baseBoard) : null;
    const hasLoading = Object.prototype.hasOwnProperty.call(overrides, "loading");
    const hasError = Object.prototype.hasOwnProperty.call(overrides, "error");
    const hasLoadingMore = Object.prototype.hasOwnProperty.call(
      overrides,
      "loadingMore",
    );
    const hasLastMutationError = Object.prototype.hasOwnProperty.call(overrides, "lastMutationError");
    const groupPagination = this.buildGroupPagination();
    const anyLoadingMore = [...groupPagination.values()]
      .some((state) => state.loadingMore);
    const anyHasMore = [...groupPagination.values()]
      .some((state) => state.hasMore);
    const next: KanbanStoreSnapshot = {
      ...this.snapshot,
      board,
      databaseView: this.baseDatabaseView,
      pageIndex: buildPageIndex(board),
      pendingMutationCount: this.activePendingCount(),
      hasMore: anyHasMore,
      groupPagination,
      totalRows: this.groupsSnapshot?.totalRows ?? null,
      loading: hasLoading ? (overrides.loading as boolean) : this.snapshot.loading,
      loadingMore: hasLoadingMore
        ? (overrides.loadingMore as boolean)
        : anyLoadingMore,
      error: hasError ? (overrides.error as string | null) : this.snapshot.error,
      lastMutationError: hasLastMutationError
        ? (overrides.lastMutationError as string | null)
        : this.snapshot.lastMutationError,
    };
    this.setSnapshot(next);
  }

  private pruneConvergedEntries(): void {
    if (!this.baseBoard) return;
    if (this.optimisticEntries.length === 0) return;

    let working = this.baseBoard;
    let changed = false;
    const nextEntries: OptimisticEntry[] = [];

    for (const entry of this.optimisticEntries) {
      if (entry.superseded) {
        changed = true;
        continue;
      }

      const after = entry.apply(working);

      if (entry.pending) {
        nextEntries.push(entry);
        working = after;
        continue;
      }

      // Retained local overlays are now auto-collected when base state catches up.
      if (entry.retainUntilSuperseded) {
        if (after === working) {
          changed = true;
          continue;
        }
        nextEntries.push(entry);
        working = after;
        continue;
      }

      // Completed non-retained entries should generally be gone already,
      // but keep them if they still affect derived state.
      if (after !== working) {
        nextEntries.push(entry);
        working = after;
        continue;
      }

      changed = true;
    }

    if (!changed) return;
    this.optimisticEntries = nextEntries;
  }

  private createEntry({
    kind,
    conflictKeys,
    apply,
    pending,
    retainUntilSuperseded,
  }: {
    kind: string;
    conflictKeys: string[];
    apply: BoardTransform;
    pending: boolean;
    retainUntilSuperseded: boolean;
  }): OptimisticEntry {
    return {
      opId: this.nextOpId++,
      kind,
      conflictKeys,
      apply,
      pending,
      superseded: false,
      retainUntilSuperseded,
    };
  }

  private supersedeConflicts(conflictKeys: string[]): void {
    if (conflictKeys.length === 0) return;
    let changed = false;
    for (const entry of this.optimisticEntries) {
      if (entry.superseded) continue;
      if (!overlap(entry.conflictKeys, conflictKeys)) continue;
      entry.superseded = true;
      changed = true;
    }
    if (!changed) return;
    this.pruneEntries();
  }

  private pruneEntries(): void {
    this.optimisticEntries = this.optimisticEntries.filter((entry) => {
      if (entry.pending) return true;
      if (entry.retainUntilSuperseded && !entry.superseded) return true;
      return false;
    });
  }

  private setSnapshot(next: KanbanStoreSnapshot): void {
    const previous = this.snapshot;
    if (
      previous.board === next.board
      && previous.databaseView === next.databaseView
      && previous.pageIndex === next.pageIndex
      && previous.loading === next.loading
      && previous.loadingMore === next.loadingMore
      && previous.hasMore === next.hasMore
      && previous.error === next.error
      && previous.pendingMutationCount === next.pendingMutationCount
      && previous.lastMutationError === next.lastMutationError
      && previous.totalRows === next.totalRows
      && groupPaginationEquals(previous.groupPagination, next.groupPagination)
    ) {
      return;
    }

    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private requestRealtimeRefresh(minimumCommitSeq = 0): void {
    this.stale = true;
    void this.fetchBoard(minimumCommitSeq);
  }

  private refreshFromProjection = async (
    cause: ProjectionStreamMessage,
  ): Promise<void> => {
    this.stale = true;
    if (cause.kind === "reset") {
      // A new Store epoch has a new cursor origin; never carry an old
      // minimumCommitSeq into that coordinate space.
      this.requiredMinimumCommitSeq = 0;
    }
    if (this.listeners.size === 0) return;
    const refreshed = await this.fetchBoard(
      cause.kind === "reset" ? 0 : cause.stream.commitSeq,
    );
    if (!refreshed) {
      throw new Error(this.snapshot.error ?? "Board projection refresh failed");
    }
  };

  private ensureRealtimeSubscription(): void {
    if (!this.unsubscribeBoardChanges) {
      this.unsubscribeBoardChanges = this.dependencies.subscribeBoardChanges(
        this.projectId,
        (event) => {
          if (this.databaseViewId) {
            if (
              this.baseBoardAuthority
              && event.storeEpoch
              && event.storeEpoch !== this.baseBoardAuthority.storeEpoch
            ) {
              this.requiredMinimumCommitSeq = 0;
            }
            this.stale = true;
            this.requestRealtimeRefresh(event.commitSeq ?? 0);
            return;
          }
          const authority = this.baseBoardAuthority;
          if (
            !authority
            || !event.storeEpoch
            || event.commitSeq === undefined
            || event.storeEpoch !== authority.storeEpoch
            || event.commitSeq < authority.commitSeq
          ) {
            this.requestRealtimeRefresh(event.commitSeq ?? 0);
            return;
          }
          const nextBoard = applyBoardChangeEventToBoard(
            this.baseBoard ?? undefined,
            event,
          );
          if (nextBoard) {
            if (nextBoard !== this.baseBoard) {
              this.baseBoard = nextBoard;
              this.baseBoardAuthority = {
                ...authority,
                board: nextBoard,
                commitSeq: event.commitSeq,
              };
              this.lastFetchedAt = this.dependencies.now();
              this.stale = false;
              this.recomputeSnapshot();
            }
            return;
          }
          this.requestRealtimeRefresh(event.commitSeq ?? 0);
        },
      );
    }
    this.ensureProjectionSubscription();
  }

  private ensureProjectionSubscription(): void {
    if (this.unsubscribeProjectionInvalidation) return;
    const authority = this.baseBoardAuthority;
    const registry = this.dependencies.getProjectionInvalidationRegistry();
    const causalRuntime = this.ensureCausalProjectionRuntime();
    if (!authority || !registry || !causalRuntime) return;
    this.unsubscribeProjectionInvalidation = registry.register({
      scope: {
        kind: "project",
        libraryId: authority.libraryId,
        projectId: this.projectId,
      },
      consumerKey: `kanban:${this.projectId}:${this.databaseViewId ?? "primary"}`,
      causalRuntime,
      getDependencies: () => {
        const current = this.baseBoardAuthority;
        return {
          databaseIds: current ? [current.databaseId] : [],
          dataSourceIds: current ? [current.dataSourceId] : [],
          viewIds: current ? [current.viewId] : [],
          pageIds: [...this.snapshot.pageIndex.keys()],
        };
      },
      getCursor: () => {
        const current = this.baseBoardAuthority;
        return current
          ? {
              storeEpoch: current.storeEpoch,
              commitSeq: current.projection.coveredCommitSeq,
            }
          : null;
      },
      invalidate: this.refreshFromProjection,
    });
  }

  private teardownRealtimeSubscription(): void {
    this.unsubscribeBoardChanges?.();
    this.unsubscribeProjectionInvalidation?.();
    this.unsubscribeBoardChanges = null;
    this.unsubscribeProjectionInvalidation = null;
  }
}

class KanbanStoreRegistry {
  private readonly stores = new Map<string, KanbanProjectStore>();

  constructor(private readonly dependencies: KanbanStoreDependencies) {}

  getStore(
    projectId: string,
    databaseViewId: string | null = null,
  ): KanbanProjectStore {
    const key = JSON.stringify([projectId, databaseViewId]);
    const existing = this.stores.get(key);
    if (existing) return existing;

    const store = new KanbanProjectStore(
      projectId,
      databaseViewId,
      this.dependencies,
    );
    this.stores.set(key, store);
    return store;
  }
}

export function createKanbanStoreRegistry(
  dependencies: Partial<KanbanStoreDependencies> = {},
): KanbanStoreRegistry {
  return new KanbanStoreRegistry({
    ...defaultDependencies,
    ...dependencies,
  });
}

const sharedKanbanStoreRegistry = createKanbanStoreRegistry();

export function getKanbanProjectStore(
  projectId: string,
  databaseViewId: string | null = null,
): KanbanProjectStore {
  return sharedKanbanStoreRegistry.getStore(projectId, databaseViewId);
}

export function ensureFreshKanbanProjectBoard(
  projectId: string,
  options?: EnsureFreshBoardOptions,
): Promise<void> {
  return getKanbanProjectStore(projectId).ensureFreshBoard(options);
}

export function ensureFreshDatabaseViewBoard(
  projectId: string,
  databaseViewId: string,
  options?: EnsureFreshBoardOptions,
): Promise<void> {
  return getKanbanProjectStore(projectId, databaseViewId).ensureFreshBoard(
    options,
  );
}
