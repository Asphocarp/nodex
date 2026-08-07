import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeAll, describe, expect, test } from "vitest";
import {
  CANVAS_SCENE_OUTBOX_DATABASE_NAME,
  IndexedDbCanvasSceneOutbox,
  MemoryCanvasSceneOutbox,
  type CanvasSceneOutbox,
} from "./canvas-scene-outbox";
import type {
  CanvasSceneMutationIntent,
  CanvasSceneMutationRequest,
} from "../../shared/block-documents";

beforeAll(() => {
  Object.defineProperty(globalThis, "IDBKeyRange", {
    configurable: true,
    value: IDBKeyRange,
  });
});

const intent = (
  mutationId: string,
  version: number,
  documentId = "document-1",
): CanvasSceneMutationIntent => ({
  version: 1,
  mutationId,
  projectId: "project-1",
  documentId,
  storeEpoch: "epoch-1",
  generation: 1,
  baseHeadSeq: version - 1,
  elementCandidates: [{
    id: `element-${mutationId}`,
    type: "rectangle",
    index: `a${version}`,
    version,
    versionNonce: 10,
    isDeleted: false,
  }],
  appStateIntents: {},
  fileAdditions: {},
});

const versionOneRequest = (
  mutationId: string,
  version: number,
): CanvasSceneMutationRequest => ({
  ...intent(mutationId, version),
  clientSessionId: "dead-window",
});

const verifyFifoAndIdempotence = async (
  outbox: CanvasSceneOutbox,
): Promise<void> => {
  const second = intent("mutation-z", 2);
  const first = intent("mutation-a", 1);
  await outbox.put(second);
  await outbox.put(first);
  await outbox.put(second);

  expect((await outbox.list("document-1")).map((entry) => entry.mutationId))
    .toEqual(["mutation-z", "mutation-a"]);
  await expect(
    outbox.put({
      ...second,
      elementCandidates: [{
        ...second.elementCandidates[0]!,
        version: 3,
      }],
    }),
  ).rejects.toThrow("already exists");

  await outbox.remove("document-1", "mutation-z");
  await outbox.remove("document-1", "mutation-z");
  expect((await outbox.list("document-1")).map((entry) => entry.mutationId))
    .toEqual(["mutation-a"]);
};

const verifyQuarantine = async (
  outbox: CanvasSceneOutbox,
): Promise<void> => {
  const rejected = intent("mutation-rejected", 1);
  await outbox.put(rejected);
  await outbox.quarantine(rejected, {
    code: "invalid_canvas_scene_mutation",
    message: "invalid image assertion",
    retryable: false,
    resetRequired: false,
    mutationId: rejected.mutationId,
  }, 123);

  expect(await outbox.list("document-1")).toEqual([]);
  expect(await outbox.listQuarantined("document-1")).toEqual([{
    intent: rejected,
    error: {
      code: "invalid_canvas_scene_mutation",
      message: "invalid image assertion",
      retryable: false,
      resetRequired: false,
      mutationId: rejected.mutationId,
    },
    rejectedAt: 123,
  }]);
  await outbox.quarantine(rejected, {
    code: "invalid_canvas_scene_mutation",
    message: "duplicate quarantine",
    retryable: false,
    resetRequired: false,
  }, 456);
  expect(await outbox.listQuarantined("document-1")).toHaveLength(1);
};

const openVersionOneDatabase = (
  factory: IDBFactory,
  rows: readonly unknown[],
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = factory.open(CANVAS_SCENE_OUTBOX_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(
        "canvas-scene-mutations",
        { keyPath: "key" },
      );
      store.createIndex("document-id", "documentId", { unique: false });
      for (const [index, row] of rows.entries()) {
        const mutationId = `mutation-${index + 1}`;
        store.add({
          key: JSON.stringify(["document-1", mutationId]),
          documentId: "document-1",
          mutationId,
          request: row,
        });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });

describe("CanvasSceneOutbox", () => {
  test("memory storage preserves enqueue order and duplicate position", async () => {
    await verifyFifoAndIdempotence(new MemoryCanvasSceneOutbox());
  });

  test("memory storage atomically quarantines a rejected mutation", async () => {
    await verifyQuarantine(new MemoryCanvasSceneOutbox());
  });

  test("IndexedDB v3 preserves enqueue order and duplicate position", async () => {
    await verifyFifoAndIdempotence(
      new IndexedDbCanvasSceneOutbox(new IDBFactory()),
    );
  });

  test("IndexedDB v3 atomically quarantines a rejected mutation", async () => {
    await verifyQuarantine(
      new IndexedDbCanvasSceneOutbox(new IDBFactory()),
    );
  });

  test("migrates valid v1 requests to delivery-neutral v2 intents", async () => {
    const factory = new IDBFactory();
    await openVersionOneDatabase(factory, [
      versionOneRequest("mutation-1", 1),
      versionOneRequest("mutation-2", 2),
    ]);

    const outbox = new IndexedDbCanvasSceneOutbox(factory);
    const migrated = await outbox.list("document-1");

    expect(migrated.map((entry) => entry.mutationId)).toEqual([
      "mutation-1",
      "mutation-2",
    ]);
    expect(migrated).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientSessionId: "dead-window" }),
      ]),
    );
  });

  test("fails a v1 upgrade visibly when a row is invalid", async () => {
    const factory = new IDBFactory();
    await openVersionOneDatabase(factory, [
      { ...versionOneRequest("mutation-1", 1), elementCandidates: null },
    ]);

    await expect(
      new IndexedDbCanvasSceneOutbox(factory).list("document-1"),
    ).rejects.toThrow();
  });
});
