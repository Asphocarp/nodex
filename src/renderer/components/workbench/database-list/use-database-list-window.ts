import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  CoreApiError,
  readDatabaseListWindow,
  readLibraryDatabaseListWindow,
} from "@/lib/api";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import type {
  DatabaseViewPresentationOverride,
  EffectiveDatabaseViewPresentation,
} from "../../../../shared/database-kernel";
import type {
  DatabaseListProjectionRowSnapshot,
  DatabaseListWindowInput,
  DatabaseListWindowSnapshot,
} from "../../../../shared/database-views";

const DATABASE_LIST_WINDOW_SIZE = 200;
const MAX_RETAINED_LIST_WINDOW_STORES = 64;

type AnyDatabaseListWindowSnapshot = DatabaseListWindowSnapshot<string | null>;

export interface DatabaseListWindowState {
  readonly active: boolean;
  readonly rows: readonly DatabaseListProjectionRowSnapshot[];
  readonly groups: AnyDatabaseListWindowSnapshot["groups"];
  readonly totalProjectionRowCount: number;
  readonly totalOccurrenceCount: number;
  readonly totalModelCount: number;
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
  /** True for both the first read and a stale-while-revalidate replacement. */
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
}

const EMPTY_WINDOW_STATE: DatabaseListWindowState = Object.freeze({
  active: false,
  rows: [],
  groups: [],
  totalProjectionRowCount: 0,
  totalOccurrenceCount: 0,
  totalModelCount: 0,
  nextCursor: null,
  isComplete: false,
  loading: false,
  loadingMore: false,
  error: null,
});

/**
 * List owns one List projection even while Board is selected. The layout in
 * this request must therefore never inherit the currently visible layout.
 */
const fullListPresentationOverride = (
  effective: EffectiveDatabaseViewPresentation,
): DatabaseViewPresentationOverride => ({
  layout: "list",
  sort: effective.presentation.sort,
  group: effective.presentation.group,
  subgroup: effective.presentation.subgroup,
  groupDirection: effective.presentation.groupDirection,
  completion: { ...effective.presentation.completion },
  hierarchy: { ...effective.presentation.hierarchy },
  layouts: {
    board: {
      fields: effective.presentation.layouts.board.fields,
      showEmptyGroups: effective.presentation.layouts.board.showEmptyGroups,
    },
    list: {
      fields: effective.presentation.layouts.list.fields,
      showEmptyGroups: effective.presentation.layouts.list.showEmptyGroups,
    },
  },
});

const projectionIdentity = (snapshot: AnyDatabaseListWindowSnapshot): string =>
  JSON.stringify({
    storeEpoch: snapshot.storeEpoch,
    commitSeq: snapshot.commitSeq,
    projection: snapshot.projection,
    viewId: snapshot.viewId,
    dataSourceId: snapshot.dataSourceId,
  });

const stateFromFirstWindow = (
  snapshot: AnyDatabaseListWindowSnapshot,
): DatabaseListWindowState => ({
  active: true,
  rows: snapshot.rows,
  groups: snapshot.groups,
  totalProjectionRowCount: snapshot.totalProjectionRowCount,
  totalOccurrenceCount: snapshot.totalOccurrenceCount,
  totalModelCount: snapshot.totalModelCount,
  nextCursor: snapshot.nextCursor,
  isComplete: snapshot.isComplete,
  loading: false,
  loadingMore: false,
  error: null,
});

export type DatabaseListWindowMergeResult =
  | { readonly kind: "merged"; readonly state: DatabaseListWindowState }
  | { readonly kind: "restart" };

