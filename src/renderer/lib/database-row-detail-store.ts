import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invoke } from "./api";
import type { DatabasePage, DatabasePageSummary } from "./types";

interface DatabaseRowDetailSnapshot {
  card: DatabasePage | null;
  loading: boolean;
  error: string | null;
}

interface DatabaseRowDetailsSnapshot {
  cards: ReadonlyMap<string, DatabasePage>;
  loading: boolean;
  error: string | null;
}

type Listener = () => void;

interface SetDatabaseRowDetailOptions {
  acceptEqualRevision?: boolean;
}

const EMPTY_DETAIL: DatabaseRowDetailSnapshot = {
  card: null,
  loading: false,
  error: null,
};

const listenersByKey = new Map<string, Set<Listener>>();
const keyVersions = new Map<string, number>();
const detailEntries = new Map<string, DatabaseRowDetailSnapshot>();
const inFlightSingleRequests = new Map<string, Promise<DatabasePage | null>>();
const inFlightBatchRequests = new Map<string, Promise<DatabasePage[]>>();

function detailKey(projectId: string, pageId: string): string {
  return `${projectId}:${pageId}`;
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unknown error";
}

function bumpKeyVersion(key: string): void {
  keyVersions.set(key, (keyVersions.get(key) ?? 0) + 1);
}

function emitKeys(keys: Iterable<string>): void {
  const listeners = new Set<Listener>();
  for (const key of keys) {
    bumpKeyVersion(key);
    for (const listener of listenersByKey.get(key) ?? []) {
      listeners.add(listener);
    }
  }

  for (const listener of listeners) {
    listener();
  }
}

function subscribeKey(key: string, listener: Listener): () => void {
  const listeners = listenersByKey.get(key) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByKey.set(key, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByKey.delete(key);
    }
  };
}

function subscribeKeys(keys: readonly string[], listener: Listener): () => void {
  if (keys.length === 0) return () => undefined;

  const uniqueKeys = [...new Set(keys)];
  const unsubscribes = uniqueKeys.map((key) => subscribeKey(key, listener));
  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
}

function getKeyVersionSnapshot(key: string | null): number {
  if (!key) return 0;
  return keyVersions.get(key) ?? 0;
}

function getKeysVersionSnapshot(keys: readonly string[]): string {
  return keys.map((key) => `${key}:${keyVersions.get(key) ?? 0}`).join("|");
}

function isStale(card: DatabasePage | null, revision: number | undefined): boolean {
  if (!card) return true;
  if (revision === undefined) return false;
  return card.revision !== revision;
}

function shouldAcceptDatabaseRowDetail(
  existing: DatabasePage | null,
  incoming: DatabasePage,
  options: SetDatabaseRowDetailOptions = {},
): boolean {
  if (!existing) return true;
  if (typeof existing.revision !== "number" || typeof incoming.revision !== "number") {
    return existing !== incoming;
  }
  if (options.acceptEqualRevision && incoming.revision === existing.revision) {
    return existing !== incoming;
  }
  return incoming.revision > existing.revision;
}

function setDatabaseRowDetailEntry(
  projectId: string,
  card: DatabasePage,
  options: SetDatabaseRowDetailOptions = {},
): string | null {
  const key = detailKey(projectId, card.id);
  const existing = detailEntries.get(key) ?? EMPTY_DETAIL;
  const nextCard = shouldAcceptDatabaseRowDetail(existing.card, card, options) ? card : existing.card;
  const nextEntry: DatabaseRowDetailSnapshot = {
    card: nextCard,
    loading: false,
    error: null,
  };

  if (
    existing.card === nextEntry.card
    && existing.loading === nextEntry.loading
    && existing.error === nextEntry.error
  ) {
    return null;
  }

  detailEntries.set(key, nextEntry);
  return key;
}

