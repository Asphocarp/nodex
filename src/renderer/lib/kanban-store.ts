import {
  CoreApiError,
  readDatabaseViewGroups,
  readDatabaseViewWindow,
  subscribeBoardChanges,
} from "./api";
import type {
  BoardSummary,
  PageInput,
  DatabasePageSummary,
  BoardSummarySnapshot,
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
import type { BlockRecordRead } from "../../shared/core-modules/block-record-module";
import type { BlockRecordWindow } from "../../shared/block-records";
import {
  buildCreateBlockRecordApplyInput,
  buildArchiveBlockRecordSubtreeApplyInput,
  buildPromoteManyBlockRecordApplyInput,
  buildUpdateBlockRecordApplyInput,
  buildUpdateManyBlockRecordsApplyInput,
  planFractionalRank,
} from "../../shared/block-records";
import type { BlockRecordWindowStore } from "./block-record-window-store";
import { createBlockRecordWindowStore } from "./block-record-window-store";
import { projectBlockRecordWindowToBoard } from "./block-record-board-projection";

const DEFAULT_BOARD_FRESHNESS_MS = 30_000;
const GROUP_WINDOW_FIRST = 50;
const GROUP_WINDOW_MAX_FIRST = 200;

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

export interface OptimisticMutationResult<T> {
  ok: boolean;
  result?: T;
  error?: Error;
  superseded: boolean;
  opId: number;
}

export interface PromoteBlockToPageOptions {
  readonly blockId: string;
  readonly groupKey: string;
  readonly beforePageId?: string;
  readonly actorId: string;
  readonly sessionId: string;
}

export interface PromoteBlocksToPageOptions {
  readonly blockIds: readonly string[];
  readonly groupKey: string;
  readonly beforePageId?: string;
  readonly actorId: string;
  readonly sessionId: string;
}

export interface CreateBlockRecordPageOptions {
  readonly blockId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly materializedJson: unknown;
  readonly groupKey: string | null;
  readonly placement: "top" | "bottom" | { readonly beforePageId: string };
  readonly actorId: string;
  readonly sessionId: string;
}

export interface UpdateBlockRecordOptions {
  readonly blockId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly view?: {
    readonly groupKey: string | null;
    readonly rankKey: string;
  };
  readonly actorId: string;
  readonly sessionId: string;
}

export interface UpdateManyBlockRecordsOptions {
  readonly entries: readonly {
    readonly blockId: string;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly view?: {
      readonly groupKey: string | null;
      readonly rankKey: string;
    };
  }[];
  readonly viewRebalances?: readonly {
    readonly blockId: string;
    readonly groupKey: string | null;
    readonly rankKey: string;
  }[];
  readonly actorId: string;
  readonly sessionId: string;
}

export interface ArchiveBlockRecordOptions {
  readonly blockId: string;
  readonly actorId: string;
  readonly sessionId: string;
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
  createBlockRecordWindowStore?: () => BlockRecordWindowStore;
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

interface CanonicalBoardAuthority {
  readonly projectId: string;
  readonly libraryId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly viewId: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
}

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
    changeLogSeq: Math.min(...windows.map((window) => window.changeLogSeq)),
    projectionRevision: Math.min(
      ...windows.map((window) => window.projectionRevision),
    ),
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

  /**
   * Board identity is available from the bounded Data Source descriptor and
   * the BlockRecord window. It must not wait for compatibility row windows.
   */
  private canonicalBoardAuthority: CanonicalBoardAuthority | null = null;

  private baseDatabaseView: DatabaseViewRenderModel | null = null;

  /**
   * The Board's canonical card projection. The legacy Database View window is
   * retained only for View metadata and pagination until the remaining
   * surfaces are moved to BlockRecord reads.
   */
  private blockRecordBoard: BoardSummary | null = null;

  private blockRecordWindow: BlockRecordWindow | null = null;

  private readonly blockRecordWindowStore: BlockRecordWindowStore | null;

  private unsubscribeBlockRecordWindow: (() => void) | null = null;

  private stopBlockRecordCommitSubscription: (() => void) | null = null;

  private groupWindows = new Map<GroupWindowScopeKey, GroupWindowState>();

  private groupsSnapshot: DatabaseViewGroupsSnapshot | null = null;

  private optimisticEntries: OptimisticEntry[] = [];

  private nextOpId = 1;

  private inFlightFetch: Promise<void> | null = null;

  private unsubscribeBoardChanges: (() => void) | null = null;

  private unsubscribeProjectionInvalidation: (() => void) | null = null;

  private requiredMinimumCommitSeq = 0;

  private requiredRefreshGeneration = 0;

  private completedRefreshGeneration = 0;

  private lastFetchedAt = 0;

  private stale = true;

  constructor(
    private readonly projectId: string,
    private readonly databaseViewId: string | null,
    private readonly dependencies: KanbanStoreDependencies,
  ) {
    this.blockRecordWindowStore = dependencies.createBlockRecordWindowStore?.() ?? null;
  }

  getSnapshot = (): KanbanStoreSnapshot => this.snapshot;

  getBlockRecordWindow = (): BlockRecordWindow | null => this.blockRecordWindow;

  getBoardSummarySnapshot = (): BoardSummarySnapshot | null => {
    const authority = this.canonicalBoardAuthority;
    const board = this.snapshot.board;
    if (!authority || !board) return null;
    return {
      projectId: this.projectId,
      libraryId: authority.libraryId,
      databaseId: authority.databaseId,
      dataSourceId: authority.dataSourceId,
      viewId: authority.viewId,
      storeEpoch: authority.storeEpoch,
      changeLogSeq: authority.changeLogSeq,
      board,
    };
  };

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

  private attachBlockRecordWindow(window: BlockRecordWindow): void {
    if (window === this.blockRecordWindow) return;
    this.blockRecordWindow = window;
    if (this.canonicalBoardAuthority) {
      this.canonicalBoardAuthority = {
        ...this.canonicalBoardAuthority,
        storeEpoch: window.observedLocalCommit.storeEpoch,
        changeLogSeq: window.observedLocalCommit.commitSeq,
      };
    }
    this.blockRecordBoard = projectBlockRecordWindowToBoard(window);
    this.recomputeSnapshot({ loading: false, error: null });
  }

  private blockRecordReadForGroups(groups: DatabaseViewGroupsSnapshot): BlockRecordRead {
    return {
      kind: "window",
      parent: { kind: "data_source", id: groups.dataSourceId },
      view_id: groups.viewId,
      // Board cards use the Page title content slot. The window is shallow:
      // direct Data Source children only, so this does not hydrate Page bodies.
      include_content: true,
    };
  }

  private loadBlockRecordBoard = async (
    groups: DatabaseViewGroupsSnapshot,
  ): Promise<void> => {
    const store = this.blockRecordWindowStore;
    if (!store) return;

    this.canonicalBoardAuthority = {
      projectId: groups.projectId,
      libraryId: groups.libraryId,
      databaseId: groups.databaseId,
      dataSourceId: groups.dataSourceId,
      viewId: groups.viewId,
      storeEpoch: groups.storeEpoch,
      changeLogSeq: groups.changeLogSeq,
    };

    const read = this.blockRecordReadForGroups(groups);
    const window = await store.load(read);
    this.unsubscribeBlockRecordWindow?.();
    this.unsubscribeBlockRecordWindow = store.subscribe((next) => {
      this.attachBlockRecordWindow(next);
    });
    this.stopBlockRecordCommitSubscription?.();
    this.stopBlockRecordCommitSubscription = store.startCommitSubscription();
    this.attachBlockRecordWindow(window);
  };

  private loadLegacyBoardWindows = async (
    groups: DatabaseViewGroupsSnapshot,
    minimumCommitSeq: number,
    refreshGeneration: number,
  ): Promise<boolean> => {
    try {
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
          minimumCommitSeq,
        ),
      })));
      if (
        refreshGeneration < this.requiredRefreshGeneration
        || (
          this.canonicalBoardAuthority
          && (
            this.canonicalBoardAuthority.storeEpoch !== groups.storeEpoch
            || this.canonicalBoardAuthority.viewId !== groups.viewId
          )
        )
      ) {
        return false;
      }
      const incomingSeq = Math.min(
        ...windows.map((window) => window.snapshot.changeLogSeq),
      );
      if (incomingSeq < minimumCommitSeq) {
        return false;
      }
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
      this.recomputeSnapshot({ error: null });
      return true;
    } catch {
      // The compatibility windows are pagination/metadata enrichment. They
      // must not hide a Board that already has a canonical BlockRecord
      // projection. Future invalidation or explicit pagination retries them.
      this.recomputeSnapshot({ error: null });
      return false;
    }
  };

  private fetchBoardOnce = async (
    minimumCommitSeq: number,
    refreshGeneration: number,
  ): Promise<void> => {
    const hasReadableBase = this.readableBoardBase() !== null;
    const shouldShowLoading = !hasReadableBase && !this.snapshot.loading;
    if (shouldShowLoading) {
      this.setSnapshot({
        ...this.snapshot,
        loading: true,
      });
    }

    try {
      const groups = await this.dependencies.readViewGroups(
        this.projectId,
        this.groupsInput(minimumCommitSeq),
      );
      this.groupsSnapshot = groups;
      let blockRecordLoadError: unknown = null;
      // The canonical Board is allowed to become visible as soon as its
      // BlockRecord window is ready. Legacy row windows start after that
      // publication because they only enrich pagination and View controls;
      // fetchBoard retains their completion in its promise for callers that
      // need the complete metadata snapshot.
      try {
        await this.loadBlockRecordBoard(groups);
      } catch (error) {
        blockRecordLoadError = error;
        this.blockRecordBoard = null;
        this.blockRecordWindow = null;
        this.canonicalBoardAuthority = null;
      }

      const hasCanonicalBoard = this.blockRecordBoard !== null;
      if (hasCanonicalBoard) {
        this.lastFetchedAt = this.dependencies.now();
        this.stale = false;
        this.ensureProjectionSubscription();
        this.recomputeSnapshot({
          loading: false,
          error: null,
        });
      }

      const hasLegacyBoard = await this.loadLegacyBoardWindows(
        groups,
        minimumCommitSeq,
        refreshGeneration,
      );
      const hasReadableBoard = hasCanonicalBoard
        || (!this.blockRecordWindowStore && hasLegacyBoard);
      if (!hasReadableBoard) {
        throw blockRecordLoadError ?? new Error("The Board could not be loaded");
      }
      if (!hasCanonicalBoard) {
        this.lastFetchedAt = this.dependencies.now();
        this.stale = false;
        this.ensureProjectionSubscription();
        this.recomputeSnapshot({
          loading: false,
          error: null,
        });
      }
    } catch (error) {
      this.stale = true;
      this.blockRecordBoard = null;
      this.blockRecordWindow = null;
      this.canonicalBoardAuthority = null;
      if (this.databaseViewId) {
        this.baseDatabaseView = null;
        this.baseBoard = null;
        this.baseBoardAuthority = null;
        this.groupWindows = new Map();
        this.groupsSnapshot = null;
      }
      this.recomputeSnapshot({
        loading: false,
        error: toError(error).message,
      });
    } finally {
      this.completedRefreshGeneration = Math.max(
        this.completedRefreshGeneration,
        refreshGeneration,
      );
    }
  };

  fetchBoard = async (minimumCommitSeq = 0): Promise<void> => {
    this.requiredMinimumCommitSeq = Math.max(
      this.requiredMinimumCommitSeq,
      minimumCommitSeq,
    );
    while (true) {
      const requestedMinimumCommitSeq = this.requiredMinimumCommitSeq;
      const requestedRefreshGeneration = this.requiredRefreshGeneration;
      if (this.inFlightFetch) {
        await this.inFlightFetch;
      } else {
        const inFlight = this.fetchBoardOnce(
          requestedMinimumCommitSeq,
          requestedRefreshGeneration,
        );
        this.inFlightFetch = inFlight;
        try {
          await inFlight;
        } finally {
          if (this.inFlightFetch === inFlight) this.inFlightFetch = null;
        }
      }
      if (
        this.requiredMinimumCommitSeq <= requestedMinimumCommitSeq
        && this.completedRefreshGeneration >= requestedRefreshGeneration
      ) return;
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
        group.snapshot.changeLogSeq,
      );
      const current = this.groupWindows.get(scopeKey);
      if (!current) return;
      this.groupWindows = new Map(this.groupWindows).set(scopeKey, {
        ...current,
        snapshot,
        inlineError: null,
      });
      this.rebuildFromGroups();
      if (this.groupsSnapshot) await this.loadBlockRecordBoard(this.groupsSnapshot);
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
        group.snapshot.changeLogSeq,
      );
      const current = this.groupWindows.get(scopeKey);
      if (!current || current.snapshot.nextCursor !== after) return;
      if (
        next.storeEpoch !== current.snapshot.storeEpoch
        || next.viewId !== current.snapshot.viewId
      ) {
        // The continuation crossed a Store/View identity boundary; converge
        // the whole board from its first windows instead of merging.
        this.stale = true;
        await this.fetchBoard().catch(() => {});
        return;
      }
      this.groupWindows = new Map(this.groupWindows).set(scopeKey, {
        ...current,
        snapshot: appendWindow(current.snapshot, next),
        inlineError: null,
      });
      this.rebuildFromGroups();
      if (this.groupsSnapshot) await this.loadBlockRecordBoard(this.groupsSnapshot);
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
    const hasReadableBase = this.readableBoardBase() !== null;
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

  /**
   * Promotes one stable BlockRecord directly into the loaded Board window.
   * Core's apply response is admitted into the window before the durable
   * LocalCommit tail can replay the same envelope, so the Board never waits
   * for a projection refresh to reveal the new Page.
   */
  promoteBlockToPage = async (
    input: PromoteBlockToPageOptions,
  ): Promise<void> => {
    await this.promoteBlocksToPage({
      ...input,
      blockIds: [input.blockId],
    });
  };

  promoteBlocksToPage = async (
    input: PromoteBlocksToPageOptions,
  ): Promise<void> => {
    if (input.blockIds.length === 0) throw new Error("No Blocks were selected");
    const uniqueBlockIds = [...new Set(input.blockIds)];
    if (uniqueBlockIds.length !== input.blockIds.length) {
      throw new Error("The Block selection contains duplicates");
    }
    const windowStore = this.blockRecordWindowStore;
    const boardWindow = this.blockRecordWindow;
    const authority = this.canonicalBoardAuthority;
    if (!windowStore || !boardWindow || !authority) {
      throw new Error("The BlockRecord Board window is not loaded");
    }
    const source = await windowStore.read({
      kind: "window",
      block_ids: uniqueBlockIds,
      include_content: true,
    });
    const records = new Map(source.records.map((record) => [record.id, record]));
    const placements = new Map(source.placements.map((placement) => [placement.blockId, placement]));
    for (const blockId of uniqueBlockIds) {
      if (!records.has(blockId) || !placements.has(blockId)) {
        throw new Error("BlockRecord " + blockId + " is not available");
      }
    }
    const targetViewPositions = boardWindow.viewPositions
      .filter((position) =>
        position.viewId === authority.viewId
        && position.groupKey === input.groupKey
        && !records.has(position.blockId),
      )
      .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId));
    const targetPlacements = boardWindow.placements
      .filter((placement) =>
        placement.parent.kind === "dataSource"
        && placement.parent.dataSourceId === authority.dataSourceId
        && !records.has(placement.blockId),
      )
      .sort((left, right) =>
        left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId));
    const viewItems = targetViewPositions.map((position) => ({
      id: position.blockId,
      rankKey: position.rankKey,
    }));
    const placementItems = targetPlacements.map((placement) => ({
      id: placement.blockId,
      rankKey: placement.rankKey,
    }));
    const viewRebalances = new Map<string, {
      blockId: string;
      groupKey: string | null;
      rankKey: string;
      expectedRevision: number;
    }>();
    const placementRebalances = new Map<string, {
      blockId: string;
      rankKey: string;
      expectedRevision: number;
    }>();
    const entries = new Map<string, {
      blockId: string;
      viewGroupKey: string;
      viewRankKey: string;
      rankKey: string;
      expectedBlockRevision: number;
      expectedPlacementRevision: number;
    }>();
    for (const blockId of uniqueBlockIds) {
      const record = records.get(blockId);
      const placement = placements.get(blockId);
      if (!record || !placement) throw new Error("BlockRecord " + blockId + " is not available");
      const viewPlan = planFractionalRank(viewItems, blockId, input.beforePageId);
      const placementPlan = planFractionalRank(placementItems, blockId, input.beforePageId);
      for (const [rebalanceId, rankKey] of placementPlan.rebalancedRankKeys) {
        const placement = targetPlacements.find((candidate) => candidate.blockId === rebalanceId);
        if (!placement) {
          throw new Error(`Board placement rebalance target ${rebalanceId} is not loaded`);
        }
        placementRebalances.set(rebalanceId, {
          blockId: rebalanceId,
          rankKey,
          expectedRevision: placement.revision,
        });
        const item = placementItems.find((candidate) => candidate.id === rebalanceId);
        if (item) item.rankKey = rankKey;
      }
      for (const [rebalanceId, rankKey] of viewPlan.rebalancedRankKeys) {
        const position = targetViewPositions.find((candidate) => candidate.blockId === rebalanceId);
        if (position) {
          viewRebalances.set(rebalanceId, {
            blockId: rebalanceId,
            groupKey: position.groupKey,
            rankKey,
            expectedRevision: position.revision,
          });
        }
        const item = viewItems.find((candidate) => candidate.id === rebalanceId);
        if (item) item.rankKey = rankKey;
        const existingEntry = entries.get(rebalanceId);
        if (existingEntry) entries.set(rebalanceId, { ...existingEntry, viewRankKey: rankKey });
      }
      entries.set(blockId, {
        blockId,
        viewGroupKey: input.groupKey,
        viewRankKey: viewPlan.rankKey,
        rankKey: placementPlan.rankKey,
        expectedBlockRevision: record.revision,
        expectedPlacementRevision: placement.revision,
      });
      const viewIndex = input.beforePageId === undefined
        ? viewItems.length
        : viewItems.findIndex((item) => item.id === input.beforePageId);
      const placementIndex = input.beforePageId === undefined
        ? placementItems.length
        : placementItems.findIndex((item) => item.id === input.beforePageId);
      if (viewIndex < 0 || placementIndex < 0) {
        throw new Error("Board order anchor does not exist: " + input.beforePageId);
      }
      viewItems.splice(viewIndex, 0, { id: blockId, rankKey: viewPlan.rankKey });
      placementItems.splice(placementIndex, 0, { id: blockId, rankKey: placementPlan.rankKey });
    }
    const applyInput = await buildPromoteManyBlockRecordApplyInput({
      operationId: crypto.randomUUID(),
      actorId: input.actorId,
      sessionId: input.sessionId,
      dataSourceId: authority.dataSourceId,
      viewId: authority.viewId,
      entries: uniqueBlockIds.map((blockId) => entries.get(blockId)!).filter(Boolean),
      viewRebalances: [...viewRebalances.values()],
      placementRebalances: [...placementRebalances.values()],
    });
    await windowStore.apply(applyInput);
  };

  createBlockRecordPage = async (
    input: CreateBlockRecordPageOptions,
  ): Promise<void> => {
    const windowStore = this.blockRecordWindowStore;
    const window = this.blockRecordWindow;
    const authority = this.canonicalBoardAuthority;
    if (!windowStore || !window || !authority) {
      throw new Error("The BlockRecord Board window is not loaded");
    }
    if (window.rootParent.kind !== "dataSource") {
      throw new Error("A Board Page must be owned by its Data Source");
    }
    const dataSourceId = window.rootParent.dataSourceId;
    const beforePageId = input.placement === "top"
      ? window.viewPositions
        .filter((position) => (
          position.viewId === authority.viewId
          && position.groupKey === input.groupKey
        ))
        .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))[0]
        ?.blockId
      : typeof input.placement === "object"
        ? input.placement.beforePageId
        : undefined;
    const placementItems = window.placements
      .filter((placement) => (
        placement.parent.kind === "dataSource"
        && placement.parent.dataSourceId === dataSourceId
      ))
      .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
      .map((placement) => ({ id: placement.blockId, rankKey: placement.rankKey }));
    const viewItems = window.viewPositions
      .filter((position) => (
        position.viewId === authority.viewId
        && position.groupKey === input.groupKey
      ))
      .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
      .map((position) => ({ id: position.blockId, rankKey: position.rankKey }));
    const placementPlan = planFractionalRank(placementItems, input.blockId, beforePageId);
    const viewPlan = planFractionalRank(viewItems, input.blockId, beforePageId);
    const placementRebalances = [...placementPlan.rebalancedRankKeys].map(([blockId, rankKey]) => {
      const placement = window.placements.find((candidate) => candidate.blockId === blockId);
      if (!placement) throw new Error(`BlockRecord placement ${blockId} is not available`);
      return {
        blockId,
        rankKey,
        expectedRevision: placement.revision,
      };
    });
    const viewRebalances = [...viewPlan.rebalancedRankKeys].map(([blockId, rankKey]) => {
      const position = window.viewPositions.find((candidate) => (
        candidate.viewId === authority.viewId && candidate.blockId === blockId
      ));
      if (!position) throw new Error(`BlockRecord View position ${blockId} is not available`);
      return {
        blockId,
        groupKey: position.groupKey,
        rankKey,
        expectedRevision: position.revision,
      };
    });
    await windowStore.apply(
      await buildCreateBlockRecordApplyInput({
        operationId: crypto.randomUUID(),
        actorId: input.actorId,
        sessionId: input.sessionId,
        blockId: input.blockId,
        blockKind: "page",
        properties: input.properties,
        contentShardId: `block-record-shard:${input.blockId}`,
        parent: {
          kind: "dataSource",
          dataSourceId,
        },
        rankKey: placementPlan.rankKey,
        viewId: authority.viewId,
        dataSourceId: authority.dataSourceId,
        viewGroupKey: input.groupKey,
        viewRankKey: viewPlan.rankKey,
        materializedJson: input.materializedJson,
        placementRebalances,
        viewRebalances,
      }),
    );
  };

  updateBlockRecord = async (input: UpdateBlockRecordOptions): Promise<void> => {
    const windowStore = this.blockRecordWindowStore;
    const window = this.blockRecordWindow;
    if (!windowStore || !window) throw new Error("The BlockRecord window is not loaded");
    const record = window.records.find((candidate) => candidate.id === input.blockId);
    if (!record) throw new Error(`BlockRecord ${input.blockId} is not available`);
    const viewPosition = input.view
      ? window.viewPositions.find((candidate) => (
        candidate.viewId === window.viewId && candidate.blockId === input.blockId
      ))
      : undefined;
    const view = input.view && window.viewId
      ? {
        viewId: window.viewId,
        dataSourceId: viewPosition?.dataSourceId
          ?? (window.rootParent.kind === "dataSource" ? window.rootParent.dataSourceId : null),
        groupKey: input.view.groupKey,
        rankKey: input.view.rankKey,
        expectedRevision: viewPosition?.revision ?? 0,
      }
      : undefined;
    if (input.view && (!view || !view.dataSourceId)) {
      throw new Error("The BlockRecord View position is not available");
    }
    await windowStore.apply(
      await buildUpdateBlockRecordApplyInput({
        operationId: crypto.randomUUID(),
        actorId: input.actorId,
        sessionId: input.sessionId,
        blockId: input.blockId,
        properties: input.properties,
        expectedBlockRevision: record.revision,
        ...(view
          ? {
            viewId: view.viewId,
            dataSourceId: view.dataSourceId!,
            viewGroupKey: view.groupKey,
            viewRankKey: view.rankKey,
            expectedViewRevision: view.expectedRevision,
          }
          : {}),
      }),
    );
  };

  updateBlockRecords = async (input: UpdateManyBlockRecordsOptions): Promise<void> => {
    const windowStore = this.blockRecordWindowStore;
    const window = this.blockRecordWindow;
    if (!windowStore || !window || input.entries.length === 0) {
      throw new Error("The BlockRecord Board window is not loaded");
    }
    const records = new Map(window.records.map((record) => [record.id, record]));
    const entries = input.entries.map((entry) => {
      const record = records.get(entry.blockId);
      if (!record) throw new Error(`BlockRecord ${entry.blockId} is not available`);
      if (!entry.view) {
        return {
          blockId: entry.blockId,
          properties: entry.properties,
          expectedBlockRevision: record.revision,
        };
      }
      if (!window.viewId) throw new Error("The BlockRecord Board View is not loaded");
      const currentPosition = window.viewPositions.find((position) => (
        position.viewId === window.viewId && position.blockId === entry.blockId
      ));
      const dataSourceId = currentPosition?.dataSourceId
        ?? (window.rootParent.kind === "dataSource" ? window.rootParent.dataSourceId : null);
      if (!dataSourceId) throw new Error(`BlockRecord View position ${entry.blockId} is not available`);
      return {
        blockId: entry.blockId,
        properties: entry.properties,
        expectedBlockRevision: record.revision,
        viewId: window.viewId,
        dataSourceId,
        viewGroupKey: entry.view.groupKey,
        viewRankKey: entry.view.rankKey,
        expectedViewRevision: currentPosition?.revision ?? 0,
      };
    });
    await windowStore.apply(
      await buildUpdateManyBlockRecordsApplyInput({
        operationId: crypto.randomUUID(),
        actorId: input.actorId,
        sessionId: input.sessionId,
        entries,
        viewRebalances: (input.viewRebalances ?? []).map((rebalance) => {
          if (!window.viewId) throw new Error("The BlockRecord Board View is not loaded");
          const position = window.viewPositions.find((candidate) => (
            candidate.viewId === window.viewId && candidate.blockId === rebalance.blockId
          ));
          if (!position) throw new Error(`BlockRecord View position ${rebalance.blockId} is not available`);
          return {
            blockId: rebalance.blockId,
            groupKey: rebalance.groupKey,
            rankKey: rebalance.rankKey,
            expectedRevision: position.revision,
          };
        }),
      }),
    );
  };

  archiveBlockRecord = async (input: ArchiveBlockRecordOptions): Promise<void> => {
    const windowStore = this.blockRecordWindowStore;
    const window = this.blockRecordWindow;
    if (!windowStore || !window) throw new Error("The BlockRecord window is not loaded");
    const record = window.records.find((candidate) => candidate.id === input.blockId);
    const placement = window.placements.find((candidate) => candidate.blockId === input.blockId);
    if (!record || !placement) throw new Error(`BlockRecord ${input.blockId} is not available`);
    await windowStore.apply(
      await buildArchiveBlockRecordSubtreeApplyInput({
        operationId: crypto.randomUUID(),
        actorId: input.actorId,
        sessionId: input.sessionId,
        blockId: input.blockId,
        expectedBlockRevision: record.revision,
        expectedPlacementRevision: placement.revision,
      }),
    );
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

  enqueueLocalOverlay = (options: LocalOverlayOptions): boolean => {
    this.supersedeConflicts(options.conflictKeys);
    const boardBase = this.readableBoardBase();
    const before = boardBase ? this.composeBoard(boardBase) : null;
    const entry = this.createEntry({
      ...options,
      pending: false,
      retainUntilSuperseded: true,
    });
    this.optimisticEntries.push(entry);
    const afterBase = this.readableBoardBase();
    const after = afterBase ? this.composeBoard(afterBase) : null;
    if (afterBase && after === before) {
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

  private readableBoardBase(): BoardSummary | null {
    // The production registry always provides the BlockRecord store. A
    // legacy-only dependency is retained for isolated tests and non-terminal
    // adapters, but it is never a fallback for a failed canonical Board read.
    return this.blockRecordWindowStore
      ? this.blockRecordBoard
      : this.baseBoard;
  }

  private projectionAuthority(): CanonicalBoardAuthority | null {
    if (this.canonicalBoardAuthority) return this.canonicalBoardAuthority;
    const legacy = this.baseBoardAuthority;
    if (!legacy) return null;
    return {
      projectId: legacy.projectId,
      libraryId: legacy.libraryId,
      databaseId: legacy.databaseId,
      dataSourceId: legacy.dataSourceId,
      viewId: legacy.viewId,
      storeEpoch: legacy.storeEpoch,
      changeLogSeq: legacy.changeLogSeq,
    };
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
    const boardSource = this.readableBoardBase();
    const board = boardSource ? this.composeBoard(boardSource) : null;
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
    const boardBase = this.readableBoardBase();
    if (!boardBase) return;
    if (this.optimisticEntries.length === 0) return;

    let working = boardBase;
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
    if (cause.kind === "resync") {
      // A new Store epoch has a new cursor origin; never carry an old
      // minimumCommitSeq into that coordinate space.
      this.requiredMinimumCommitSeq = 0;
    }
    if (this.listeners.size === 0) return;
    await this.fetchBoard(
      cause.kind === "resync" ? 0 : cause.cursor.changeLogSeq,
    );
  };

  private ensureRealtimeSubscription(): void {
    if (!this.unsubscribeBoardChanges) {
      this.unsubscribeBoardChanges = this.dependencies.subscribeBoardChanges(
        this.projectId,
        (event) => {
          if (this.databaseViewId) {
            if (
              this.canonicalBoardAuthority
              && event.storeEpoch
              && event.storeEpoch !== this.canonicalBoardAuthority.storeEpoch
            ) {
              this.requiredMinimumCommitSeq = 0;
            }
            this.stale = true;
            this.requestRealtimeRefresh(event.changeLogSeq ?? 0);
            return;
          }
          // Legacy Board notifications are invalidation hints only. The
          // visible Board is owned by the BlockRecord LocalCommit stream;
          // accepting a summary here would recreate a second authority and
          // could make a late projection overwrite an admitted local commit.
          this.requestRealtimeRefresh(event.changeLogSeq ?? 0);
        },
      );
    }
    this.ensureProjectionSubscription();
  }

  private ensureProjectionSubscription(): void {
    if (this.unsubscribeProjectionInvalidation) return;
    const authority = this.projectionAuthority();
    const registry = this.dependencies.getProjectionInvalidationRegistry();
    if (!authority || !registry) return;
    this.unsubscribeProjectionInvalidation = registry.register({
      scope: {
        kind: "project",
        libraryId: authority.libraryId,
        projectId: this.projectId,
      },
      consumerKey: `kanban:${this.projectId}:${this.databaseViewId ?? "primary"}`,
      getDependencies: () => {
        const current = this.projectionAuthority();
        return {
          databaseIds: current ? [current.databaseId] : [],
          dataSourceIds: current ? [current.dataSourceId] : [],
          viewIds: current ? [current.viewId] : [],
          pageIds: [...this.snapshot.pageIndex.keys()],
        };
      },
      getCursor: () => {
        const current = this.projectionAuthority();
        return current
          ? {
              storeEpoch: current.storeEpoch,
              changeLogSeq: current.changeLogSeq,
            }
          : null;
      },
      invalidate: this.refreshFromProjection,
    });
  }

  private teardownRealtimeSubscription(): void {
    this.unsubscribeBoardChanges?.();
    this.unsubscribeProjectionInvalidation?.();
    this.unsubscribeBlockRecordWindow?.();
    this.stopBlockRecordCommitSubscription?.();
    this.unsubscribeBoardChanges = null;
    this.unsubscribeProjectionInvalidation = null;
    this.unsubscribeBlockRecordWindow = null;
    this.stopBlockRecordCommitSubscription = null;
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

const sharedKanbanStoreRegistry = createKanbanStoreRegistry({
  createBlockRecordWindowStore,
});

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

/**
 * Query boundary for picker surfaces. The returned Board is the same
 * BlockRecord projection used by the mounted Kanban store; legacy Board
 * notifications only invalidate this read and never patch its result.
 */
export async function readCanonicalKanbanBoardSnapshot(
  projectId: string,
): Promise<BoardSummarySnapshot> {
  const store = getKanbanProjectStore(projectId);
  await store.ensureFreshBoard();
  const snapshot = store.getBoardSummarySnapshot();
  if (!snapshot) throw new Error("The canonical Board projection is not ready");
  return snapshot;
}
