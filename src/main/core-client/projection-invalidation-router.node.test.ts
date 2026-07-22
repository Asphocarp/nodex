import { describe, expect, test, vi } from "vitest";
import type { ProjectionImpact, ProjectionStreamMessage } from "../../shared/projection-stream";
import type { CoreEventEnvelope } from "./types";
import { ProjectionInvalidationRouter } from "./projection-invalidation-router";

const resources = (pageId: string): ProjectionImpact => ({
  kind: "resources",
  page_ids: [pageId],
  database_ids: ["database-1"],
  data_source_ids: ["source-1"],
  view_ids: ["view-1"],
  document_heads: [],
});

const envelope = (
  sequence: number,
  impact: ProjectionImpact,
): CoreEventEnvelope => ({
  protocol_version: 2,
  event: {
    version: 2,
    sequence,
    store_epoch: "epoch-1",
    committed_at: "2026-07-22T00:00:00.000Z",
    projection_impact: impact,
    payload: {
      module: "project_workspace",
      event: {
        kind: "workspace_changed",
        project_ids: [],
        session_ids: [],
        thread_ids: [],
        session_summary_scopes: [],
        session_detail_ids: [],
      },
    },
  },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const flush = async () => await new Promise((resolve) => setTimeout(resolve, 0));

describe("ProjectionInvalidationRouter", () => {
  test("maps only top-level impact and emits no changed message for None", async () => {
    const messages: ProjectionStreamMessage[] = [];
    const router = new ProjectionInvalidationRouter({
      libraryId: "library-1",
      initialCursor: { storeEpoch: "epoch-1", changeLogSeq: 0 },
      filterForProject: async (_projectId, impact) => impact,
    });
    router.subscribe(
      { kind: "library", libraryId: "library-1" },
      (message) => messages.push(message),
    );
    await router.accept(envelope(1, resources("page-from-impact")));
    await router.accept(envelope(2, { kind: "none" }));

    expect(messages.map((message) => message.kind)).toEqual([
      "checkpoint",
      "changed",
    ]);
    expect(messages[1]).toMatchObject({
      kind: "changed",
      impact: { page_ids: ["page-from-impact"] },
    });
    expect(router.cursor.changeLogSeq).toBe(2);
  });

  test("orders async Project authorization and fails closed per scope", async () => {
    const first = deferred<ProjectionImpact>();
    const second = deferred<ProjectionImpact>();
    const messages: ProjectionStreamMessage[] = [];
    let call = 0;
    const router = new ProjectionInvalidationRouter({
      libraryId: "library-1",
      initialCursor: { storeEpoch: "epoch-1", changeLogSeq: 0 },
      filterForProject: async () => {
        call += 1;
        if (call === 1) return await first.promise;
        if (call === 2) return await second.promise;
        throw new Error("authorization unavailable");
      },
    });
    router.subscribe(
      { kind: "project", libraryId: "library-1", projectId: "project-1" },
      (message) => messages.push(message),
    );
    const acceptedFirst = router.accept(envelope(1, resources("page-1")));
    const acceptedSecond = router.accept(envelope(2, resources("page-2")));
    await flush();
    expect(call).toBe(1);
    first.resolve(resources("authorized-1"));
    await flush();
    expect(call).toBe(2);
    second.resolve(resources("authorized-2"));
    await Promise.all([acceptedFirst, acceptedSecond]);
    await router.accept(envelope(3, resources("page-3")));

    expect(messages.map((message) => [message.kind, message.cursor.changeLogSeq]))
      .toEqual([
        ["checkpoint", 0],
        ["changed", 1],
        ["changed", 2],
        ["resync", 3],
      ]);
    expect(messages[3]).toMatchObject({
      reason: "authorization_filter_failed",
    });
  });

  test("places a new listener checkpoint behind already accepted Project work", async () => {
    const gate = deferred<ProjectionImpact>();
    const messages: ProjectionStreamMessage[] = [];
    const router = new ProjectionInvalidationRouter({
      libraryId: "library-1",
      initialCursor: { storeEpoch: "epoch-1", changeLogSeq: 0 },
      filterForProject: async () => await gate.promise,
    });
    const scope = {
      kind: "project" as const,
      libraryId: "library-1",
      projectId: "project-1",
    };
    const firstRelease = router.subscribe(scope, () => undefined);
    await flush();
    const accepted = router.accept(envelope(1, resources("page-1")));
    router.subscribe(scope, (message) => messages.push(message));
    gate.resolve(resources("page-1"));
    await accepted;
    await flush();
    firstRelease();

    expect(messages.map((message) => [message.kind, message.cursor.changeLogSeq]))
      .toEqual([
        ["changed", 1],
        ["checkpoint", 1],
      ]);
  });

  test("isolates listener exceptions", async () => {
    const healthy = vi.fn();
    const listenerErrors = vi.fn();
    const router = new ProjectionInvalidationRouter({
      libraryId: "library-1",
      initialCursor: { storeEpoch: "epoch-1", changeLogSeq: 0 },
      filterForProject: async (_projectId, impact) => impact,
      onListenerError: listenerErrors,
    });
    const scope = { kind: "library" as const, libraryId: "library-1" };
    router.subscribe(scope, () => {
      throw new Error("listener failed");
    });
    router.subscribe(scope, healthy);
    await router.accept(envelope(1, { kind: "all" }));

    expect(healthy).toHaveBeenCalledTimes(2);
    expect(listenerErrors).toHaveBeenCalledTimes(2);
  });
});
