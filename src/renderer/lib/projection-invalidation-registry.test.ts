import { describe, expect, test, vi } from "vitest";
import type {
  ProjectionCursor,
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

const impact = (overrides: Partial<Extract<ProjectionImpact, { kind: "resources" }>> = {}): ProjectionImpact => ({
  kind: "resources",
  page_ids: [],
  database_ids: [],
  data_source_ids: [],
  view_ids: [],
  document_heads: [],
  ...overrides,
});

const changed = (
  commitSeq: number,
  value: ProjectionImpact = impact({ page_ids: ["page-1"] }),
  storeEpoch = "epoch-1",
): ProjectionStreamMessage => ({
  version: 1,
  kind: "changed",
  scope,
  cursor: { storeEpoch, commitSeq },
  impact: value,
});

const flush = async () => await new Promise((resolve) => setTimeout(resolve, 0));

const harness = () => {
  const listeners = new Set<(message: ProjectionStreamMessage) => void>();
  const subscribe = vi.fn((_scope: ProjectionScope, listener: (message: ProjectionStreamMessage) => void) => {
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
  test("matches every identity dimension plus aggregate and All", () => {
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
    expect(impactMatches({ aggregate: true }, impact())).toBe(true);
    expect(impactMatches({ pageIds: ["other"] }, value)).toBe(false);
    expect(impactMatches({}, { kind: "all" })).toBe(true);
    expect(impactMatches({ aggregate: true }, { kind: "none" })).toBe(false);
  });

  test("shares one scope subscription and reference-counts a consumer key", async () => {
    const stream = harness();
    let cursor: ProjectionCursor = { storeEpoch: "epoch-1", commitSeq: 0 };
    const first = vi.fn(async () => {
      cursor = { storeEpoch: "epoch-1", commitSeq: 1 };
    });
    const second = vi.fn(async () => {
      cursor = { storeEpoch: "epoch-1", commitSeq: 2 };
    });
    const registration = (invalidate: () => void | Promise<void>) => ({
      scope,
      consumerKey: "shared",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => cursor,
      invalidate,
    });
    const releaseFirst = stream.registry.register(registration(first));
    const releaseSecond = stream.registry.register(registration(second));
    expect(stream.subscribe).toHaveBeenCalledTimes(1);
    stream.publish(changed(1));
    await flush();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    releaseFirst();
    cursor = { storeEpoch: "epoch-1", commitSeq: 1 };
    stream.publish(changed(2));
    await flush();
    expect(second).toHaveBeenCalledOnce();
    releaseSecond();
    expect(stream.listenerCount()).toBe(0);
  });

  test("uses checkpoint to close the initial-read subscription window", async () => {
    const stream = harness();
    let cursor: ProjectionCursor | null = {
      storeEpoch: "epoch-1",
      commitSeq: 1,
    };
    const invalidate = vi.fn(async () => {
      cursor = { storeEpoch: "epoch-1", commitSeq: 2 };
    });
    stream.registry.register({
      scope,
      consumerKey: "checkpointed-query",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => cursor,
      invalidate,
    });
    stream.publish({
      version: 1,
      kind: "checkpoint",
      scope,
      cursor: { storeEpoch: "epoch-1", commitSeq: 2 },
    });
    await flush();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  test("replays the latest scope cursor to a consumer joining an existing stream", async () => {
    const stream = harness();
    stream.registry.register({
      scope,
      consumerKey: "existing-consumer",
      getDependencies: () => ({ pageIds: ["other-page"] }),
      getCursor: () => ({ storeEpoch: "epoch-1", commitSeq: 1 }),
      invalidate: vi.fn(),
    });
    stream.publish(changed(2));
    await flush();

    let cursor: ProjectionCursor | null = {
      storeEpoch: "epoch-1",
      commitSeq: 1,
    };
    const invalidate = vi.fn(() => {
      cursor = { storeEpoch: "epoch-1", commitSeq: 2 };
    });
    stream.registry.register({
      scope,
      consumerKey: "late-consumer",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => cursor,
      invalidate,
    });
    await flush();

    expect(stream.subscribe).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  test("reads dependencies dynamically and ignores duplicate or older satisfied cursors", async () => {
    const stream = harness();
    let pageId = "page-1";
    let cursor: ProjectionCursor = {
      storeEpoch: "epoch-1",
      commitSeq: 0,
    };
    const invalidate = vi.fn((message: ProjectionStreamMessage) => {
      cursor = message.cursor;
    });
    stream.registry.register({
      scope,
      consumerKey: "dynamic-query",
      getDependencies: () => ({ pageIds: [pageId] }),
      getCursor: () => cursor,
      invalidate,
    });
    stream.publish(changed(1, impact({ page_ids: ["page-2"] })));
    await flush();
    pageId = "page-2";
    stream.publish(changed(2, impact({ page_ids: ["page-2"] })));
    await flush();
    stream.publish(changed(2, impact({ page_ids: ["page-2"] })));
    stream.publish(changed(1, impact({ page_ids: ["page-2"] })));
    await flush();

    expect(invalidate).toHaveBeenCalledOnce();
    expect(cursor.commitSeq).toBe(2);
  });

  test("coalesces events during a read into one necessary trailing read", async () => {
    const stream = harness();
    let cursor: ProjectionCursor | null = {
      storeEpoch: "epoch-1",
      commitSeq: 1,
    };
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const invalidate = vi.fn(async () => {
      if (invalidate.mock.calls.length === 1) {
        await firstRead;
        return;
      }
      cursor = { storeEpoch: "epoch-1", commitSeq: 3 };
    });
    stream.registry.register({
      scope,
      consumerKey: "in-flight-query",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => cursor,
      invalidate,
    });
    stream.publish(changed(2));
    stream.publish(changed(3));
    releaseFirst();
    await flush();
    await flush();
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(cursor?.commitSeq).toBe(3);
  });

  test("skips a trailing read when the completed snapshot already covers pending work", async () => {
    const stream = harness();
    let cursor: ProjectionCursor | null = {
      storeEpoch: "epoch-1",
      commitSeq: 1,
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invalidate = vi.fn(async () => {
      await gate;
      cursor = { storeEpoch: "epoch-1", commitSeq: 3 };
    });
    stream.registry.register({
      scope,
      consumerKey: "covered-query",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => cursor,
      invalidate,
    });
    stream.publish(changed(2));
    stream.publish(changed(3));
    release();
    await flush();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  test("retries one transient callback failure without losing the required cursor", async () => {
    const stream = harness();
    let cursor: ProjectionCursor = {
      storeEpoch: "epoch-1",
      commitSeq: 1,
    };
    const invalidate = vi.fn(async (message: ProjectionStreamMessage) => {
      if (invalidate.mock.calls.length === 1) throw new Error("temporary read failure");
      cursor = message.cursor;
    });
    stream.registry.register({
      scope,
      consumerKey: "retrying-query",
      getDependencies: () => ({ pageIds: ["page-1"] }),
      getCursor: () => cursor,
      invalidate,
    });

    stream.publish(changed(2));
    await flush();

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(cursor.commitSeq).toBe(2);
  });

  test("keeps retrying a failed required read when no newer event arrives", async () => {
    vi.useFakeTimers();
    try {
      const stream = harness();
      let cursor: ProjectionCursor = {
        storeEpoch: "epoch-1",
        commitSeq: 1,
      };
      const invalidate = vi.fn(async (message: ProjectionStreamMessage) => {
        if (invalidate.mock.calls.length < 3) throw new Error("read unavailable");
        cursor = message.cursor;
      });
      const release = stream.registry.register({
        scope,
        consumerKey: "eventually-readable-query",
        getDependencies: () => ({ pageIds: ["page-1"] }),
        getCursor: () => cursor,
        invalidate,
      });

      stream.publish(changed(2));
      await vi.runAllTimersAsync();
      expect(invalidate).toHaveBeenCalledTimes(3);
      expect(cursor.commitSeq).toBe(2);
      release();
    } finally {
      vi.useRealTimers();
    }
  });

  test("isolates callbacks and treats resync, All, and epoch changes as scope-wide", async () => {
    const stream = harness();
    const failing = vi.fn(async () => {
      throw new Error("consumer failed");
    });
    let healthyCursor: ProjectionCursor = {
      storeEpoch: "epoch-1",
      commitSeq: 1,
    };
    const healthy = vi.fn((message: ProjectionStreamMessage) => {
      healthyCursor = message.cursor;
    });
    stream.registry.register({
      scope,
      consumerKey: "failing",
      getDependencies: () => ({ pageIds: ["unrelated"] }),
      getCursor: () => ({ storeEpoch: "epoch-1", commitSeq: 1 }),
      invalidate: failing,
    });
    stream.registry.register({
      scope,
      consumerKey: "healthy",
      getDependencies: () => ({ pageIds: ["unrelated"] }),
      getCursor: () => healthyCursor,
      invalidate: healthy,
    });
    stream.publish(changed(2, { kind: "all" }));
    await flush();
    stream.publish({
      version: 1,
      kind: "resync",
      scope,
      cursor: { storeEpoch: "epoch-1", commitSeq: 3 },
      reason: "reconnect",
    });
    await flush();
    stream.publish(changed(1, impact({ page_ids: ["other"] }), "epoch-2"));
    await flush();
    expect(failing).toHaveBeenCalledTimes(6);
    expect(healthy).toHaveBeenCalledTimes(3);
  });
});
