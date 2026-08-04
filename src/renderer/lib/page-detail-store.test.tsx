import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents";
import type { PageDetail } from "../../shared/page-detail";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import { ProjectionInvalidationProvider } from "./projection-invalidation-context";
import { ProjectionInvalidationRegistry } from "./projection-invalidation-registry";

const mocks = vi.hoisted(() => ({
  readPageDetail: vi.fn(),
}));

vi.mock("./api", () => ({
  readPageDetail: mocks.readPageDetail,
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
  version: 3,
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
): ProjectionStreamMessage => ({
  version: 1,
  kind: "changed",
  scope: {
    kind: "project",
    libraryId: "library-1",
    projectId: "project-1",
  },
  cursor: { storeEpoch, changeLogSeq: headSeq },
  impact: {
    kind: "resources",
    page_ids: [pageId],
    database_ids: [],
    data_source_ids: [],
    view_ids: [],
    document_heads: [{
      page_id: pageId,
      document_id: pageId === "page-1" ? "document-1" : `document:${pageId}`,
      generation: 1,
      head_seq: headSeq,
    }],
  },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("Page Detail store realtime convergence", () => {
  let projectionListener: ((message: ProjectionStreamMessage) => void) | null;
  let latestMessage: ProjectionStreamMessage | null;
  let projectionRegistry: ProjectionInvalidationRegistry;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ProjectionInvalidationProvider registry={projectionRegistry}>
      {children}
    </ProjectionInvalidationProvider>
  );
  const publish = (message: ProjectionStreamMessage) => {
    latestMessage = message;
    projectionListener?.(message);
  };

  beforeEach(() => {
    resetPageDetailStoreForTests();
    mocks.readPageDetail.mockReset();
    projectionListener = null;
    latestMessage = null;
    projectionRegistry = new ProjectionInvalidationRegistry((scope, listener) => {
      projectionListener = listener;
      if (latestMessage) {
        listener({
          version: 1,
          kind: "checkpoint",
          scope,
          cursor: latestMessage.cursor,
        });
      }
      return () => {
        if (projectionListener === listener) projectionListener = null;
      };
    });
  });

  test("rereads only the matching Page after its Document head advances", async () => {
    mocks.readPageDetail
      .mockResolvedValueOnce({ ok: true, value: detail("Before", 1) })
      .mockResolvedValueOnce({ ok: true, value: detail("After", 2) });
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.detail?.page.title).toBe("Before"));

    await act(async () => {
      publish(pageEvent("another-page", 2));
      await Promise.resolve();
    });
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(1);

    await act(async () => {
      publish(pageEvent("page-1", 2));
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
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );

    await act(async () => {
      publish(pageEvent("page-1", 2));
      firstRead.resolve({ ok: true, value: detail("Stale", 1) });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.detail?.page.title).toBe("Latest"));
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(2);
  });

  test("does not reread when an in-flight canonical snapshot covers the impact", async () => {
    const firstRead = deferred<{ ok: true; value: PageDetail }>();
    mocks.readPageDetail.mockReturnValueOnce(firstRead.promise);
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );

    await act(async () => {
      publish(pageEvent("page-1", 2));
      firstRead.resolve({ ok: true, value: detail("Already current", 2) });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.detail?.page.title).toBe("Already current");
    });
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(1);
  });

  test("accepts a lower Document head after the Store epoch changes", async () => {
    mocks.readPageDetail
      .mockResolvedValueOnce({ ok: true, value: detail("Before restore", 8) })
      .mockResolvedValueOnce({
        ok: true,
        value: detail("Restored Store", 1, "epoch-2"),
      });
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.detail?.page.title).toBe("Before restore");
    });

    await act(async () => {
      publish(pageEvent("page-1", 1, "epoch-2"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.detail?.page.title).toBe("Restored Store");
    });
    expect(result.current.detail?.storeEpoch).toBe("epoch-2");
  });

  test("keeps its stable scope while a Page is missing and converges after restore", async () => {
    mocks.readPageDetail
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "page_not_found", message: "Page not found" },
      })
      .mockResolvedValueOnce({ ok: true, value: detail("Restored", 2) });
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.error).toBe("Page not found"));

    await act(async () => {
      publish(pageEvent("page-1", 2));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.detail?.page.title).toBe("Restored"));
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(2);
  });
});
