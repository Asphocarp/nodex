import { describe, expect, test, vi } from "vitest";
import type {
  ProjectionDelivery,
  ProjectionImpact,
  ProjectionScope,
  ProjectionStreamMessage,
} from "../../shared/projection-stream";
import {
  impactMatches,
  ProjectionInvalidationRegistry,
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

const flush = async () => await new Promise((resolve) => setTimeout(resolve, 0));

const harness = () => {
  const listeners = new Set<(message: ProjectionStreamMessage) => void>();
  const subscribe = vi.fn((
    _scope: ProjectionScope,
    listener: (message: ProjectionStreamMessage) => void,
  ) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  return {
    registry: new ProjectionInvalidationRegistry(subscribe),
    subscribe,
    publish(message: ProjectionStreamMessage) {
      for (const listener of listeners) listener(message);
    },
    listenerCount: () => listeners.size,
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

  test("shares one access subscription and reference-counts one consumer", async () => {
    const stream = harness();
    let cursor = { storeEpoch: "epoch-1", commitSeq: 0 };
    const first = vi.fn(async (message: ProjectionStreamMessage) => {
      cursor = message.stream;
    });
    const second = vi.fn();
    const registration = (invalidate: (message: ProjectionStreamMessage) => void) => ({
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

    expect(stream.subscribe).toHaveBeenCalledOnce();
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
    stream.registry.register({
      scope,
      consumerKey: "query",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => ({ storeEpoch: "epoch-1", commitSeq: 1 }),
      invalidate,
    });
    const checkpoint = (commitSeq: number): ProjectionStreamMessage => ({
      version: 2,
      kind: "checkpoint",
      scope,
      stream: { storeEpoch: "epoch-1", commitSeq },
    });
    stream.publish(checkpoint(2));
    stream.publish(checkpoint(3));
    await flush();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  test("coalesces generic invalidations while a canonical read is running", async () => {
    const stream = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cursor = { storeEpoch: "epoch-1", commitSeq: 0 };
    const invalidate = vi.fn(async (message: ProjectionStreamMessage) => {
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
});
