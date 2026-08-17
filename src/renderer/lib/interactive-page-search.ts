import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  PageSearchFilters,
  PageSearchMetadataDocument,
  PageSearchMetadataSnapshot,
  PageSearchResult,
} from "../../shared/types";
import { invoke, subscribeLibraryChanges } from "./api";

type WasmIndex = {
  free?(): void;
  replace(documents: unknown): void;
  applyDelta(upserts: unknown, removals: unknown): void;
  search(request: unknown): PageSearchResult[];
};

interface ProjectionState {
  readonly revision: number;
  readonly scopeKey: string;
  readonly status: "idle" | "loading" | "ready" | "unavailable";
  readonly libraryId: string | null;
  readonly storeEpoch: string | null;
  readonly commitSeq: number;
  readonly error: string | null;
}

export interface PageSearchIntent {
  readonly projectIds: readonly string[];
  readonly query: string;
  readonly filters?: PageSearchFilters;
  readonly preferredProjectId?: string | null;
  readonly recentPageIds?: readonly string[];
  readonly excludePageIds?: readonly string[];
  readonly dataSourceIds?: readonly string[];
  readonly limit?: number;
  readonly complete?: boolean;
}

export interface InteractivePageSearchResult {
  readonly rows: readonly PageSearchResult[];
  readonly enrichment: "idle" | "loading" | "settled" | "unavailable";
  readonly queryRevision: string;
}

const EMPTY_STATE: ProjectionState = {
  revision: 0,
  scopeKey: "",
  status: "idle",
  libraryId: null,
  storeEpoch: null,
  commitSeq: 0,
  error: null,
};