export const mergeDatabaseListWindow = (
  current: DatabaseListWindowState,
  currentSnapshot: AnyDatabaseListWindowSnapshot,
  next: AnyDatabaseListWindowSnapshot,
): DatabaseListWindowMergeResult => {
  if (
    projectionIdentity(currentSnapshot) !== projectionIdentity(next)
    || next.windowStart !== current.rows.length
  ) {
    return { kind: "restart" };
  }
  const occurrenceKeys = new Set(current.rows.map((row) => row.occurrenceKey));
  if (next.rows.some((row) => occurrenceKeys.has(row.occurrenceKey))) {
    return { kind: "restart" };
  }
  return {
    kind: "merged",
    state: {
      active: true,
      rows: [...current.rows, ...next.rows],
      groups: next.groups,
      totalProjectionRowCount: next.totalProjectionRowCount,
      totalOccurrenceCount: next.totalOccurrenceCount,
      totalModelCount: next.totalModelCount,
      nextCursor: next.nextCursor,
      isComplete: next.isComplete,
      loading: false,
      loadingMore: false,
      error: null,
    },
  };
};

interface DatabaseListWindowRequest {
  readonly accessContext: DatabaseViewRenderModel["accessContext"];
  readonly input: DatabaseListWindowInput & { readonly databaseViewId: string };
}

interface DatabaseListResourceIdentity {
  readonly libraryId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly viewId: string;
  readonly storeEpoch: string;
}

interface DatabaseListWindowDescriptor {
  readonly identity: string;
  readonly presentationIdentity: string;
  readonly commitSeq: number;
  readonly request: DatabaseListWindowRequest;
  readonly resource: DatabaseListResourceIdentity;
}

const descriptorFor = (
  model: DatabaseViewRenderModel,
  effective: EffectiveDatabaseViewPresentation,
): DatabaseListWindowDescriptor => {
  const request = {
    accessContext: model.accessContext,
    input: {
      databaseViewId: model.databaseViewId,
      first: DATABASE_LIST_WINDOW_SIZE,
      presentationOverride: fullListPresentationOverride(effective),
      minimumCommitCursor: {
        storeEpoch: model.storeEpoch,
        commitSeq: model.commitSeq,
      },
    },
  } satisfies DatabaseListWindowRequest;
  const presentationIdentity = JSON.stringify({
    accessContext: request.accessContext,
    databaseViewId: request.input.databaseViewId,
    presentationOverride: request.input.presentationOverride,
  });
  return {
    identity: JSON.stringify(request),
    presentationIdentity,
    commitSeq: model.commitSeq,
    request,
    resource: {
      libraryId: model.libraryId,
      databaseId: model.databaseId,
      dataSourceId: model.dataSourceId,
      viewId: model.databaseViewId,
      storeEpoch: model.storeEpoch,
    },
  };
};

const readWindow = async (
  request: DatabaseListWindowRequest,
): Promise<AnyDatabaseListWindowSnapshot> => {
  if (request.accessContext.kind === "project") {
    return await readDatabaseListWindow(
      request.accessContext.projectId,
      request.input,
    );
  }
  return await readLibraryDatabaseListWindow(request.input);
};

const assertWindowIdentity = (
  expected: DatabaseListResourceIdentity,
  snapshot: AnyDatabaseListWindowSnapshot,
): void => {
  if (
    snapshot.libraryId !== expected.libraryId
    || snapshot.databaseId !== expected.databaseId
    || snapshot.dataSourceId !== expected.dataSourceId
    || snapshot.viewId !== expected.viewId
    || snapshot.storeEpoch !== expected.storeEpoch
  ) {
    throw new Error("Database List window returned mismatched resource identity");
  }
};

type ListWindowListener = () => void;

export interface DatabaseListWindowStoreDependencies {
  readonly readWindow: (
    request: DatabaseListWindowRequest,
  ) => Promise<AnyDatabaseListWindowSnapshot>;
}

export class DatabaseListWindowStore {
  private readonly listeners = new Set<ListWindowListener>();

  private state = EMPTY_WINDOW_STATE;

  private descriptor: DatabaseListWindowDescriptor | null = null;

  private acceptedRequestIdentity: string | null = null;

  private firstSnapshot: AnyDatabaseListWindowSnapshot | null = null;

  private generation = 0;

  private inFlightContinuation = false;

  constructor(
    private readonly dependencies: DatabaseListWindowStoreDependencies,
    private readonly onAccess: () => void,
    private readonly onInactive: () => void,
  ) {}

  getSnapshot = (): DatabaseListWindowState => this.state;

