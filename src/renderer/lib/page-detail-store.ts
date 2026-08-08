import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { PageDetail } from "../../shared/page-detail";
import {
  readPageDetail,
} from "./api";
import { useProjectionInvalidationRegistry } from "./projection-invalidation-context";
import type { ProjectionInvalidationCause } from "./projection-invalidation-registry";
import {
  pageDetailDataDependencies,
  pageDetailDocumentDependencies,
} from "./page-detail-projection-dependencies";

export interface PageDetailSnapshot {
  readonly detail: PageDetail | null;
  readonly loading: boolean;
  readonly error: string | null;
}

type Listener = () => void;

const EMPTY_DETAIL: PageDetailSnapshot = {
  detail: null,
  loading: false,
  error: null,
};

const entries = new Map<string, PageDetailSnapshot>();
const listeners = new Map<string, Set<Listener>>();
const versions = new Map<string, number>();
interface InFlightPageDetail {
  readonly generation: number;
  readonly promise: Promise<PageDetail | null>;
  readonly token: object;
}
const inFlight = new Map<string, InFlightPageDetail>();
const entryGenerations = new Map<string, number>();
let storeGeneration = 0;

const detailKey = (projectId: string, pageId: string): string =>
  `${projectId}:${pageId}`;

const emit = (key: string): void => {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  for (const listener of listeners.get(key) ?? []) listener();
};

const advanceEntryGeneration = (key: string): number => {
  const generation = (entryGenerations.get(key) ?? 0) + 1;
  entryGenerations.set(key, generation);
  return generation;
};

const subscribe = (key: string | null, listener: Listener): (() => void) => {
  if (!key) return () => undefined;
  const keyListeners = listeners.get(key) ?? new Set<Listener>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size > 0) return;
    listeners.delete(key);
    advanceEntryGeneration(key);
    entries.delete(key);
  };
};

