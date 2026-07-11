import {
  invoke,
  subscribeBoardChanges,
  subscribeDatabaseChanges,
} from "./api";
import type { BoardSummary, Card, CardInput, CardSummary } from "./types";
import {
  buildPatchCardTransform,
  conflictKeysForPatch,
  overlap,
  type BoardTransform,
} from "./kanban-optimistic-ops";
import { toCardSummary } from "../../shared/card-summary";
import { applyBoardChangeEventToBoard, upsertCardSummaryInBoard } from "./board-summary-events";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type { DatabaseViewSnapshotCommandResult } from "../../shared/database-query";
import {
  buildDatabaseViewRenderModel,
  type DatabaseViewRenderModel,
} from "./database-view-render-model";

const MUTATION_COOLDOWN_MS = 500;
const DEFAULT_BOARD_FRESHNESS_MS = 30_000;

export interface IndexedCard extends CardSummary {
  columnId: string;
  columnName: string;
  boardIndex: number;
}

export interface KanbanStoreSnapshot {
  board: BoardSummary | null;
  databaseView: DatabaseViewRenderModel | null;
  cardIndex: ReadonlyMap<string, IndexedCard>;
  loading: boolean;
  error: string | null;
  pendingMutationCount: number;
  lastMutationError: string | null;
}

export interface OptimisticMutationResult<T> {
  ok: boolean;
  result?: T;
  error?: Error;
  superseded: boolean;
  opId: number;
}

type StoreListener = () => void;

type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;
type SubscribeBoardChangesFn = (projectId: string, callback: (event: BoardChangeEvent) => void) => () => void;
type SubscribeDatabaseChangesFn = (projectId: string, callback: (event: DatabaseChangeEvent) => void) => () => void;
type NowFn = () => number;

export interface KanbanStoreDependencies {
  invoke: InvokeFn;
  subscribeBoardChanges: SubscribeBoardChangesFn;
  subscribeDatabaseChanges: SubscribeDatabaseChangesFn;
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
  cardId: string;
  updates: Partial<CardInput>;
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
  invoke,
  subscribeBoardChanges,
  subscribeDatabaseChanges,
  now: () => Date.now(),
};