export function setDatabaseRowDetail(
  projectId: string,
  card: DatabasePage,
  options: SetDatabaseRowDetailOptions = {},
): void {
  const changedKey = setDatabaseRowDetailEntry(projectId, card, options);
  if (!changedKey) return;
  emitKeys([changedKey]);
}

export function setDatabaseRowDetails(projectId: string, cards: readonly DatabasePage[]): void {
  if (cards.length === 0) return;
  const changedKeys = new Set<string>();
  for (const card of cards) {
    const changedKey = setDatabaseRowDetailEntry(projectId, card);
    if (changedKey) changedKeys.add(changedKey);
  }
  if (changedKeys.size > 0) emitKeys(changedKeys);
}

export function getDatabaseRowDetail(projectId: string, pageId: string): DatabasePage | null {
  return detailEntries.get(detailKey(projectId, pageId))?.card ?? null;
}

export function resetDatabaseRowDetailStoreForTests(): void {
  const subscribedKeys = [...listenersByKey.keys()];
  detailEntries.clear();
  inFlightSingleRequests.clear();
  inFlightBatchRequests.clear();
  keyVersions.clear();
  emitKeys(subscribedKeys);
}

export async function fetchDatabaseRowDetail(
  projectId: string,
  pageId: string,
  status?: DatabasePage["status"],
): Promise<DatabasePage | null> {
  const key = detailKey(projectId, pageId);
  const existing = inFlightSingleRequests.get(key);
  if (existing) return existing;

  const currentEntry = detailEntries.get(key);
  if (!currentEntry?.card) {
    detailEntries.set(key, {
      card: null,
      loading: true,
      error: null,
    });
    emitKeys([key]);
  } else if (currentEntry.error) {
    detailEntries.set(key, {
      card: currentEntry.card,
      loading: false,
      error: null,
    });
    emitKeys([key]);
  }

  const request = (async () => {
    try {
      const card = (await invoke("database-row:get", projectId, pageId, status)) as DatabasePage | null;
      if (card) {
        setDatabaseRowDetail(projectId, card);
      } else {
        detailEntries.set(key, {
          card: null,
          loading: false,
          error: "Page not found",
        });
        emitKeys([key]);
      }
      return card;
    } catch (error) {
      detailEntries.set(key, {
        card: detailEntries.get(key)?.card ?? null,
        loading: false,
        error: toErrorMessage(error),
      });
      emitKeys([key]);
      return null;
    } finally {
      inFlightSingleRequests.delete(key);
    }
  })();

  inFlightSingleRequests.set(key, request);
  return request;
}

export async function fetchDatabaseRowDetails(projectId: string, pageIds: readonly string[]): Promise<DatabasePage[]> {
  const uniquePageIds = Array.from(new Set(pageIds.filter(Boolean)));
  if (uniquePageIds.length === 0) return [];

  const requestKey = `${projectId}:${uniquePageIds.slice().sort().join(",")}`;
  const existing = inFlightBatchRequests.get(requestKey);
  if (existing) return existing;

  const loadingChangedKeys = new Set<string>();
  for (const pageId of uniquePageIds) {
    const key = detailKey(projectId, pageId);
    const currentEntry = detailEntries.get(key);
    if (currentEntry?.card && !currentEntry.error) continue;
    detailEntries.set(key, {
      card: currentEntry?.card ?? null,
      loading: !currentEntry?.card,
      error: null,
    });
    loadingChangedKeys.add(key);
  }
  if (loadingChangedKeys.size > 0) emitKeys(loadingChangedKeys);

  const request = (async () => {
    try {
      const cards = (await invoke("database-rows:details:get", projectId, { pageIds: uniquePageIds })) as DatabasePage[];
      const changedKeys = new Set<string>();
      for (const card of cards) {
        const changedKey = setDatabaseRowDetailEntry(projectId, card);
        if (changedKey) changedKeys.add(changedKey);
      }

      const returnedPageIds = new Set(cards.map((card) => card.id));
      for (const pageId of uniquePageIds) {
        if (returnedPageIds.has(pageId)) continue;
        const key = detailKey(projectId, pageId);
        const existingEntry = detailEntries.get(key) ?? EMPTY_DETAIL;
        const nextEntry = {
          card: null,
          loading: false,
          error: "Page not found",
        };
        if (
          existingEntry.card === nextEntry.card
          && existingEntry.loading === nextEntry.loading
          && existingEntry.error === nextEntry.error
        ) {
          continue;
        }
        detailEntries.set(key, nextEntry);
        changedKeys.add(key);
      }
      if (changedKeys.size > 0) emitKeys(changedKeys);
      return cards;
    } catch (error) {
      const message = toErrorMessage(error);
      const changedKeys = new Set<string>();
      for (const pageId of uniquePageIds) {
        const key = detailKey(projectId, pageId);
        detailEntries.set(key, {
          card: detailEntries.get(key)?.card ?? null,
          loading: false,
          error: message,
        });
        changedKeys.add(key);
      }
      emitKeys(changedKeys);
      return [];
    } finally {
      inFlightBatchRequests.delete(requestKey);
    }
  })();

  inFlightBatchRequests.set(requestKey, request);
  return request;
}

