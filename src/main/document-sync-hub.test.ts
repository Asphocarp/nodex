import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness.js";
import type {
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
} from "../shared/block-documents/document-sync";
import {
  DocumentSyncHub,
  type DocumentSyncClientTarget,
  type DocumentSyncDurableBackend,
} from "./document-sync-hub";

class FakeTarget extends EventEmitter implements DocumentSyncClientTarget {
  readonly sent: Array<{ readonly channel: string; readonly value: unknown }> = [];
  private destroyed = false;

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ channel, value: args[0] });
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

const syncResponse = (
  request: DocumentSyncRequest,
): DocumentSyncCommandResult<DocumentSyncResponse> => ({
  ok: true,
  value: {
    documentId: request.documentId,
    storeEpoch: "epoch-1",
    generation: 1,
    headSeq: 0,
    stateVector: new Uint8Array([0]),
    update: new Uint8Array([0]),
  },
});

const applyAck = (
  request: DocumentSyncApplyRequest,
  duplicate = false,
): DocumentSyncCommandResult<DocumentSyncApplyAck> => ({
  ok: true,
  value: {
    documentId: request.documentId,
    storeEpoch: "epoch-1",
    generation: request.generation,
    updateId: request.updateId,
    committedSeq: 1,
    headSeq: 1,
    stateVector: new Uint8Array([1]),
    duplicate,
  },
});

const createBackend = (
  applyUpdate: DocumentSyncDurableBackend["applyUpdate"] = async (request) =>
    applyAck(request),
): DocumentSyncDurableBackend => ({
  sync: async (request) => syncResponse(request),
  applyUpdate,
});

const subscribe = (
  hub: DocumentSyncHub,
  target: FakeTarget,
  documentId: string,
  clientSessionId: string,
): void => {
  const result = hub.subscribe(target, { documentId, clientSessionId });
  expect(result.ok).toBeTrue();
};

const clearSent = (...targets: readonly FakeTarget[]): void => {
  targets.forEach((target) => target.sent.splice(0));
};