function buildCardIndex(board: BoardSummary | null): ReadonlyMap<string, IndexedCard> {
  if (!board) return new Map();

  const index = new Map<string, IndexedCard>();
  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
    const column = board.columns[columnIndex];
    if (!column) continue;

    for (let cardIndex = 0; cardIndex < column.cards.length; cardIndex += 1) {
      const card = column.cards[cardIndex];
      if (!card) continue;

      index.set(card.id, {
        ...card,
        columnId: column.id,
        columnName: column.name,
        boardIndex: columnIndex * 100_000 + cardIndex,
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

class KanbanProjectStore {
  private readonly listeners = new Set<StoreListener>();

  private snapshot: KanbanStoreSnapshot = {
    board: null,
    databaseView: null,
    cardIndex: new Map(),
    loading: true,
    error: null,
    pendingMutationCount: 0,
    lastMutationError: null,
  };

  private baseBoard: BoardSummary | null = null;

  private baseDatabaseView: DatabaseViewRenderModel | null = null;

  private optimisticEntries: OptimisticEntry[] = [];

  private nextOpId = 1;

  private inFlightFetch: Promise<void> | null = null;

  private unsubscribeBoardChanges: (() => void) | null = null;

  private unsubscribeDatabaseChanges: (() => void) | null = null;

  private lastMutationAt = 0;

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

  fetchBoard = async (): Promise<void> => {
    if (this.inFlightFetch) return this.inFlightFetch;

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

    this.inFlightFetch = (async () => {
      try {
        const result = this.databaseViewId
          ? (await this.dependencies.invoke(
              "database-views:snapshot",
              this.projectId,
              this.databaseViewId,
            )) as DatabaseViewSnapshotCommandResult
          : null;
        if (result && !result.ok) {
          throw new Error(result.error.message);
        }
        const databaseView = result
          ? buildDatabaseViewRenderModel(result.value)
          : null;
        const board = databaseView && !databaseView.primaryWriteCompatible
          ? null
          : (await this.dependencies.invoke(
              "board:summary:get",
              this.projectId,
            )) as BoardSummary;
        this.baseDatabaseView = databaseView;
        this.baseBoard = board;
        this.lastFetchedAt = this.dependencies.now();
        this.stale = false;
        this.recomputeSnapshot({
          loading: false,
          error: null,
        });
      } catch (error) {
        this.stale = true;
        if (this.databaseViewId) {
          this.baseDatabaseView = null;
          this.baseBoard = null;
        }
        this.recomputeSnapshot({
          loading: false,
          error: toError(error).message,
        });
      } finally {
        this.inFlightFetch = null;
      }
    })();

    return this.inFlightFetch;
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

  refreshBoard = async (): Promise<void> => {
    if (this.inFlightFetch) {
      await this.inFlightFetch;
    }
    await this.fetchBoard();
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

  markMutation = (): void => {
    this.lastMutationAt = this.dependencies.now();
  };

  applyRemoteCard = (card: Card): void => {
    this.applyRemoteCardSummary(toCardSummary(card));
  };

  applyRemoteCardSummary = (card: CardSummary): void => {
    if (!this.baseBoard) return;

    const nextBoard = upsertCardSummaryInBoard(this.baseBoard, card);
    if (nextBoard === this.baseBoard) return;

    this.baseBoard = nextBoard;
    this.recomputeSnapshot();
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
    cardId: string,
    updates: Partial<CardInput>,
  ): boolean => {
    return this.enqueueLocalOverlay({
      kind: "card:patch-local",
      conflictKeys: conflictKeysForPatch(cardId, updates),
      apply: buildPatchCardTransform(columnId, cardId, updates),
    });
  };

  runOptimisticPatch = async <T,>({
    columnId,
    cardId,
    updates,
    runRemote,
  }: RunOptimisticPatchOptions<T>): Promise<T> => {
    const outcome = await this.runOptimisticMutation({
      kind: "block:properties",
      conflictKeys: conflictKeysForPatch(cardId, updates),
      apply: buildPatchCardTransform(columnId, cardId, updates),
      runRemote,
    });

    if (outcome.ok && outcome.result !== undefined) {
      return outcome.result;
    }
    throw outcome.error ?? new Error("Mutation failed");
  };

  runOptimisticMutation = async <T,>(options: RunOptimisticMutationOptions<T>): Promise<OptimisticMutationResult<T>> => {
    this.markMutation();
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

  private recomputeSnapshot(
    overrides: Partial<Pick<KanbanStoreSnapshot, "loading" | "error" | "lastMutationError">> = {},
  ): void {
    this.pruneConvergedEntries();
    const board = this.baseBoard ? this.composeBoard(this.baseBoard) : null;
    const hasLoading = Object.prototype.hasOwnProperty.call(overrides, "loading");
    const hasError = Object.prototype.hasOwnProperty.call(overrides, "error");
    const hasLastMutationError = Object.prototype.hasOwnProperty.call(overrides, "lastMutationError");
    const next: KanbanStoreSnapshot = {
      ...this.snapshot,
      board,
      databaseView: this.baseDatabaseView,
      cardIndex: buildCardIndex(board),
      pendingMutationCount: this.activePendingCount(),
      loading: hasLoading ? (overrides.loading as boolean) : this.snapshot.loading,
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
      && previous.cardIndex === next.cardIndex
      && previous.loading === next.loading
      && previous.error === next.error
      && previous.pendingMutationCount === next.pendingMutationCount
      && previous.lastMutationError === next.lastMutationError
    ) {
      return;
    }

    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private shouldSkipRealtimeRefresh(): boolean {
    return this.dependencies.now() - this.lastMutationAt < MUTATION_COOLDOWN_MS;
  }

  private ensureRealtimeSubscription(): void {
    if (!this.unsubscribeBoardChanges) {
      this.unsubscribeBoardChanges = this.dependencies.subscribeBoardChanges(
        this.projectId,
        (event) => {
          if (this.databaseViewId) {
            this.stale = true;
            if (this.shouldSkipRealtimeRefresh()) return;
            void this.fetchBoard();
            return;
          }
          const nextBoard = applyBoardChangeEventToBoard(
            this.baseBoard ?? undefined,
            event,
          );
          if (nextBoard) {
            if (nextBoard !== this.baseBoard) {
              this.baseBoard = nextBoard;
              this.lastFetchedAt = this.dependencies.now();
              this.stale = false;
              this.recomputeSnapshot();
            }
            return;
          }
          if (this.shouldSkipRealtimeRefresh()) return;
          void this.fetchBoard();
        },
      );
    }
    if (!this.unsubscribeDatabaseChanges) {
      this.unsubscribeDatabaseChanges =
        this.dependencies.subscribeDatabaseChanges(this.projectId, () => {
          this.stale = true;
          void this.refreshBoard();
        });
    }
  }

  private teardownRealtimeSubscription(): void {
    this.unsubscribeBoardChanges?.();
    this.unsubscribeDatabaseChanges?.();
    this.unsubscribeBoardChanges = null;
    this.unsubscribeDatabaseChanges = null;
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
