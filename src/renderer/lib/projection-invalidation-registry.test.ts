import { describe, expect, test, vi } from "vitest";
import type {
  ProjectionDelivery,
  ProjectionImpact,
  ProjectionScope,
  ProjectionStreamMessage,
} from "../../shared/projection-stream";
import type { ResourceRevocationMessage } from "../../shared/resource-revocation-stream";
import {
  impactMatches,
  type ProjectionInvalidationCause,
  ProjectionInvalidationRegistry,
  revocationMatches,
} from "./projection-invalidation-registry";

const scope: ProjectionScope = {
  kind: "project",
  libraryId: "library-1",
  projectId: "project-1",
};

const impact = (
  overrides: Partial<Extract<ProjectionImpact, { kind: "resources" }>> = {},
): ProjectionImpact => ({
  kind: "resources",
  page_ids: [],
  database_ids: [],
  data_source_ids: [],
  view_ids: [],
  document_heads: [],
  ...overrides,
});

const delivery = (commitSeq: number): ProjectionDelivery => ({
  storeEpoch: "epoch-1",
  commitSeq,
  manifestHash: String(commitSeq).padStart(64, "b").slice(-64),
  operationId: `operation-${commitSeq}`,
  committedAt: "2026-08-06T00:00:00.000Z",
  impact: impact({ page_ids: ["page-1"] }),
  effect: {
    scope: {
      schema_version: 1,
      canonical_key: "scope:page-1",
      scope: {
        kind: "page",
        project_id: "project-1",
        page_id: "page-1",
      },
    },
    baseRevision: commitSeq - 1,
    resultRevision: commitSeq,
    coveredCommitSeq: commitSeq,
    patch: {
      kind: "page_changed",
      projectId: "project-1",
      pageId: "page-1",
    },
    requiresReadAtLeast: true,
    effectHash: String(commitSeq).padStart(64, "a").slice(-64),
  },
});

const effectMessage = (commitSeq: number): ProjectionStreamMessage => ({
  version: 2,
  kind: "effect",
  scope,
  stream: { storeEpoch: "epoch-1", commitSeq },
  delivery: delivery(commitSeq),
});

const revocationMessage = (
  commitSeq: number,
  resourceId = "page-1",
): ResourceRevocationMessage => ({
  version: 1,
  kind: "revocation",
  scope,
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
      resource_id: resourceId,
      reason: "access_revoked",
    },
  },
});

const flush = async () => await new Promise((resolve) => setTimeout(resolve, 0));

const harness = () => {
  const projectionListeners = new Set<(message: ProjectionStreamMessage) => void>();
  const revocationListeners = new Set<(message: ResourceRevocationMessage) => void>();
  const subscribeProjection = vi.fn((
    _scope: ProjectionScope,
    listener: (message: ProjectionStreamMessage) => void,
  ) => {
    projectionListeners.add(listener);
    return () => projectionListeners.delete(listener);
  });
  const subscribeRevocations = vi.fn((
    _scope: ProjectionScope,
    listener: (message: ResourceRevocationMessage) => void,
  ) => {
    revocationListeners.add(listener);
    return () => revocationListeners.delete(listener);
  });
  return {
    registry: new ProjectionInvalidationRegistry({
      subscribeProjection,
      subscribeRevocations,
    }),
    subscribeProjection,
    subscribeRevocations,
    publish(message: ProjectionStreamMessage | ResourceRevocationMessage) {
      if (message.kind === "revocation") {
        for (const listener of revocationListeners) listener(message);
        return;
      }
      for (const listener of projectionListeners) listener(message);
    },
    listenerCount: () => projectionListeners.size + revocationListeners.size,
  };
};

