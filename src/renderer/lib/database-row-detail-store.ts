import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invoke } from "./api";
import type { Card, CardSummary } from "./types";

interface DatabaseRowDetailSnapshot {
  card: Card | null;
  loading: boolean;
  error: string | null;
}

interface DatabaseRowDetailsSnapshot {
  cards: ReadonlyMap<string, Card>;
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
const inFlightSingleRequests = new Map<string, Promise<Card | null>>();
const inFlightBatchRequests = new Map<string, Promise<Card[]>>();

function detailKey(projectId: string, cardId: string): string {
  return `${projectId}:${cardId}`;
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

function isStale(card: Card | null, revision: number | undefined): boolean {
  if (!card) return true;
  if (revision === undefined) return false;
  return card.revision !== revision;
}

function shouldAcceptDatabaseRowDetail(
  existing: Card | null,
  incoming: Card,
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
  card: Card,
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
  card: Card,
  options: SetDatabaseRowDetailOptions = {},
): void {
  const changedKey = setDatabaseRowDetailEntry(projectId, card, options);
  if (!changedKey) return;
  emitKeys([changedKey]);
}

export function setDatabaseRowDetails(projectId: string, cards: readonly Card[]): void {
  if (cards.length === 0) return;
  const changedKeys = new Set<string>();
  for (const card of cards) {
    const changedKey = setDatabaseRowDetailEntry(projectId, card);
    if (changedKey) changedKeys.add(changedKey);
  }
  if (changedKeys.size > 0) emitKeys(changedKeys);
}

export function getDatabaseRowDetail(projectId: string, cardId: string): Card | null {
  return detailEntries.get(detailKey(projectId, cardId))?.card ?? null;
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
  cardId: string,
  status?: Card["status"],
): Promise<Card | null> {
  const key = detailKey(projectId, cardId);
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
      const card = (await invoke("database-row:get", projectId, cardId, status)) as Card | null;
      if (card) {
        setDatabaseRowDetail(projectId, card);
      } else {
        detailEntries.set(key, {
          card: null,
          loading: false,
          error: "Card not found",
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

export async function fetchDatabaseRowDetails(projectId: string, cardIds: readonly string[]): Promise<Card[]> {
  const uniqueCardIds = Array.from(new Set(cardIds.filter(Boolean)));
  if (uniqueCardIds.length === 0) return [];

  const requestKey = `${projectId}:${uniqueCardIds.slice().sort().join(",")}`;
  const existing = inFlightBatchRequests.get(requestKey);
  if (existing) return existing;

  const loadingChangedKeys = new Set<string>();
  for (const cardId of uniqueCardIds) {
    const key = detailKey(projectId, cardId);
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
      const cards = (await invoke("database-rows:details:get", projectId, { cardIds: uniqueCardIds })) as Card[];
      const changedKeys = new Set<string>();
      for (const card of cards) {
        const changedKey = setDatabaseRowDetailEntry(projectId, card);
        if (changedKey) changedKeys.add(changedKey);
      }

      const returnedCardIds = new Set(cards.map((card) => card.id));
      for (const cardId of uniqueCardIds) {
        if (returnedCardIds.has(cardId)) continue;
        const key = detailKey(projectId, cardId);
        const existingEntry = detailEntries.get(key) ?? EMPTY_DETAIL;
        const nextEntry = {
          card: null,
          loading: false,
          error: "Card not found",
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
      for (const cardId of uniqueCardIds) {
        const key = detailKey(projectId, cardId);
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
  cardId: string | null | undefined,
  status?: Card["status"],
  revision?: number,
): DatabaseRowDetailSnapshot {
  const key = cardId ? detailKey(projectId, cardId) : null;
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
    if (!cardId) return;
    if (snapshot.loading) return;
    if (snapshot.error) return;
    if (!isStale(snapshot.card, revision)) return;
    void fetchDatabaseRowDetail(projectId, cardId, status);
  }, [cardId, projectId, revision, snapshot.card, snapshot.error, snapshot.loading, status]);

  return snapshot;
}

export function useDatabaseRowDetails(
  projectId: string,
  summaries: readonly Pick<CardSummary, "id" | "revision">[],
): DatabaseRowDetailsSnapshot {
  const requestKey = summaries.map((card) => `${card.id}:${card.revision ?? ""}`).join("|");
  const detailKeys = useMemo(
    () => summaries.map((summary) => detailKey(projectId, summary.id)),
    [projectId, requestKey],
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
    const cards = new Map<string, Card>();
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
