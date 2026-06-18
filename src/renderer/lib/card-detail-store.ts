import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invoke } from "./api";
import type { Card, CardSummary } from "./types";

interface CardDetailSnapshot {
  card: Card | null;
  loading: boolean;
  error: string | null;
}

interface CardDetailsSnapshot {
  cards: ReadonlyMap<string, Card>;
  loading: boolean;
  error: string | null;
}

type Listener = () => void;

const EMPTY_DETAIL: CardDetailSnapshot = {
  card: null,
  loading: false,
  error: null,
};

const listeners = new Set<Listener>();
const detailEntries = new Map<string, CardDetailSnapshot>();
const inFlightSingleRequests = new Map<string, Promise<Card | null>>();
const inFlightBatchRequests = new Map<string, Promise<Card[]>>();

let version = 0;

function detailKey(projectId: string, cardId: string): string {
  return `${projectId}:${cardId}`;
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unknown error";
}

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersionSnapshot(): number {
  return version;
}

function isStale(card: Card | null, revision: number | undefined): boolean {
  if (!card) return true;
  if (revision === undefined) return false;
  return card.revision !== revision;
}

function shouldAcceptCardDetail(existing: Card | null, incoming: Card): boolean {
  if (!existing) return true;
  if (typeof existing.revision !== "number" || typeof incoming.revision !== "number") {
    return existing !== incoming;
  }
  return incoming.revision > existing.revision;
}

function setCardDetailEntry(projectId: string, card: Card): boolean {
  const key = detailKey(projectId, card.id);
  const existing = detailEntries.get(key) ?? EMPTY_DETAIL;
  const nextCard = shouldAcceptCardDetail(existing.card, card) ? card : existing.card;
  const nextEntry: CardDetailSnapshot = {
    card: nextCard,
    loading: false,
    error: null,
  };

  if (
    existing.card === nextEntry.card
    && existing.loading === nextEntry.loading
    && existing.error === nextEntry.error
  ) {
    return false;
  }

  detailEntries.set(key, nextEntry);
  return true;
}

export function setCardDetail(projectId: string, card: Card): void {
  if (!setCardDetailEntry(projectId, card)) return;
  emit();
}

export function setCardDetails(projectId: string, cards: readonly Card[]): void {
  if (cards.length === 0) return;
  let changed = false;
  for (const card of cards) {
    changed = setCardDetailEntry(projectId, card) || changed;
  }
  if (changed) emit();
}

export function getCardDetail(projectId: string, cardId: string): Card | null {
  return detailEntries.get(detailKey(projectId, cardId))?.card ?? null;
}

export function resetCardDetailStoreForTests(): void {
  detailEntries.clear();
  inFlightSingleRequests.clear();
  inFlightBatchRequests.clear();
  emit();
}

export async function fetchCardDetail(
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
    emit();
  } else if (currentEntry.error) {
    detailEntries.set(key, {
      card: currentEntry.card,
      loading: false,
      error: null,
    });
    emit();
  }

  const request = (async () => {
    try {
      const card = (await invoke("card:get", projectId, cardId, status)) as Card | null;
      if (card) {
        setCardDetail(projectId, card);
      } else {
        detailEntries.set(key, {
          card: null,
          loading: false,
          error: "Card not found",
        });
        emit();
      }
      return card;
    } catch (error) {
      detailEntries.set(key, {
        card: detailEntries.get(key)?.card ?? null,
        loading: false,
        error: toErrorMessage(error),
      });
      emit();
      return null;
    } finally {
      inFlightSingleRequests.delete(key);
    }
  })();

  inFlightSingleRequests.set(key, request);
  return request;
}

export async function fetchCardDetails(projectId: string, cardIds: readonly string[]): Promise<Card[]> {
  const uniqueCardIds = Array.from(new Set(cardIds.filter(Boolean)));
  if (uniqueCardIds.length === 0) return [];

  const requestKey = `${projectId}:${uniqueCardIds.slice().sort().join(",")}`;
  const existing = inFlightBatchRequests.get(requestKey);
  if (existing) return existing;

  let loadingChanged = false;
  for (const cardId of uniqueCardIds) {
    const key = detailKey(projectId, cardId);
    const currentEntry = detailEntries.get(key);
    if (currentEntry?.card && !currentEntry.error) continue;
    detailEntries.set(key, {
      card: currentEntry?.card ?? null,
      loading: !currentEntry?.card,
      error: null,
    });
    loadingChanged = true;
  }
  if (loadingChanged) emit();

  const request = (async () => {
    try {
      const cards = (await invoke("cards:details:get", projectId, { cardIds: uniqueCardIds })) as Card[];
      setCardDetails(projectId, cards);

      const returnedCardIds = new Set(cards.map((card) => card.id));
      let changed = false;
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
        changed = true;
      }
      if (changed) emit();
      return cards;
    } catch (error) {
      const message = toErrorMessage(error);
      for (const cardId of uniqueCardIds) {
        const key = detailKey(projectId, cardId);
        detailEntries.set(key, {
          card: detailEntries.get(key)?.card ?? null,
          loading: false,
          error: message,
        });
      }
      emit();
      return [];
    } finally {
      inFlightBatchRequests.delete(requestKey);
    }
  })();

  inFlightBatchRequests.set(requestKey, request);
  return request;
}

export function useCardDetail(
  projectId: string,
  cardId: string | null | undefined,
  status?: Card["status"],
  revision?: number,
): CardDetailSnapshot {
  useSyncExternalStore(subscribe, getVersionSnapshot);
  const key = cardId ? detailKey(projectId, cardId) : null;
  const snapshot = key ? (detailEntries.get(key) ?? EMPTY_DETAIL) : EMPTY_DETAIL;

  useEffect(() => {
    if (!cardId) return;
    if (snapshot.loading) return;
    if (snapshot.error) return;
    if (!isStale(snapshot.card, revision)) return;
    void fetchCardDetail(projectId, cardId, status);
  }, [cardId, projectId, revision, snapshot.card, snapshot.error, snapshot.loading, status]);

  return snapshot;
}

export function useCardDetails(
  projectId: string,
  summaries: readonly Pick<CardSummary, "id" | "revision">[],
): CardDetailsSnapshot {
  useSyncExternalStore(subscribe, getVersionSnapshot);
  const requestKey = summaries.map((card) => `${card.id}:${card.revision ?? ""}`).join("|");

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
    void fetchCardDetails(projectId, missingIds);
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