  subscribe = (listener: ListWindowListener): (() => void) => {
    this.onAccess();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.onInactive();
    };
  };

  isActive(): boolean {
    return this.listeners.size > 0;
  }

  dispose(): void {
    this.generation += 1;
    this.listeners.clear();
  }

  setRequest(
    model: DatabaseViewRenderModel,
    effective: EffectiveDatabaseViewPresentation,
  ): void {
    if (model.authorization === null) {
      this.clearUnavailableAuthority();
      return;
    }
    const descriptor = descriptorFor(model, effective);
    if (descriptor.identity === this.descriptor?.identity) return;
    if (
      this.descriptor
      && descriptor.resource.storeEpoch === this.descriptor.resource.storeEpoch
      && descriptor.presentationIdentity === this.descriptor.presentationIdentity
      && descriptor.commitSeq < this.descriptor.commitSeq
    ) {
      return;
    }
    const storeEpochChanged = this.descriptor !== null
      && descriptor.resource.storeEpoch !== this.descriptor.resource.storeEpoch;
    this.descriptor = descriptor;
    if (storeEpochChanged) {
      this.acceptedRequestIdentity = null;
      this.firstSnapshot = null;
    }
    this.requestFirstWindow(!storeEpochChanged && this.state.active);
  }

  loadMore = (): void => {
    const current = this.state;
    const descriptor = this.descriptor;
    const firstSnapshot = this.firstSnapshot;
    if (
      !descriptor
      || this.acceptedRequestIdentity !== descriptor.identity
      || !current.active
      || current.isComplete
      || !current.nextCursor
      || !firstSnapshot
      || this.inFlightContinuation
    ) {
      return;
    }

    const generation = this.generation;
    const after = current.nextCursor;
    this.inFlightContinuation = true;
    this.publish({ ...current, loadingMore: true, error: null });
    void (async () => {
      try {
        const nextWindow = await this.dependencies.readWindow({
          ...descriptor.request,
          input: {
            ...descriptor.request.input,
            after,
          },
        });
        if (generation !== this.generation) return;
        assertWindowIdentity(descriptor.resource, nextWindow);
        const merged = mergeDatabaseListWindow(
          this.state,
          firstSnapshot,
          nextWindow,
        );
        if (merged.kind === "restart") {
          this.requestFirstWindow(true);
          return;
        }
        this.publish(merged.state);
      } catch (cause) {
        if (generation !== this.generation) return;
        if (
          cause instanceof CoreApiError
          && cause.isCursorRejection({ requestHadCursor: true })
        ) {
          this.requestFirstWindow(true);
          return;
        }
        this.publish({
          ...this.state,
          loadingMore: false,
          error: "Couldn’t load the next List window.",
        });
      } finally {
        if (generation === this.generation) this.inFlightContinuation = false;
      }
    })();
  };

  retry = (): void => {
    const descriptor = this.descriptor;
    if (!descriptor) return;
    if (
      this.acceptedRequestIdentity === descriptor.identity
      && this.state.active
      && this.state.nextCursor
    ) {
      this.loadMore();
      return;
    }
    this.requestFirstWindow(this.state.active);
  };

  private clearUnavailableAuthority(): void {
    if (this.descriptor === null && this.state === EMPTY_WINDOW_STATE) return;
    this.generation += 1;
    this.descriptor = null;
    this.acceptedRequestIdentity = null;
    this.firstSnapshot = null;
    this.inFlightContinuation = false;
    this.publish(EMPTY_WINDOW_STATE);
  }

  private requestFirstWindow(preserveRows: boolean): void {
    const descriptor = this.descriptor;
    if (!descriptor) return;
    const generation = this.generation + 1;
    this.generation = generation;
    this.inFlightContinuation = false;
    this.publish(preserveRows && this.state.active
      ? { ...this.state, loading: true, loadingMore: false, error: null }
      : { ...EMPTY_WINDOW_STATE, loading: true });

    void (async () => {
      try {
        const snapshot = await this.dependencies.readWindow(descriptor.request);
        if (generation !== this.generation) return;
        assertWindowIdentity(descriptor.resource, snapshot);
        if (snapshot.windowStart !== 0) {
          throw new Error("Database List first window did not start at zero");
        }
        this.firstSnapshot = snapshot;
        this.acceptedRequestIdentity = descriptor.identity;
        this.publish(stateFromFirstWindow(snapshot));
      } catch {
        if (generation !== this.generation) return;
        this.publish({
          ...(preserveRows && this.state.active
            ? this.state
            : EMPTY_WINDOW_STATE),
          loading: false,
          loadingMore: false,
          error: "Couldn’t load the authoritative List window.",
        });
      }
    })();
  }

  private publish(state: DatabaseListWindowState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

const storeIdentityFor = (model: DatabaseViewRenderModel): string =>
  JSON.stringify([
    model.accessContext,
    model.libraryId,
    model.databaseId,
    model.dataSourceId,
    model.databaseViewId,
  ]);

export class DatabaseListWindowStoreRegistry {
  private readonly stores = new Map<string, {
    readonly store: DatabaseListWindowStore;
    lastAccess: number;
  }>();

  private accessSequence = 0;

  constructor(private readonly dependencies: DatabaseListWindowStoreDependencies) {}

  getStore(model: DatabaseViewRenderModel): DatabaseListWindowStore {
    const key = storeIdentityFor(model);
    const existing = this.stores.get(key);
    if (existing) {
      this.touch(existing);
      return existing.store;
    }
    const store = new DatabaseListWindowStore(
      this.dependencies,
      () => {
        const entry = this.stores.get(key);
        if (entry) this.touch(entry);
      },
      () => this.pruneInactiveStores(),
    );
    const entry = { store, lastAccess: 0 };
    this.touch(entry);
    this.stores.set(key, entry);
    this.pruneInactiveStores();
    return store;
  }

  reset(): void {
    for (const { store } of this.stores.values()) store.dispose();
    this.stores.clear();
  }

  private touch(entry: { lastAccess: number }): void {
    this.accessSequence += 1;
    entry.lastAccess = this.accessSequence;
  }

  private pruneInactiveStores(): void {
    if (this.stores.size <= MAX_RETAINED_LIST_WINDOW_STORES) return;
    const candidates = [...this.stores.entries()]
      .filter(([, entry]) => !entry.store.isActive())
      .sort(([, left], [, right]) => left.lastAccess - right.lastAccess);
    for (const [key, entry] of candidates) {
      if (this.stores.size <= MAX_RETAINED_LIST_WINDOW_STORES) return;
      entry.store.dispose();
      this.stores.delete(key);
    }
  }
}

export const createDatabaseListWindowStoreRegistry = (
  dependencies: Partial<DatabaseListWindowStoreDependencies> = {},
): DatabaseListWindowStoreRegistry => new DatabaseListWindowStoreRegistry({
  readWindow,
  ...dependencies,
});

const sharedListWindowRegistry = createDatabaseListWindowStoreRegistry();

export const preloadDatabaseListWindow = (
  model: DatabaseViewRenderModel,
  effective: EffectiveDatabaseViewPresentation,
): void => {
  sharedListWindowRegistry.getStore(model).setRequest(model, effective);
};

export interface UseDatabaseListWindowResult extends DatabaseListWindowState {
  readonly loadMore: () => void;
  readonly retry: () => void;
}

export const useDatabaseListWindow = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly effective: EffectiveDatabaseViewPresentation;
}): UseDatabaseListWindowResult => {
  const { model, effective } = input;
  const storeIdentity = storeIdentityFor(model);
  const store = useMemo(
    () => sharedListWindowRegistry.getStore(model),
    // The identity captures the stable resource coordinate; commit and
    // presentation changes update the same store through setRequest below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeIdentity],
  );
  useEffect(() => {
    store.setRequest(model, effective);
  }, [effective, model, store]);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return {
    ...state,
    loadMore: store.loadMore,
    retry: store.retry,
  };
};

export const resetDatabaseListWindowStoresForTests = (): void => {
  sharedListWindowRegistry.reset();
};
