import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  parseCardDetailCommandResult,
  type CardDetail,
} from "../../shared/card-detail";
import { invoke, subscribeBoardChanges, subscribeDatabaseChanges } from "./api";

export interface CardDetailSnapshot {
  readonly detail: CardDetail | null;
  readonly loading: boolean;
  readonly error: string | null;
}

type Listener = () => void;

const EMPTY_DETAIL: CardDetailSnapshot = {
  detail: null,
  loading: false,
  error: null,
};

const entries = new Map<string, CardDetailSnapshot>();
const listeners = new Map<string, Set<Listener>>();
const versions = new Map<string, number>();
const inFlight = new Map<string, Promise<CardDetail | null>>();

const detailKey = (projectId: string, cardBlockId: string): string =>
  `${projectId}:${cardBlockId}`;

const emit = (key: string): void => {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  for (const listener of listeners.get(key) ?? []) listener();
};

const subscribe = (key: string | null, listener: Listener): (() => void) => {
  if (!key) return () => undefined;
  const keyListeners = listeners.get(key) ?? new Set<Listener>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) listeners.delete(key);
  };
};

const compareDetailFreshness = (left: CardDetail, right: CardDetail): number => {
  const coordinates = [
    [left.properties.changeLogSeq, right.properties.changeLogSeq],
    [left.card.documentGeneration, right.card.documentGeneration],
    [left.card.documentHeadSeq, right.card.documentHeadSeq],
    [left.card.locationRevision, right.card.locationRevision],
    [left.card.metadataRevision, right.card.metadataRevision],
    [
      left.databaseContext.kind === "member"
        ? left.databaseContext.membership.revision
        : 0,
      right.databaseContext.kind === "member"
        ? right.databaseContext.membership.revision
        : 0,
    ],
  ] as const;
  for (const [leftValue, rightValue] of coordinates) {
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
};

export const setCardDetail = (
  detail: CardDetail,
  options: { readonly acceptEqualFreshness?: boolean } = {},
): void => {
  const key = detailKey(detail.card.projectId, detail.card.blockId);
  const previous = entries.get(key) ?? EMPTY_DETAIL;
  if (
    previous.detail &&
    compareDetailFreshness(detail, previous.detail) < 0
  ) {
    return;
  }
  if (
    previous.detail &&
    compareDetailFreshness(detail, previous.detail) === 0 &&
    !options.acceptEqualFreshness
  ) {
    return;
  }
  entries.set(key, { detail, loading: false, error: null });
  emit(key);
};

export const getCardDetail = (
  projectId: string,
  cardBlockId: string,
): CardDetail | null =>
  entries.get(detailKey(projectId, cardBlockId))?.detail ?? null;

export const invalidateCardDetail = (
  projectId: string,
  cardBlockId: string,
): void => {
  const key = detailKey(projectId, cardBlockId);
  const current = entries.get(key);
  if (!current) return;
  entries.delete(key);
  emit(key);
};

export const resetCardDetailStoreForTests = (): void => {
  const subscribedKeys = [...listeners.keys()];
  entries.clear();
  inFlight.clear();
  versions.clear();
  for (const key of subscribedKeys) emit(key);
};

export const fetchCardDetail = async (
  projectId: string,
  cardBlockId: string,
): Promise<CardDetail | null> => {
  const key = detailKey(projectId, cardBlockId);
  const existingRequest = inFlight.get(key);
  if (existingRequest) return existingRequest;

  const current = entries.get(key) ?? EMPTY_DETAIL;
  entries.set(key, {
    detail: current.detail,
    loading: current.detail === null,
    error: null,
  });
  emit(key);

  const request = (async (): Promise<CardDetail | null> => {
    try {
      const result = parseCardDetailCommandResult(
        await invoke("card:get", projectId, cardBlockId),
      );
      if (!result.ok) {
        entries.set(key, {
          detail: null,
          loading: false,
          error:
            result.error.code === "card_not_found"
              ? "Card not found"
              : result.error.message,
        });
        emit(key);
        return null;
      }
      if (
        result.value.card.projectId !== projectId ||
        result.value.card.blockId !== cardBlockId
      ) {
        throw new Error(
          "Card Detail response does not match the requested Project and Block",
        );
      }
      setCardDetail(result.value, { acceptEqualFreshness: true });
      return result.value;
    } catch (error) {
      entries.set(key, {
        detail: entries.get(key)?.detail ?? null,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
      emit(key);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
};

export const useCardDetail = (
  projectId: string,
  cardBlockId: string | null | undefined,
): CardDetailSnapshot => {
  const key = cardBlockId ? detailKey(projectId, cardBlockId) : null;
  const subscribeToKey = useMemo(
    () => (listener: Listener) => subscribe(key, listener),
    [key],
  );
  const readVersion = useMemo(
    () => () => (key ? versions.get(key) ?? 0 : 0),
    [key],
  );
  useSyncExternalStore(subscribeToKey, readVersion, readVersion);
  const snapshot = key ? entries.get(key) ?? EMPTY_DETAIL : EMPTY_DETAIL;

  useEffect(() => {
    if (!cardBlockId || snapshot.detail || snapshot.loading || snapshot.error) {
      return;
    }
    void fetchCardDetail(projectId, cardBlockId);
  }, [cardBlockId, projectId, snapshot.detail, snapshot.error, snapshot.loading]);

  useEffect(() => {
    if (!cardBlockId) return;

    const refresh = (): void => {
      void fetchCardDetail(projectId, cardBlockId);
    };
    const unsubscribeBoard = subscribeBoardChanges(projectId, (event) => {
      if (event.cardId !== cardBlockId) return;
      refresh();
    });
    const unsubscribeDatabase = subscribeDatabaseChanges(projectId, (event) => {
      const current = getCardDetail(projectId, cardBlockId);
      if (
        current &&
        event.changeLogSeq <= current.properties.changeLogSeq
      ) {
        return;
      }
      if (
        current?.databaseContext.kind === "member" &&
        event.affectedDatabaseBlockIds.length > 0 &&
        !event.affectedDatabaseBlockIds.includes(
          current.databaseContext.membership.databaseBlockId,
        )
      ) {
        return;
      }
      refresh();
    });

    return () => {
      unsubscribeBoard();
      unsubscribeDatabase();
    };
  }, [cardBlockId, projectId]);

  return snapshot;
};