describe("ProjectionInvalidationRegistry", () => {
  test("matches every impact identity dimension", () => {
    const value = impact({
      page_ids: ["page-1"],
      database_ids: ["database-1"],
      data_source_ids: ["source-1"],
      view_ids: ["view-1"],
      document_heads: [{
        page_id: "page-1",
        document_id: "document-1",
        generation: 1,
        head_seq: 2,
      }],
    });
    expect(impactMatches({ pageIds: ["page-1"] }, value)).toBe(true);
    expect(impactMatches({ databaseIds: ["database-1"] }, value)).toBe(true);
    expect(impactMatches({ dataSourceIds: ["source-1"] }, value)).toBe(true);
    expect(impactMatches({ viewIds: ["view-1"] }, value)).toBe(true);
    expect(impactMatches({ documentIds: ["document-1"] }, value)).toBe(true);
    expect(impactMatches({ pageIds: ["other"] }, value)).toBe(false);
  });

  test("matches revocations by exact resource identity", () => {
    const revocation = revocationMessage(2).delivery.revocation;
    expect(revocationMatches({ pageIds: ["page-1"] }, revocation)).toBe(true);
    expect(revocationMatches({ pageIds: ["other"] }, revocation)).toBe(false);
    expect(revocationMatches({ aggregate: true }, revocation)).toBe(true);
    expect(revocationMatches({ canvasIds: ["canvas-1"] }, {
      ...revocation,
      resource_kind: "canvas",
      resource_id: "canvas-1",
    })).toBe(true);
  });

  test("shares one access subscription and reference-counts one consumer", async () => {
    const stream = harness();
    let cursor = { storeEpoch: "epoch-1", commitSeq: 0 };
    const first = vi.fn(async (message: ProjectionInvalidationCause) => {
      cursor = message.stream;
    });
    const second = vi.fn();
    const registration = (invalidate: (message: ProjectionInvalidationCause) => void) => ({
      scope,
      consumerKey: "shared",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => cursor,
      invalidate,
    });
    const releaseFirst = stream.registry.register(registration(first));
    const releaseSecond = stream.registry.register(registration(second));
    stream.publish(effectMessage(1));
    await flush();

    expect(stream.subscribeProjection).toHaveBeenCalledOnce();
    expect(stream.subscribeRevocations).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    releaseFirst();
    stream.publish(effectMessage(2));
    await flush();
    expect(second).toHaveBeenCalledOnce();
    releaseSecond();
    expect(stream.listenerCount()).toBe(0);
  });

  test("uses only the initial checkpoint to close the read-subscribe race", async () => {
    const stream = harness();
    const invalidate = vi.fn();
    const fence = vi.fn();
    stream.registry.register({
      scope,
      consumerKey: "query",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => ({ storeEpoch: "epoch-1", commitSeq: 1 }),
      fence,
      invalidate,
    });
    const checkpoint = (commitSeq: number): ProjectionStreamMessage => ({
      version: 2,
      kind: "checkpoint",
      scope,
      stream: { storeEpoch: "epoch-1", commitSeq },
    });
    stream.publish(checkpoint(2));
    expect(fence).toHaveBeenCalledOnce();
    stream.publish(checkpoint(3));
    await flush();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(fence).toHaveBeenCalledOnce();
  });

  test("coalesces generic invalidations while a canonical read is running", async () => {
    const stream = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cursor = { storeEpoch: "epoch-1", commitSeq: 0 };
    const invalidate = vi.fn(async (message: ProjectionInvalidationCause) => {
      if (invalidate.mock.calls.length === 1) await gate;
      cursor = message.stream;
    });
    stream.registry.register({
      scope,
      consumerKey: "query",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => cursor,
      invalidate,
    });
    stream.publish(effectMessage(1));
    stream.publish(effectMessage(2));
    await flush();
    expect(invalidate).toHaveBeenCalledOnce();
    release();
    await flush();
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(cursor.commitSeq).toBe(2);
  });

  test("delivers a matching revocation even when the cache cursor is newer", async () => {
    const stream = harness();
    const invalidate = vi.fn();
    stream.registry.register({
      scope,
      consumerKey: "page",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => ({ storeEpoch: "epoch-1", commitSeq: 10 }),
      invalidate,
    });

    stream.publish(revocationMessage(2));
    await flush();

    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith(revocationMessage(2));
  });

  test("applies every revocation synchronously while canonical repair is queued", async () => {
    const stream = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revoke = vi.fn();
    const invalidate = vi.fn(async () => {
      if (invalidate.mock.calls.length === 1) await gate;
    });
    stream.registry.register({
      scope,
      consumerKey: "board",
      getDependencies: () => ({ aggregate: true }),
      getCursor: () => ({ storeEpoch: "epoch-1", commitSeq: 10 }),
      revoke,
      invalidate,
    });

    const first = revocationMessage(2, "page-1");
    const second = revocationMessage(3, "page-2");
    const third = revocationMessage(4, "page-3");
    stream.publish(first);
    stream.publish(second);
    stream.publish(third);

    expect(revoke.mock.calls.map((call) => call[0])).toEqual([
      first,
      second,
      third,
    ]);
    await flush();
    expect(invalidate).toHaveBeenCalledOnce();
    release();
    await flush();
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith(third);
  });

  test("lets a later commit supersede an older revocation for queued repair", async () => {
    const stream = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invalidate = vi.fn(async () => {
      if (invalidate.mock.calls.length === 1) await gate;
    });
    stream.registry.register({
      scope,
      consumerKey: "page",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => ({ storeEpoch: "epoch-1", commitSeq: 0 }),
      invalidate,
    });

    const revoked = revocationMessage(2);
    const changedAgain = effectMessage(3);
    stream.publish(revoked);
    stream.publish(changedAgain);
    await flush();
    expect(invalidate).toHaveBeenCalledOnce();

    release();
    await flush();
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith(changedAgain);
  });
});
