import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents";
import type { PageDetail } from "../../shared/page-detail";
import { authorizedReadStampFixture } from "../../shared/testing/authorized-read-stamp-fixture";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import type {
  ResourceRevocationDeliveryMessage,
  ResourceRevocationMessage,
} from "../../shared/resource-revocation-stream";
import { ProjectionInvalidationProvider } from "./projection-invalidation-context";
import { ProjectionInvalidationRegistry } from "./projection-invalidation-registry";

const mocks = vi.hoisted(() => ({
  readPageDetail: vi.fn(),
}));

vi.mock("./api", () => ({
  readPageDetail: mocks.readPageDetail,
}));

import {
  getPageDetail,
  invalidatePageDetail,
  pageDetailStoreDiagnostics,
  resetPageDetailStoreForTests,
  setPageDetail,
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
  commitSeq: headSeq,
  authorization: authorizedReadStampFixture({
    deliveryAddress: {
      kind: "project",
      library_id: "library-1",
      project_id: "project-1",
    },
    subject: { kind: "page", page_id: "page-1" },
    storeEpoch,
    commitSeq: headSeq,
  }),
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
  version: 2,
  kind: "effect",
  scope: {
    kind: "project",
    libraryId: "library-1",
    projectId: "project-1",
  },
  stream: { storeEpoch, commitSeq: headSeq },
  delivery: {
    storeEpoch,
    commitSeq: headSeq,
    manifestHash: String(headSeq).padStart(64, "b").slice(-64),
    operationId: `operation-${headSeq}`,
    committedAt: "2026-08-06T00:00:00.000Z",
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
    effect: {
      scope: {
        schema_version: 1,
        canonical_key: `scope:${pageId}`,
        scope: {
          kind: "page",
          project_id: "project-1",
          page_id: pageId,
        },
      },
      baseRevision: Math.max(0, headSeq - 1),
      resultRevision: headSeq,
      coveredCommitSeq: headSeq,
      patch: { kind: "page_changed", projectId: "project-1", pageId },
      requiresReadAtLeast: true,
      effectHash: String(headSeq).padStart(64, "a").slice(-64),
    },
  },
});

