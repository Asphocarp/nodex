import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents";
import type { PageDetail } from "../../shared/page-detail";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";

const mocks = vi.hoisted(() => ({
  readPageDetail: vi.fn(),
  pageTargetListener: null as ((event: PageTargetChangedEvent) => void) | null,
}));

vi.mock("./api", () => ({
  readPageDetail: mocks.readPageDetail,
  subscribeAuthorityResync: () => () => undefined,
  subscribeBoardChanges: () => () => undefined,
  subscribeDatabaseChanges: () => () => undefined,
  subscribePageTargetChanges: (
    _projectId: string,
    listener: (event: PageTargetChangedEvent) => void,
  ) => {
    mocks.pageTargetListener = listener;
    return () => {
      if (mocks.pageTargetListener === listener) mocks.pageTargetListener = null;
    };
  },
}));

import {
  resetPageDetailStoreForTests,
  usePageDetail,
} from "./page-detail-store";

const timestamp = "2026-07-22T00:00:00.000Z";

const detail = (
  title: string,
  headSeq: number,
  storeEpoch = "epoch-1",
): PageDetail => ({
  version: 2,
  projectId: "project-1",
  libraryId: "library-1",
  storeEpoch,
  changeLogSeq: headSeq,
  page: {
    pageId: "page-1",
    libraryId: "library-1",
    parent: { kind: "library", libraryId: "library-1" },
    lifecycle: "active",
    parentRevision: 1,
    metadataRevision: 1,
    documentId: "document-1",
    documentGeneration: 1,
    documentHeadSeq: headSeq,
    title,
    richTitle: plainTextToPortableRichText(title),
    preview: title,
    plainText: title,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  document: {
    readiness: "ready",
    schemaKey: "nodex.page",
    schemaVersion: 2,
  },
  intrinsicProperties: [],
  dataSourceContext: { kind: "standalone" },
});

const pageEvent = (
  pageId: string,
  headSeq: number,
  storeEpoch = "epoch-1",
): PageTargetChangedEvent => ({
  version: 1,
  libraryId: "library-1",
  storeEpoch,
  changeLogSeq: headSeq,
  targetPageId: pageId,
  changeKind: "content",
  affectedDatabaseIds: [],
  affectedDataSourceIds: [],
  document: { id: "document-1", generation: 1, headSeq },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("Page Detail store realtime convergence", () => {
  beforeEach(() => {
    resetPageDetailStoreForTests();
    mocks.readPageDetail.mockReset();
    mocks.pageTargetListener = null;
  });

  test("rereads only the matching Page after its Document head advances", async () => {
    mocks.readPageDetail
      .mockResolvedValueOnce({ ok: true, value: detail("Before", 1) })
      .mockResolvedValueOnce({ ok: true, value: detail("After", 2) });
    const { result } = renderHook(() => usePageDetail("project-1", "page-1"));
    await waitFor(() => expect(result.current.detail?.page.title).toBe("Before"));

    await act(async () => {
      mocks.pageTargetListener?.(pageEvent("another-page", 2));
      await Promise.resolve();
    });
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.pageTargetListener?.(pageEvent("page-1", 2));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.detail?.page.title).toBe("After"));
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(2);
  });

  test("performs a trailing reread when invalidated during an in-flight read", async () => {
    const firstRead = deferred<{ ok: true; value: PageDetail }>();
    mocks.readPageDetail
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce({ ok: true, value: detail("Latest", 2) });
    const { result } = renderHook(() => usePageDetail("project-1", "page-1"));

    await act(async () => {
      mocks.pageTargetListener?.(pageEvent("page-1", 2));
      firstRead.resolve({ ok: true, value: detail("Stale", 1) });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.detail?.page.title).toBe("Latest"));
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(2);
  });

  test("accepts a lower Document head after the Store epoch changes", async () => {
    mocks.readPageDetail
      .mockResolvedValueOnce({ ok: true, value: detail("Before restore", 8) })
      .mockResolvedValueOnce({
        ok: true,
        value: detail("Restored Store", 1, "epoch-2"),
      });
    const { result } = renderHook(() => usePageDetail("project-1", "page-1"));
    await waitFor(() => {
      expect(result.current.detail?.page.title).toBe("Before restore");
    });

    await act(async () => {
      mocks.pageTargetListener?.(pageEvent("page-1", 1, "epoch-2"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.detail?.page.title).toBe("Restored Store");
    });
    expect(result.current.detail?.storeEpoch).toBe("epoch-2");
  });
});