const compareDetailFreshness = (left: PageDetail, right: PageDetail): number => {
  if (left.storeEpoch !== right.storeEpoch) return 1;
  const coordinates = [
    [left.commitSeq, right.commitSeq],
    [left.page.documentGeneration, right.page.documentGeneration],
    [left.page.documentHeadSeq, right.page.documentHeadSeq],
    [left.page.parentRevision, right.page.parentRevision],
    [left.page.metadataRevision, right.page.metadataRevision],
    [
      left.dataSourceContext.kind === "member"
        ? left.dataSourceContext.membership.revision
        : 0,
      right.dataSourceContext.kind === "member"
        ? right.dataSourceContext.membership.revision
        : 0,
    ],
  ] as const;
  for (const [leftValue, rightValue] of coordinates) {
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
};

export const setPageDetail = (
  detail: PageDetail,
  options: { readonly acceptEqualFreshness?: boolean } = {},
): void => {
  const key = detailKey(detail.projectId, detail.page.pageId);
  const previous = entries.get(key) ?? EMPTY_DETAIL;
  if (previous.detail && compareDetailFreshness(detail, previous.detail) < 0) {
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

export const getPageDetail = (
  projectId: string,
  pageId: string,
): PageDetail | null => entries.get(detailKey(projectId, pageId))?.detail ?? null;

export const invalidatePageDetail = (
  projectId: string,
  pageId: string,
): void => {
  const key = detailKey(projectId, pageId);
  advanceEntryGeneration(key);
  if (!entries.has(key)) return;
  entries.delete(key);
  emit(key);
};

export const revokePageDetail = (
  projectId: string,
  pageId: string,
): void => {
  const key = detailKey(projectId, pageId);
  advanceEntryGeneration(key);
  entries.set(key, {
    detail: null,
    loading: false,
    error: "Page not found",
  });
  emit(key);
};

export const resetPageDetailStoreForTests = (): void => {
  storeGeneration += 1;
  const subscribedKeys = [...listeners.keys()];
  entries.clear();
  inFlight.clear();
  entryGenerations.clear();
  versions.clear();
  for (const key of subscribedKeys) emit(key);
};

export const fetchPageDetail = async (
  projectId: string,
  pageId: string,
  options: { readonly minimumCommitSeq?: number } = {},
): Promise<PageDetail | null> => {
  const key = detailKey(projectId, pageId);
  const minimumCommitSeq = options.minimumCommitSeq ?? 0;
  const generation = entryGenerations.get(key) ?? 0;
  const existingRequest = inFlight.get(key);
  if (existingRequest?.generation === generation) {
    const detail = await existingRequest.promise;
    if (!detail) return null;
    if (
      minimumCommitSeq <= 0
      || detail.commitSeq >= minimumCommitSeq
    ) {
      return detail;
    }
    return await fetchPageDetail(projectId, pageId, { minimumCommitSeq });
  }

  const current = entries.get(key) ?? EMPTY_DETAIL;
  entries.set(key, {
    detail: current.detail,
    loading: current.detail === null,
    error: null,
  });
  emit(key);

  const requestStoreGeneration = storeGeneration;
  const requestEntryGeneration = generation;
  const requestToken = {};
  const request = (async (): Promise<PageDetail | null> => {
    try {
      const result = await readPageDetail(projectId, pageId, minimumCommitSeq);
      if (
        requestStoreGeneration !== storeGeneration
        || requestEntryGeneration !== (entryGenerations.get(key) ?? 0)
      ) return null;
      if (!result.ok) {
        if (result.error.code !== "page_not_found") {
          throw new Error(result.error.message);
        }
        entries.set(key, {
          detail: null,
          loading: false,
          error:
            result.error.code === "page_not_found"
              ? "Page not found"
              : result.error.message,
        });
        emit(key);
        return null;
      }
      if (
        result.value.projectId !== projectId ||
        result.value.page.pageId !== pageId
      ) {
        throw new Error(
          "Page Detail response does not match the requested Project and Page",
        );
      }
      setPageDetail(result.value, { acceptEqualFreshness: true });
      return result.value;
    } catch (error) {
      if (
        requestStoreGeneration !== storeGeneration
        || requestEntryGeneration !== (entryGenerations.get(key) ?? 0)
      ) return null;
      entries.set(key, {
        detail: current.detail,
        loading: false,
        error: error instanceof Error ? error.message : "Page Detail is unavailable",
      });
      emit(key);
      throw error;
    } finally {
      if (inFlight.get(key)?.token === requestToken) {
        inFlight.delete(key);
      }
    }
  })();
  inFlight.set(key, {
    generation,
    promise: request,
    token: requestToken,
  });
  return request;
};

const requestPageDetailRefresh = (
  projectId: string,
  pageId: string,
  cause: ProjectionInvalidationCause,
): Promise<void> => {
  const key = detailKey(projectId, pageId);
  return (async () => {
    if (
      cause.kind === "revocation"
      && cause.delivery.revocation.resource_kind === "page"
    ) return;
    const current = inFlight.get(key);
    if (current) await current.promise;
    if (!listeners.has(key)) return;
    const detail = getPageDetail(projectId, pageId);
    if (
      cause.kind !== "reset" &&
      detail?.storeEpoch === cause.stream.storeEpoch &&
      detail.commitSeq >= cause.stream.commitSeq
    ) {
      return;
    }
    await fetchPageDetail(projectId, pageId, {
      minimumCommitSeq: cause.kind === "reset" ? 0 : cause.stream.commitSeq,
    });
  })();
};

export const usePageDetail = (
  libraryId: string | null,
  projectId: string | null,
  pageId: string | null,
): PageDetailSnapshot => {
  const registry = useProjectionInvalidationRegistry();
  const key = projectId && pageId ? detailKey(projectId, pageId) : null;
  const subscribeToDetail = useMemo(
    () => (listener: Listener) => subscribe(key, listener),
    [key],
  );
  useSyncExternalStore(
    subscribeToDetail,
    () => key ? (versions.get(key) ?? 0) : 0,
    () => 0,
  );

  useEffect(() => {
    if (!projectId || !pageId) return;
    void fetchPageDetail(projectId, pageId).catch(() => undefined);
  }, [pageId, projectId]);

  const snapshot = key ? (entries.get(key) ?? EMPTY_DETAIL) : EMPTY_DETAIL;
  useEffect(() => {
    if (!projectId || !pageId || !libraryId) return;
    return registry.register({
      scope: { kind: "project", libraryId, projectId },
      consumerKey: `page-detail:${projectId}:${pageId}`,
      getDependencies: () => {
        const detail = getPageDetail(projectId, pageId);
        return {
          ...pageDetailDataDependencies(detail, pageId),
          ...pageDetailDocumentDependencies(detail, pageId),
        };
      },
      getCursor: () => {
        const detail = getPageDetail(projectId, pageId);
        return detail
          ? {
              storeEpoch: detail.storeEpoch,
              commitSeq: detail.commitSeq,
            }
          : null;
      },
      revoke: (cause) => {
        if (cause.delivery.revocation.resource_kind === "page") {
          revokePageDetail(projectId, pageId);
          return;
        }
        invalidatePageDetail(projectId, pageId);
      },
      fence: () => invalidatePageDetail(projectId, pageId),
      invalidate: (cause) => requestPageDetailRefresh(projectId, pageId, cause),
    });
  }, [libraryId, pageId, projectId, registry]);

  return snapshot;
};