let state = EMPTY_STATE;
let index: WasmIndex | null = null;
let documents = new Map<string, PageSearchMetadataDocument>();
let configuredProjectIds: string[] = [];
let generation = 0;
let unsubscribeChanges: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit(next: Omit<ProjectionState, "revision">): void {
  state = { ...next, revision: state.revision + 1 };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ProjectionState {
  return state;
}

function scopeKey(projectIds: readonly string[]): string {
  return [...new Set(projectIds)].sort().join("\n");
}

function projectionIsValid(snapshot: PageSearchMetadataSnapshot, expectedScope: string): boolean {
  const authorizedProjects = new Set(snapshot.authorization.projectIds);
  const pageIds = new Set(snapshot.documents.map((document) => document.pageId));
  return snapshot.libraryId === snapshot.authorization.libraryId
    && snapshot.storeEpoch === snapshot.authorization.storeEpoch
    && snapshot.commitSeq === snapshot.authorization.coveredCommitSeq
    && scopeKey(snapshot.authorization.projectIds) === expectedScope
    && pageIds.size === snapshot.documents.length
    && snapshot.documents.every((document) =>
      document.authorizedProjectIds.length > 0
      && document.authorizedProjectIds.every((projectId) => authorizedProjects.has(projectId)));
}

async function loadWasm(): Promise<WasmIndex> {
  const wasm = await import("../generated/page-search-wasm/nodex_page_search_kernel.js");
  await wasm.default();
  return new wasm.PageSearchPreviewIndex([]) as WasmIndex;
}

async function refresh(pageIds?: readonly string[]): Promise<void> {
  const currentGeneration = generation;
  const expectedScope = scopeKey(configuredProjectIds);
  try {
    index ??= await loadWasm();
    const snapshot = await invoke(
      "pages:search-metadata",
      configuredProjectIds,
      pageIds ? [...pageIds] : undefined,
    );
    if (
      currentGeneration !== generation
      || !projectionIsValid(snapshot, expectedScope)
      || (state.storeEpoch === snapshot.storeEpoch && snapshot.commitSeq < state.commitSeq)
    ) return;
    if (pageIds) {
      const returned = new Set(snapshot.documents.map((document) => document.pageId));
      const removals = pageIds.filter((pageId) => !returned.has(pageId));
      for (const pageId of removals) documents.delete(pageId);
      for (const document of snapshot.documents) documents.set(document.pageId, document);
      index.applyDelta(snapshot.documents, removals);
    } else {
      documents = new Map(snapshot.documents.map((document) => [document.pageId, document]));
      index.replace(snapshot.documents);
    }
    emit({
      scopeKey: expectedScope,
      status: "ready",
      libraryId: snapshot.libraryId,
      storeEpoch: snapshot.storeEpoch,
      commitSeq: snapshot.commitSeq,
      error: null,
    });
  } catch (error) {
    if (currentGeneration !== generation) return;
    emit({
      ...state,
      scopeKey: expectedScope,
      status: index && documents.size > 0 ? "ready" : "unavailable",
      error: error instanceof Error ? error.message : "Page metadata is unavailable",
    });
  }
}

/** Prewarms the Core-stamped projection. No query is executed on this async path. */
export function configureInteractivePageSearch(
  projectIds: readonly string[],
  mode: "extend" | "replace" = "extend",
): void {
  const nextIds = [...new Set(
    mode === "replace" ? projectIds : [...configuredProjectIds, ...projectIds],
  )];
  const nextScope = scopeKey(nextIds);
  if (nextScope === state.scopeKey) return;
  configuredProjectIds = nextIds;
  generation += 1;
  documents.clear();
  index?.free?.();
  index = null;
  if (nextIds.length === 0) {
    unsubscribeChanges?.();
    unsubscribeChanges = null;
    emit({ scopeKey: "", status: "idle", libraryId: null, storeEpoch: null, commitSeq: 0, error: null });
    return;
  }
  emit({ scopeKey: nextScope, status: "loading", libraryId: null, storeEpoch: null, commitSeq: 0, error: null });
  void refresh();
  unsubscribeChanges ??= subscribeLibraryChanges((event) => {
    if (event.storeEpoch !== state.storeEpoch) {
      generation += 1;
      documents.clear();
      index?.free?.();
      index = null;
      emit({ ...state, status: "loading", libraryId: null, storeEpoch: null, commitSeq: 0, error: null });
      void refresh();
      return;
    }
    if (event.affectedPageIds.length > 0 && event.affectedDatabaseIds.length === 0) {
      void refresh(event.affectedPageIds);
      return;
    }
    void refresh();
  });
}

export function searchPageMetadataSync(intent: PageSearchIntent): readonly PageSearchResult[] {
  if (
    !index
    || state.status !== "ready"
    || intent.projectIds.some((projectId) => !configuredProjectIds.includes(projectId))
  ) return [];
  try {
    return index.search({
      projectIds: [...intent.projectIds],
      query: intent.query,
      filters: intent.filters,
      preferredProjectId: intent.preferredProjectId ?? undefined,
      recentPageIds: [...(intent.recentPageIds ?? [])],
      limit: intent.limit ?? 20,
      excludePageIds: [...(intent.excludePageIds ?? [])],
      dataSourceIds: [...(intent.dataSourceIds ?? [])],
    });
  } catch {
    return [];
  }
}

export function configuredPageSearchProjectIds(): readonly string[] {
  return configuredProjectIds;
}

function mergeResults(
  preview: readonly PageSearchResult[],
  complete: readonly PageSearchResult[],
  limit: number,
): readonly PageSearchResult[] {
  const completeById = new Map(complete.map((row) => [row.pageId, row]));
  const rows = preview.map((row) => completeById.get(row.pageId) ?? row);
  const seen = new Set(rows.map((row) => row.pageId));
  for (const row of complete) {
    if (!seen.has(row.pageId)) rows.push(row);
  }
  return rows.slice(0, limit);
}

export function useInteractivePageSearch(intent: PageSearchIntent): InteractivePageSearchResult {
  const projection = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const intendedScope = scopeKey(intent.projectIds);
  const normalizedProjectIds = useMemo(
    () => intendedScope ? intendedScope.split("\n") : [],
    [intendedScope],
  );
  useEffect(() => configureInteractivePageSearch(normalizedProjectIds), [normalizedProjectIds]);
  const preview = searchPageMetadataSync({ ...intent, projectIds: normalizedProjectIds });
  const revision = JSON.stringify({
    query: intent.query,
    scope: scopeKey(normalizedProjectIds),
    filters: intent.filters ?? null,
    preferredProjectId: intent.preferredProjectId ?? null,
    recentPageIds: intent.recentPageIds ?? [],
    excludePageIds: [...(intent.excludePageIds ?? [])].sort(),
    dataSourceIds: [...(intent.dataSourceIds ?? [])].sort(),
    limit: intent.limit ?? 20,
    complete: intent.complete !== false,
    projection: [projection.storeEpoch, projection.commitSeq],
  });
  const complete = useCompletePageSearch(intent.complete !== false, revision, {
    ...intent,
    projectIds: normalizedProjectIds,
  });
  const rows = mergeResults(preview, complete.rows, intent.limit ?? 20).filter(
    (row) => !intent.excludePageIds?.includes(row.pageId),
  );
  if (projection.status !== "ready" && complete.status !== "settled") {
    let enrichment: InteractivePageSearchResult["enrichment"] = "loading";
    if (
      complete.status === "unavailable"
      || (complete.status === "idle" && projection.status === "unavailable")
    ) {
      enrichment = "unavailable";
    } else if (complete.status === "idle" && projection.status === "idle") {
      enrichment = "idle";
    }
    return { rows, enrichment, queryRevision: revision };
  }
  return {
    rows,
    enrichment: complete.status,
    queryRevision: revision,
  };
}

function useCompletePageSearch(
  enabled: boolean,
  revision: string,
  intent: PageSearchIntent,
): { readonly rows: readonly PageSearchResult[]; readonly status: InteractivePageSearchResult["enrichment"] } {
  const store = completeStores.get(revision) ?? createCompleteStore(revision, enabled, intent);
  if (!completeStores.has(revision)) completeStores.set(revision, store);
  useEffect(() => {
    store.start();
    return () => store.release();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

interface CompleteSnapshot { readonly rows: readonly PageSearchResult[]; readonly status: InteractivePageSearchResult["enrichment"] }
interface CompleteStore { subscribe(listener: () => void): () => void; getSnapshot(): CompleteSnapshot; start(): void; release(): void }
const completeStores = new Map<string, CompleteStore>();

function createCompleteStore(revision: string, enabled: boolean, intent: PageSearchIntent): CompleteStore {
  let snapshot: CompleteSnapshot = { rows: [], status: enabled ? "loading" : "idle" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let users = 0;
  const subscribers = new Set<() => void>();
  return {
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    getSnapshot: () => snapshot,
    start() {
      users += 1;
      if (!enabled || timer || snapshot.status !== "loading") return;
      timer = setTimeout(() => {
        timer = null;
        void invoke("pages:search", {
          projectIds: [...intent.projectIds], query: intent.query,
          filters: intent.filters, preferredProjectId: intent.preferredProjectId ?? undefined,
          recentPageIds: [...(intent.recentPageIds ?? [])], limit: intent.limit,
        }).then((result) => {
          if (
            (state.libraryId !== null && result.libraryId !== state.libraryId)
            || (state.storeEpoch !== null && result.storeEpoch !== state.storeEpoch)
            || result.commitSeq < state.commitSeq
          ) return;
          snapshot = { rows: result.results, status: "settled" };
          subscribers.forEach((listener) => listener());
        }).catch(() => {
          snapshot = { rows: [], status: "unavailable" };
          subscribers.forEach((listener) => listener());
        });
      }, 175);
    },
    release() {
      users -= 1;
      if (users > 0) return;
      if (timer) clearTimeout(timer);
      completeStores.delete(revision);
    },
  };
}

export const __testing = {
  installIndex(projectIds: readonly string[], testIndex: WasmIndex): void {
    configuredProjectIds = [...projectIds];
    index = testIndex;
    state = {
      revision: state.revision + 1,
      scopeKey: scopeKey(projectIds),
      status: "ready",
      libraryId: "library-1",
      storeEpoch: "test-epoch",
      commitSeq: 1,
      error: null,
    };
  },
  installUnavailable(projectIds: readonly string[]): void {
    configuredProjectIds = [...projectIds];
    index?.free?.();
    index = null;
    state = {
      revision: state.revision + 1,
      scopeKey: scopeKey(projectIds),
      status: "unavailable",
      libraryId: null,
      storeEpoch: null,
      commitSeq: 0,
      error: "Page metadata is unavailable",
    };
  },
  reset() {
    generation += 1;
    unsubscribeChanges?.(); unsubscribeChanges = null;
    state = EMPTY_STATE; index?.free?.(); index = null; documents.clear(); configuredProjectIds = [];
    completeStores.clear(); listeners.clear();
  },
};