export function useDatabaseRowDetail(
  projectId: string,
  pageId: string | null | undefined,
  status?: DatabasePage["status"],
  revision?: number,
): DatabaseRowDetailSnapshot {
  const key = pageId ? detailKey(projectId, pageId) : null;
  const subscribe = useMemo(
    () => (listener: Listener) => (key ? subscribeKey(key, listener) : () => undefined),
    [key],
  );
  const getSnapshot = useMemo(
    () => () => getKeyVersionSnapshot(key),
    [key],
  );
  useSyncExternalStore(subscribe, getSnapshot);
  const snapshot = key ? (detailEntries.get(key) ?? EMPTY_DETAIL) : EMPTY_DETAIL;

  useEffect(() => {
    if (!pageId) return;
    if (snapshot.loading) return;
    if (snapshot.error) return;
    if (!isStale(snapshot.card, revision)) return;
    void fetchDatabaseRowDetail(projectId, pageId, status);
  }, [pageId, projectId, revision, snapshot.card, snapshot.error, snapshot.loading, status]);

  return snapshot;
}

export function useDatabaseRowDetails(
  projectId: string,
  summaries: readonly Pick<DatabasePageSummary, "id" | "revision">[],
): DatabaseRowDetailsSnapshot {
  const requestKey = summaries.map((card) => `${card.id}:${card.revision ?? ""}`).join("|");
  const detailKeys = useMemo(
    () => {
      void requestKey;
      return summaries.map((summary) => detailKey(projectId, summary.id));
    },
    [projectId, requestKey, summaries],
  );
  const subscribe = useMemo(
    () => (listener: Listener) => subscribeKeys(detailKeys, listener),
    [detailKeys],
  );
  const getSnapshot = useMemo(
    () => () => getKeysVersionSnapshot(detailKeys),
    [detailKeys],
  );
  useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    const missingIds = summaries
      .filter((summary) => {
        const entry = detailEntries.get(detailKey(projectId, summary.id));
        if (entry?.loading) return false;
        if (entry?.error) return false;
        return isStale(entry?.card ?? null, summary.revision);
      })
      .map((summary) => summary.id);

    if (missingIds.length === 0) return;
    void fetchDatabaseRowDetails(projectId, missingIds);
  }, [projectId, requestKey, summaries]);

  return useMemo(() => {
    void requestKey;
    const cards = new Map<string, DatabasePage>();
    let loading = false;
    let error: string | null = null;
    for (const summary of summaries) {
      const entry = detailEntries.get(detailKey(projectId, summary.id));
      if (entry?.card) cards.set(summary.id, entry.card);
      if (entry?.loading) loading = true;
      if (!error && entry?.error) error = entry.error;
    }
    return { cards, loading, error };
  }, [projectId, requestKey, summaries]);
}
