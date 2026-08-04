import { useEffect, useSyncExternalStore } from "react";

import type { PageDetail } from "../../shared/page-detail";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import {
  readPageDetail,
} from "./api";
import { useProjectionInvalidationRegistry } from "./projection-invalidation-context";
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
const inFlight = new Map<string, Promise<PageDetail | null>>();
let storeGeneration = 0;

const detailKey = (projectId: string, pageId: string): string =>
  `${projectId}:${pageId}`;

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

const compareDetailFreshness = (left: PageDetail, right: PageDetail): number => {
  if (left.storeEpoch !== right.storeEpoch) return 1;
  const coordinates = [
    [left.changeLogSeq, right.changeLogSeq],
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
  if (!entries.has(key)) return;
  entries.delete(key);
  emit(key);
};

export const resetPageDetailStoreForTests = (): void => {
  storeGeneration += 1;
  const subscribedKeys = [...listeners.keys()];
  entries.clear();
  inFlight.clear();
  versions.clear();
  for (const key of subscribedKeys) emit(key);
};

export const fetchPageDetail = async (
  projectId: string,
  pageId: string,
): Promise<PageDetail | null> => {
  const key = detailKey(projectId, pageId);
  const existingRequest = inFlight.get(key);
  if (existingRequest) return existingRequest;

  const current = entries.get(key) ?? EMPTY_DETAIL;
  entries.set(key, {
    detail: current.detail,
    loading: current.detail === null,
    error: null,
  });
  emit(key);

  const requestGeneration = storeGeneration;
  const request = (async (): Promise<PageDetail | null> => {
    try {
      const result = await readPageDetail(projectId, pageId);
      if (requestGeneration !== storeGeneration) return null;
      if (!result.ok) {
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
      if (requestGeneration !== storeGeneration) return null;
      entries.set(key, {
        detail: null,
        loading: false,
        error: error instanceof Error ? error.message : "Page Detail is unavailable",
      });
      emit(key);
      return null;
    } finally {
      if (requestGeneration === storeGeneration) {
        inFlight.delete(key);
      }
    }
  })();
  inFlight.set(key, request);
  return request;
};

const requestPageDetailRefresh = (
  projectId: string,
  pageId: string,
  cause: ProjectionStreamMessage,
): Promise<void> => {
  const key = detailKey(projectId, pageId);
  return (async () => {
    const current = inFlight.get(key);
    if (current) await current;
    if (!listeners.has(key)) return;
    const detail = getPageDetail(projectId, pageId);
    if (
      cause.kind !== "resync" &&
      detail?.storeEpoch === cause.cursor.storeEpoch &&
      detail.changeLogSeq >= cause.cursor.changeLogSeq
    ) {
      return;
    }
    await fetchPageDetail(projectId, pageId);
  })();
};

export const usePageDetail = (
  libraryId: string | null,
  projectId: string | null,
  pageId: string | null,
): PageDetailSnapshot => {
  const registry = useProjectionInvalidationRegistry();
  const key = projectId && pageId ? detailKey(projectId, pageId) : null;
  useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => key ? (versions.get(key) ?? 0) : 0,
    () => 0,
  );

  useEffect(() => {
    if (!projectId || !pageId) return;
    void fetchPageDetail(projectId, pageId);
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
              changeLogSeq: detail.changeLogSeq,
            }
          : null;
      },
      invalidate: (cause) => requestPageDetailRefresh(projectId, pageId, cause),
    });
  }, [libraryId, pageId, projectId, registry]);

  return snapshot;
};