describe("DocumentSyncHub", () => {
  test("fans out by document only after the durable apply succeeds", async () => {
    let resolveApply: (
      result: DocumentSyncCommandResult<DocumentSyncApplyAck>,
    ) => void = () => undefined;
    const durableResult = new Promise<
      DocumentSyncCommandResult<DocumentSyncApplyAck>
    >((resolve) => {
      resolveApply = resolve;
    });
    const hub = new DocumentSyncHub(
      createBackend(async () => durableResult),
    );
    const first = new FakeTarget(1);
    const second = new FakeTarget(2);
    const otherDocument = new FakeTarget(3);
    subscribe(hub, first, "doc-1", "session-1");
    subscribe(hub, first, "doc-1", "session-1b");
    subscribe(hub, second, "doc-1", "session-2");
    subscribe(hub, otherDocument, "doc-2", "session-3");
    clearSent(first, second, otherDocument);

    const request: DocumentSyncApplyRequest = {
      documentId: "doc-1",
      storeEpoch: "epoch-1",
      generation: 1,
      updateId: "update-1",
      clientSessionId: "session-1",
      baseHeadSeq: 0,
      touchedBlockIds: ["block-1"],
      update: new Uint8Array([4, 5, 6]),
    };
    const pending = hub.applyUpdate(first, request);
    await Promise.resolve();
    expect(first.sent.length).toBe(0);
    expect(second.sent.length).toBe(0);

    resolveApply(applyAck(request));
    const result = await pending;
    expect(result.ok).toBeTrue();
    expect(first.sent.length).toBe(1);
    expect(second.sent.length).toBe(1);
    expect(otherDocument.sent.length).toBe(0);
    const event = first.sent[0]?.value as DocumentSyncRealtimeEvent;
    expect(event.kind).toBe("document-update");
    if (event.kind === "document-update") {
      expect(Array.from(event.update).join(",")).toBe("4,5,6");
      expect(event.headSeq).toBe(1);
    }
  });

  test("never fans out a typed durable failure or duplicate retry", async () => {
    let mode: "failure" | "duplicate" = "failure";
    const hub = new DocumentSyncHub(
      createBackend(async (request) => {
        if (mode === "failure") {
          return {
            ok: false,
            error: {
              code: "future_base_head",
              message: "future head",
              retryable: true,
              resetRequired: false,
            },
          };
        }
        return applyAck(request, true);
      }),
    );
    const first = new FakeTarget(1);
    const second = new FakeTarget(2);
    subscribe(hub, first, "doc-1", "session-1");
    subscribe(hub, second, "doc-1", "session-2");
    clearSent(first, second);
    const request: DocumentSyncApplyRequest = {
      documentId: "doc-1",
      storeEpoch: "epoch-1",
      generation: 1,
      updateId: "update-1",
      clientSessionId: "session-1",
      baseHeadSeq: 4,
      touchedBlockIds: [],
      update: new Uint8Array([1]),
    };

    const failed = await hub.applyUpdate(first, request);
    expect(failed.ok).toBeFalse();
    if (!failed.ok) {
      expect(failed.error.code).toBe("future_base_head");
    }
    expect(second.sent.length).toBe(0);

    mode = "duplicate";
    const duplicate = await hub.applyUpdate(first, request);
    expect(duplicate.ok).toBeTrue();
    expect(second.sent.length).toBe(0);
  });

  test("maps writer transport failure to a retryable typed result", async () => {
    const hub = new DocumentSyncHub(
      createBackend(async () => {
        throw new Error("worker exited");
      }),
    );
    const target = new FakeTarget(1);
    subscribe(hub, target, "doc-1", "session-1");
    clearSent(target);
    const result = await hub.applyUpdate(target, {
      documentId: "doc-1",
      storeEpoch: "epoch-1",
      generation: 1,
      updateId: "update-1",
      clientSessionId: "session-1",
      baseHeadSeq: 0,
      touchedBlockIds: [],
      update: new Uint8Array([1]),
    });
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.error.code).toBe("transport_unavailable");
      expect(result.error.retryable).toBeTrue();
    }
    expect(target.sent.length).toBe(0);
  });

  test("binds clientSessionId to trusted webContents identity", async () => {
    const hub = new DocumentSyncHub(createBackend());
    const owner = new FakeTarget(1);
    const imposter = new FakeTarget(2);
    subscribe(hub, owner, "doc-1", "session-1");

    const spoofedSubscribe = hub.subscribe(imposter, {
      documentId: "doc-1",
      clientSessionId: "session-1",
    });
    expect(spoofedSubscribe.ok).toBeFalse();
    if (!spoofedSubscribe.ok) {
      expect(spoofedSubscribe.error.code).toBe("unauthorized");
    }
    const spoofedSync = await hub.sync(imposter, {
      documentId: "doc-1",
      clientSessionId: "session-1",
      stateVector: new Uint8Array([0]),
    });
    expect(spoofedSync.ok).toBeFalse();
  });

  test("broadcasts awareness removal when a subscribed window is destroyed", async () => {
    const hub = new DocumentSyncHub(createBackend());
    const first = new FakeTarget(1);
    const second = new FakeTarget(2);
    subscribe(hub, first, "doc-1", "session-1");
    subscribe(hub, second, "doc-1", "session-2");
    await hub.sync(first, {
      documentId: "doc-1",
      clientSessionId: "session-1",
      stateVector: new Uint8Array([0]),
    });
    await hub.sync(second, {
      documentId: "doc-1",
      clientSessionId: "session-2",
      stateVector: new Uint8Array([0]),
    });
    clearSent(first, second);

    const localDocument = new Y.Doc();
    const localAwareness = new Awareness(localDocument);
    localAwareness.setLocalState({ cursor: "alpha" });
    const update = encodeAwarenessUpdate(localAwareness, [localDocument.clientID]);
    const published = hub.publishAwareness(first, {
      documentId: "doc-1",
      clientSessionId: "session-1",
      storeEpoch: "epoch-1",
      generation: 1,
      update,
    });
    expect(published.ok).toBeTrue();

    const remoteDocument = new Y.Doc();
    const remoteAwareness = new Awareness(remoteDocument);
    remoteAwareness.setLocalState(null);
    const addedEvent = second.sent.at(-1)?.value as DocumentSyncRealtimeEvent;
    if (addedEvent.kind === "awareness") {
      applyAwarenessUpdate(remoteAwareness, addedEvent.update, "test-add");
    }
    expect(remoteAwareness.getStates().size).toBe(1);

    first.destroy();
    const removedEvent = second.sent.at(-1)?.value as DocumentSyncRealtimeEvent;
    expect(removedEvent.kind).toBe("awareness");
    if (removedEvent.kind === "awareness") {
      applyAwarenessUpdate(remoteAwareness, removedEvent.update, "test-remove");
    }
    expect(remoteAwareness.getStates().size).toBe(0);

    localAwareness.destroy();
    localDocument.destroy();
    remoteAwareness.destroy();
    remoteDocument.destroy();
  });
});