const pageRevocation = (
  commitSeq: number,
): ResourceRevocationDeliveryMessage => ({
  version: 1,
  kind: "revocation",
  scope: {
    kind: "project",
    libraryId: "library-1",
    projectId: "project-1",
  },
  stream: { storeEpoch: "epoch-1", commitSeq },
  delivery: {
    storeEpoch: "epoch-1",
    commitSeq,
    manifestHash: String(commitSeq).padStart(64, "b").slice(-64),
    operationId: `operation-${commitSeq}`,
    committedAt: "2026-08-06T00:00:00.000Z",
    revocation: {
      authorization_scope: {
        kind: "project",
        library_id: "library-1",
        project_id: "project-1",
      },
      resource_kind: "page",
      resource_id: "page-1",
      reason: "ownership_moved",
    },
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
  let revocationListener: ((message: ResourceRevocationMessage) => void) | null;
  let latestMessage: ProjectionStreamMessage | ResourceRevocationMessage | null;
  let projectionRegistry: ProjectionInvalidationRegistry;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ProjectionInvalidationProvider registry={projectionRegistry}>
      {children}
    </ProjectionInvalidationProvider>
  );
  const publish = (message: ProjectionStreamMessage | ResourceRevocationMessage) => {
    latestMessage = message;
    if (message.version === 1) {
      revocationListener?.(message);
      return;
    }
    projectionListener?.(message);
  };

  beforeEach(() => {
    resetPageDetailStoreForTests();
    mocks.readPageDetail.mockReset();
    projectionListener = null;
    revocationListener = null;
    latestMessage = null;
    projectionRegistry = new ProjectionInvalidationRegistry({
      subscribeProjection: (scope, listener) => {
        projectionListener = listener;
        if (latestMessage) {
          listener({
            version: 2,
            kind: "checkpoint",
            scope,
            stream: latestMessage.stream,
          });
        }
        return () => {
          if (projectionListener === listener) projectionListener = null;
        };
      },
      subscribeRevocations: (_scope, listener) => {
        revocationListener = listener;
        return () => {
          if (revocationListener === listener) revocationListener = null;
        };
      },
    });
  });

  test("bounds inactive Page Detail entries across 10k-key churn", () => {
    const template = detail("Bounded", 1);
    for (let index = 0; index < 10_000; index += 1) {
      setPageDetail({
        ...template,
        page: {
          ...template.page,
          pageId: `page-${index}`,
          documentId: `document-${index}`,
        },
      });
    }

    expect(pageDetailStoreDiagnostics()).toMatchObject({
      entries: 128,
      inFlight: 0,
      projectionRegistrations: 0,
      freshnessRegistrations: 0,
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

  test("does not refetch when the initial checkpoint is covered by an in-flight read", async () => {
    const firstRead = deferred<{ ok: true; value: PageDetail }>();
    mocks.readPageDetail.mockReturnValueOnce(firstRead.promise);
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );

    await act(async () => {
      publish({
        version: 2,
        kind: "checkpoint",
        scope: {
          kind: "project",
          libraryId: "library-1",
          projectId: "project-1",
        },
        stream: { storeEpoch: "epoch-1", commitSeq: 2 },
      });
      firstRead.resolve({ ok: true, value: detail("Already current", 2) });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.detail?.page.title).toBe("Already current");
    });
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(1);
  });

  test("performs a trailing minimum-commit read when a checkpoint outruns the in-flight read", async () => {
    const firstRead = deferred<{ ok: true; value: PageDetail }>();
    mocks.readPageDetail
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce({ ok: true, value: detail("Latest", 2) });
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );

    await act(async () => {
      publish({
        version: 2,
        kind: "checkpoint",
        scope: {
          kind: "project",
          libraryId: "library-1",
          projectId: "project-1",
        },
        stream: { storeEpoch: "epoch-1", commitSeq: 2 },
      });
      firstRead.resolve({ ok: true, value: detail("Stale", 1) });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.detail?.page.title).toBe("Latest");
    });
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

  test("evicts a revoked Page immediately and fences an older in-flight read", async () => {
    const staleRead = deferred<{ ok: true; value: PageDetail }>();
    mocks.readPageDetail.mockReturnValueOnce(staleRead.promise);
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => {
      publish(pageRevocation(2));
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({
      detail: null,
      loading: false,
      error: "Page not found",
    });

    await act(async () => {
      staleRead.resolve({ ok: true, value: detail("Stale", 1) });
      await staleRead.promise;
    });
    expect(result.current).toMatchObject({
      detail: null,
      loading: false,
      error: "Page not found",
    });
  });

  test("refreshes Page detail without tombstoning it when only a dependency is revoked", async () => {
    mocks.readPageDetail
      .mockResolvedValueOnce({ ok: true, value: detail("Before", 1) })
      .mockResolvedValueOnce({ ok: true, value: detail("Still readable", 2) });
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.detail?.page.title).toBe("Before"));
    const revocation = pageRevocation(2);

    await act(async () => {
      publish({
        ...revocation,
        delivery: {
          ...revocation.delivery,
          revocation: {
            ...revocation.delivery.revocation,
            resource_kind: "document",
            resource_id: "document-1",
          },
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.detail?.page.title).toBe("Still readable");
    });
    expect(result.current.error).toBe(null);
  });

  test("keeps revoked dependency data empty after the trailing read fails", async () => {
    mocks.readPageDetail
      .mockResolvedValueOnce({ ok: true, value: detail("Before", 1) })
      .mockRejectedValueOnce(new Error("canonical read unavailable"))
      .mockRejectedValueOnce(new Error("canonical read unavailable"));
    const { result } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.detail?.page.title).toBe("Before"));
    const revocation = pageRevocation(2);

    await act(async () => {
      publish({
        ...revocation,
        delivery: {
          ...revocation.delivery,
          revocation: {
            ...revocation.delivery.revocation,
            resource_kind: "document",
            resource_id: "document-1",
          },
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({
        detail: null,
        loading: false,
        error: "canonical read unavailable",
      });
    });
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(3);
  });

  test("retains an authorized Page across surface remounts without serving it past an effect", async () => {
    mocks.readPageDetail.mockResolvedValueOnce({ ok: true, value: detail("Open", 1) });
    const { result, unmount } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.detail?.page.title).toBe("Open"));

    unmount();
    expect(getPageDetail("project-1", "page-1")?.page.title).toBe("Open");

    const remounted = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );
    expect(remounted.result.current.detail?.page.title).toBe("Open");
    expect(mocks.readPageDetail).toHaveBeenCalledTimes(1);
    remounted.unmount();

    await act(async () => {
      publish(pageEvent("page-1", 2));
      await Promise.resolve();
    });

    expect(getPageDetail("project-1", "page-1")).toBe(null);
  });

  test("releases authority when an invalidated active Page is later unmounted", async () => {
    mocks.readPageDetail.mockResolvedValueOnce({ ok: true, value: detail("Open", 1) });
    const { result, unmount } = renderHook(
      () => usePageDetail("library-1", "project-1", "page-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.detail?.page.title).toBe("Open"));

    act(() => invalidatePageDetail("project-1", "page-1"));
    expect(projectionListener).not.toBe(null);
    unmount();

    expect(projectionListener).toBe(null);
    expect(revocationListener).toBe(null);
  });
});
