import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { authorizedReadStampFixture } from "../../shared/testing/authorized-read-stamp-fixture";
import { AuthorityFreshnessIndex } from "./authority-freshness-index";
import {
  ResourceAuthorityQueryCache,
  admitResourceAuthorityQuery,
  resourceAuthorityQueryMeta,
} from "./resource-authority-query-cache";

const address = {
  kind: "project",
  library_id: "library-1",
  project_id: "project-1",
} as const;

const pageStamp = (pageId: string, commitSeq = 1, dependencies = [pageId]) =>
  authorizedReadStampFixture({
    deliveryAddress: address,
    subject: { kind: "page", page_id: pageId },
    requestDependencies: [{ kind: "page", page_id: pageId }],
    authorizationDependencies: dependencies.map((dependency) => ({
      kind: "page" as const,
      page_id: dependency,
    })),
    commitSeq,
  });

const waitForRegistrations = async (index: AuthorityFreshnessIndex, registrations: number) => {
  await vi.waitFor(() => {
    expect(index.diagnostics().registrations).toBe(registrations);
  });
};

describe("ResourceAuthorityQueryCache", () => {
  const clients: QueryClient[] = [];

  afterEach(() => {
    for (const client of clients) client.clear();
    clients.length = 0;
  });

  const setup = () => {
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    const freshnessIndex = new AuthorityFreshnessIndex();
    const cache = new ResourceAuthorityQueryCache({ queryClient: client, freshnessIndex });
    clients.push(client);
    return { cache, client, freshnessIndex };
  };

  it("evicts an exact dynamic root and its related cache synchronously", async () => {
    const { cache, client, freshnessIndex } = setup();
    const detailKey = ["page", "page-a"] as const;
    const documentKey = ["document", "page-a"] as const;
    await client.fetchQuery({
      queryKey: detailKey,
      queryFn: async () => ({ pageId: "page-a" }),
      meta: resourceAuthorityQueryMeta(() => ({
        authorizations: [pageStamp("page-a")],
        relatedQueryKeys: [documentKey],
      })),
    });
    client.setQueryData(documentKey, { body: "cached old body" });
    cache.start();
    await waitForRegistrations(freshnessIndex, 1);

    freshnessIndex.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 42,
      change: "revoke",
      roots: [{ kind: "page", page_id: "page-a" }],
    });

    expect(client.getQueryData(detailKey)).toBeUndefined();
    expect(client.getQueryData(documentKey)).toBeUndefined();
    cache.dispose();
  });

  it("hands a verified registration to the cache before query publication", async () => {
    const { cache, client, freshnessIndex } = setup();
    const queryKey = ["page", "page-a"] as const;
    const resolve = () => ({ authorizations: [pageStamp("page-a")] });
    cache.start();

    await client.fetchQuery({
      queryKey,
      queryFn: async () =>
        admitResourceAuthorityQuery({ pageId: "page-a" }, resolve, freshnessIndex),
      meta: resourceAuthorityQueryMeta(resolve),
    });

    expect(freshnessIndex.diagnostics().registrations).toBe(1);
    freshnessIndex.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 2,
      change: "revoke",
      roots: [{ kind: "page", page_id: "page-a" }],
    });
    expect(client.getQueryData(queryKey)).toBeUndefined();
    cache.dispose();
  });

  it("retains unrelated resources in the same delivery address", async () => {
    const { cache, client, freshnessIndex } = setup();
    const queryKey = ["page", "page-b"] as const;
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ pageId: "page-b" }),
      meta: resourceAuthorityQueryMeta(() => ({
        authorizations: [pageStamp("page-b")],
      })),
    });
    cache.start();
    await waitForRegistrations(freshnessIndex, 1);

    freshnessIndex.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 42,
      change: "revoke",
      roots: [{ kind: "page", page_id: "page-a" }],
    });

    expect(client.getQueryData(queryKey)).toEqual({ pageId: "page-b" });
    cache.dispose();
  });

  it("rejects a cached stamp older than an observed address checkpoint", async () => {
    const { cache, client, freshnessIndex } = setup();
    const queryKey = ["page", "page-a"] as const;
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ pageId: "page-a" }),
      meta: resourceAuthorityQueryMeta(() => ({
        authorizations: [pageStamp("page-a", 1)],
      })),
    });
    freshnessIndex.observeAddress({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 2,
    });

    cache.start();
    await vi.waitFor(() => expect(client.getQueryData(queryKey)).toBeUndefined());
    expect(freshnessIndex.diagnostics().registrations).toBe(0);
    cache.dispose();
  });

  it("registers every stamp in a multi-window query", async () => {
    const { cache, client, freshnessIndex } = setup();
    const queryKey = ["board", "project-1"] as const;
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ rows: ["page-a", "page-b"] }),
      meta: resourceAuthorityQueryMeta(() => ({
        authorizations: [pageStamp("page-a"), pageStamp("page-b")],
      })),
    });
    cache.start();
    await waitForRegistrations(freshnessIndex, 2);

    freshnessIndex.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 9,
      change: "revoke",
      roots: [{ kind: "page", page_id: "page-b" }],
    });

    expect(client.getQueryData(queryKey)).toBeUndefined();
    expect(freshnessIndex.diagnostics().registrations).toBe(0);
    cache.dispose();
  });

  it("reindexes only the query named by a cache event", async () => {
    const { cache, client, freshnessIndex } = setup();
    const resolvers = Array.from({ length: 100 }, (_, index) =>
      vi.fn(() => ({ authorizations: [pageStamp(`page-${index}`)] })),
    );
    for (const [index, resolve] of resolvers.entries()) {
      await client.fetchQuery({
        queryKey: ["page", index],
        queryFn: async () => ({ index }),
        meta: resourceAuthorityQueryMeta(resolve),
      });
    }
    cache.start();
    await waitForRegistrations(freshnessIndex, 100);

    client.setQueryData(["page", 42], { index: 42, updated: true });
    await vi.waitFor(() => expect(resolvers[42]).toHaveBeenCalledTimes(2));
    expect(
      resolvers
        .filter((_, index) => index !== 42)
        .every((resolve) => resolve.mock.calls.length === 1),
    ).toBe(true);
    cache.dispose();
  });
});
