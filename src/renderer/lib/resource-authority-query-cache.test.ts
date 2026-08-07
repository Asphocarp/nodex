import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectionScope } from "../../shared/projection-stream";
import { projectionScopeKey } from "../../shared/projection-stream";
import type { ResourceRevocationMessage } from "../../shared/resource-revocation-stream";
import { ProjectionInvalidationRegistry } from "./projection-invalidation-registry";
import {
  ResourceAuthorityQueryCache,
  resourceAuthorityQueryMeta,
} from "./resource-authority-query-cache";

const projectScope: ProjectionScope = {
  kind: "project",
  libraryId: "library-1",
  projectId: "project-1",
};

const revocationMessage = (
  resourceId: string,
  scope: ProjectionScope = projectScope,
): ResourceRevocationMessage => ({
  version: 1,
  kind: "revocation",
  scope,
  stream: { storeEpoch: "epoch-1", commitSeq: 42 },
  delivery: {
    storeEpoch: "epoch-1",
    commitSeq: 42,
    manifestHash: "a".repeat(64),
    operationId: "operation-1",
    committedAt: "2026-08-08T00:00:00.000Z",
    revocation: {
      authorization_scope: {
        kind: "project",
        library_id: scope.libraryId,
        project_id: scope.kind === "project" ? scope.projectId : "project-1",
      },
      resource_kind: "page",
      resource_id: resourceId,
      reason: "ownership_moved",
    },
  },
});

describe("ResourceAuthorityQueryCache", () => {
  const clients: QueryClient[] = [];

  afterEach(() => {
    for (const client of clients) client.clear();
    clients.length = 0;
  });

  it("evicts inactive scoped data and its related authority cache synchronously", async () => {
    const revocationListeners = new Map<
      string,
      (message: ResourceRevocationMessage) => void
    >();
    const registry = new ProjectionInvalidationRegistry({
      subscribeProjection: () => () => undefined,
      subscribeRevocations: (scope, listener) => {
        revocationListeners.set(projectionScopeKey(scope), listener);
        return () => revocationListeners.delete(projectionScopeKey(scope));
      },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    clients.push(client);
    const detailKey = ["page", "page-a"] as const;
    const documentKey = ["document", "page-a"] as const;
    await client.fetchQuery({
      queryKey: detailKey,
      queryFn: async () => ({ pageId: "page-a" }),
      meta: resourceAuthorityQueryMeta(() => ({
        scope: projectScope,
        cursor: { storeEpoch: "epoch-1", commitSeq: 1 },
        dependencies: { pageIds: ["page-a"] },
        relatedQueryKeys: [documentKey],
      })),
    });
    client.setQueryData(documentKey, { body: "cached old body" });

    const cache = new ResourceAuthorityQueryCache({
      queryClient: client,
      registry,
    });
    cache.start();
    expect(client.getQueryData(detailKey)).toEqual({ pageId: "page-a" });
    expect(client.getQueryData(documentKey)).toEqual({ body: "cached old body" });

    revocationListeners.get(projectionScopeKey(projectScope))?.(
      revocationMessage("page-a"),
    );

    expect(client.getQueryData(detailKey)).toBeUndefined();
    expect(client.getQueryData(documentKey)).toBeUndefined();
    cache.dispose();
    registry.dispose();
  });

  it("retains unrelated resources in the same authorization scope", async () => {
    const revocationListeners = new Map<
      string,
      (message: ResourceRevocationMessage) => void
    >();
    const registry = new ProjectionInvalidationRegistry({
      subscribeProjection: () => () => undefined,
      subscribeRevocations: (scope, listener) => {
        revocationListeners.set(projectionScopeKey(scope), listener);
        return () => revocationListeners.delete(projectionScopeKey(scope));
      },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    clients.push(client);
    const queryKey = ["page", "page-b"] as const;
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ pageId: "page-b" }),
      meta: resourceAuthorityQueryMeta(() => ({
        scope: projectScope,
        cursor: { storeEpoch: "epoch-1", commitSeq: 1 },
        dependencies: { pageIds: ["page-b"] },
      })),
    });
    const cache = new ResourceAuthorityQueryCache({
      queryClient: client,
      registry,
    });
    cache.start();

    revocationListeners.get(projectionScopeKey(projectScope))?.(
      revocationMessage("page-a"),
    );

    expect(client.getQueryData(queryKey)).toEqual({ pageId: "page-b" });
    cache.dispose();
    registry.dispose();
  });

  it("fences an inactive cache when the initial checkpoint exposes a subscribe race", async () => {
    const registry = new ProjectionInvalidationRegistry({
      subscribeProjection: (scope, listener) => {
        listener({
          version: 2,
          kind: "checkpoint",
          scope,
          stream: { storeEpoch: "epoch-1", commitSeq: 2 },
        });
        return () => undefined;
      },
      subscribeRevocations: () => () => undefined,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    clients.push(client);
    const queryKey = ["page", "page-a"] as const;
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ pageId: "page-a" }),
      meta: resourceAuthorityQueryMeta(() => ({
        scope: projectScope,
        cursor: { storeEpoch: "epoch-1", commitSeq: 1 },
        dependencies: { pageIds: ["page-a"] },
      })),
    });

    const cache = new ResourceAuthorityQueryCache({
      queryClient: client,
      registry,
    });
    cache.start();

    expect(client.getQueryData(queryKey)).toBeUndefined();
    cache.dispose();
    registry.dispose();
  });

  it("resets an active query and rejects a read started before revocation", async () => {
    const revocationListeners = new Map<
      string,
      (message: ResourceRevocationMessage) => void
    >();
    const registry = new ProjectionInvalidationRegistry({
      subscribeProjection: () => () => undefined,
      subscribeRevocations: (scope, listener) => {
        revocationListeners.set(projectionScopeKey(scope), listener);
        return () => revocationListeners.delete(projectionScopeKey(scope));
      },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    clients.push(client);
    const queryKey = ["page", "page-a"] as const;
    const meta = resourceAuthorityQueryMeta(() => ({
      scope: projectScope,
      cursor: { storeEpoch: "epoch-1", commitSeq: 1 },
      dependencies: { pageIds: ["page-a"] },
    }));
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ value: "initial" }),
      meta,
    });
    let resolveOldRead!: (value: { value: string }) => void;
    let reads = 0;
    const oldRead = new Promise<{ value: string }>((resolve) => {
      resolveOldRead = resolve;
    });
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: async () => {
        reads += 1;
        if (reads === 1) return oldRead;
        return { value: "canonical-after-revocation" };
      },
      meta,
      staleTime: Infinity,
    });
    const releaseObserver = observer.subscribe(() => undefined);
    const cache = new ResourceAuthorityQueryCache({
      queryClient: client,
      registry,
    });
    cache.start();
    const staleRead = observer.refetch();

    revocationListeners.get(projectionScopeKey(projectScope))?.(
      revocationMessage("page-a"),
    );
    expect(client.getQueryData(queryKey)).toBeUndefined();
    resolveOldRead({ value: "late-stale-value" });
    await staleRead;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getQueryData(queryKey)).toEqual({
      value: "canonical-after-revocation",
    });
    cache.dispose();
    releaseObserver();
    registry.dispose();
  });

  it("reindexes only the query named by a cache event", async () => {
    const subscribeProjection = vi.fn(() => () => undefined);
    const subscribeRevocations = vi.fn(() => () => undefined);
    const registry = new ProjectionInvalidationRegistry({
      subscribeProjection,
      subscribeRevocations,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    clients.push(client);
    const resolvers = Array.from({ length: 100 }, (_, index) =>
      vi.fn(() => ({
        scope: projectScope,
        cursor: { storeEpoch: "epoch-1", commitSeq: 1 },
        dependencies: { pageIds: [`page-${index}`] },
      })),
    );
    for (const [index, resolve] of resolvers.entries()) {
      await client.fetchQuery({
        queryKey: ["page", index],
        queryFn: async () => ({ index }),
        meta: resourceAuthorityQueryMeta(resolve),
      });
    }
    const cache = new ResourceAuthorityQueryCache({
      queryClient: client,
      registry,
    });
    cache.start();
    expect(resolvers.map((resolve) => resolve.mock.calls.length))
      .toEqual(Array.from({ length: 100 }, () => 1));

    client.setQueryData(["page", 42], { index: 42, updated: true });

    expect(resolvers[42]).toHaveBeenCalledTimes(2);
    expect(subscribeProjection).toHaveBeenCalledTimes(1);
    expect(subscribeRevocations).toHaveBeenCalledTimes(1);
    expect(
      resolvers
        .filter((_, index) => index !== 42)
        .every((resolve) => resolve.mock.calls.length === 1),
    ).toBe(true);
    cache.dispose();
    registry.dispose();
  });
});
