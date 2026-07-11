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
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
  DocumentWriteFenceProof,
  RelocateBlocks,
  RelocationCommandResult,
  RelocationIntent,
  RelocationResult,
} from "../shared/block-documents";
import {
  DocumentSyncHub,
  type DocumentSyncClientTarget,
  type DocumentSyncDurableBackend,
} from "./document-sync-hub";

class FakeTarget extends EventEmitter implements DocumentSyncClientTarget {
  readonly sent: Array<{ readonly channel: string; readonly value: unknown }> = [];
  private destroyed = false;
  throwOnSend: ((value: unknown) => boolean) | null = null;

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.throwOnSend?.(args[0])) {
      throw new Error("simulated target send failure");
    }
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

const documentMutationRequest = (
  mutationId: string,
  destructive = false,
): DocumentMutationRequest => ({
  version: 1,
  mutationId,
  projectId: "project-1",
  storeEpoch: "epoch-1",
  actor: { kind: "test" },
  clientSessionId: "agent-session",
  documentId: "doc-source",
  generation: 1,
  expectedHeadSeq: 0,
  operations: destructive
    ? [
        {
          kind: "update_block",
          blockId: "block-1",
          patch: { content: "changed" },
        },
      ]
    : [
        {
          kind: "insert_block",
          block: {
            id: `inserted:${mutationId}`,
            type: "paragraph",
            props: {},
            content: [],
            children: [],
          },
        },
      ],
});

const documentMutationCommitted = (
  request: DocumentMutationRequest,
  options: { readonly duplicate?: boolean; readonly fenced?: boolean } = {},
): DocumentOperationCommandResult => ({
  ok: true,
  value: {
    version: 1,
    mutationKind:
      "operations" in request
        ? "document_operation_batch"
        : "replace_document_from_nfm",
    mutationId: request.mutationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    documentId: request.documentId,
    generation: request.generation,
    baseHeadSeq: request.expectedHeadSeq,
    headSeq: request.expectedHeadSeq + 1,
    touchedBlockIds: options.fenced ? ["block-1"] : ["card-1"],
    createdBlockIds: [],
    deletedBlockIds: [],
    updatedBlockIds: options.fenced ? ["block-1"] : [],
    movedBlockIds: [],
    writeFenceBlockIds: options.fenced ? ["block-1"] : [],
    titleChanged: !options.fenced,
    coordination: options.fenced ? "write_fence" : "merge_friendly",
    changeLogSeq: 9,
    committedAt: "2026-07-11T00:00:00.000Z",
    duplicate: options.duplicate ?? false,
  },
});

const createBackend = (
  applyUpdate: DocumentSyncDurableBackend["applyUpdate"] = async (request) =>
    applyAck(request),
): DocumentSyncDurableBackend => ({
  sync: async (request) => syncResponse(request),
  applyUpdate,
  applyDocumentMutation: async () => {
    throw new Error("Document mutation is not configured");
  },
  lookupCommittedRelocation: async () => ({ ok: true, value: null }),
  prepareRelocationCommand: async () => {
    throw new Error("Relocation preparation is not configured");
  },
  relocateBlocks: async () => {
    throw new Error("Relocation commit is not configured");
  },
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

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition did not settle");
};

const relocationIntent = (
  relocationId = "relocation-1",
): RelocationIntent => ({
  relocationId,
  projectId: "project-1",
  storeEpoch: "epoch-1",
  rootBlockIds: ["block-root"],
  sourceDocumentId: "doc-source",
  sourceGeneration: 1,
  target: {
    kind: "document",
    documentId: "doc-target",
    generation: 1,
    parentBlockId: "target-parent",
  },
});

const relocationCommand = (
  intent: RelocationIntent,
  sourceHeadSeq: number,
  targetHeadSeq: number,
): RelocateBlocks => ({
  ...intent,
  expectedSourceHeadSeq: sourceHeadSeq,
  expectedLocationRevisions: { "block-root": 1 },
  target: {
    ...intent.target,
    expectedHeadSeq: targetHeadSeq,
  },
});

const relocationResult = (
  intent: RelocationIntent,
  duplicate = false,
): RelocationResult => ({
  relocationId: intent.relocationId,
  projectId: intent.projectId,
  storeEpoch: intent.storeEpoch,
  duplicate,
  rootBlockIds: ["block-root"],
  movedBlockIds: ["block-root"],
  finalLocations: {
    "block-root": { kind: "document", documentId: "doc-target" },
  },
  finalLocationRevisions: { "block-root": 2 },
  sourceCommit: {
    documentId: "doc-source",
    generation: 1,
    baseHeadSeq: 2,
    headSeq: 3,
    updateId: "source-relocation-update",
    update: new Uint8Array([7]),
    stateVector: new Uint8Array([3]),
  },
  targetCommit: {
    documentId: "doc-target",
    generation: 1,
    baseHeadSeq: 1,
    headSeq: 2,
    updateId: "target-relocation-update",
    update: new Uint8Array([8]),
    stateVector: new Uint8Array([2]),
  },
  changeLogSeq: 1,
  committedAt: "2026-07-11T00:00:00.000Z",
});

const syncSubscription = async (
  hub: DocumentSyncHub,
  target: FakeTarget,
  documentId: string,
  clientSessionId: string,
): Promise<void> => {
  const result = await hub.sync(target, {
    documentId,
    clientSessionId,
    stateVector: new Uint8Array([0]),
  });
  expect(result.ok).toBeTrue();
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

  test("flushes every source and target surface before one durable relocation commit", async () => {
    const intent = relocationIntent();
    let prepareCalls = 0;
    let relocateCalls = 0;
    const backend: DocumentSyncDurableBackend = {
      ...createBackend(),
      lookupCommittedRelocation: async () => ({ ok: true, value: null }),
      prepareRelocationCommand: async () => {
        prepareCalls += 1;
        return {
          ok: true,
          value:
            prepareCalls === 1
              ? relocationCommand(intent, 0, 0)
              : relocationCommand(intent, 2, 1),
        };
      },
      relocateBlocks: async (): Promise<RelocationCommandResult> => {
        relocateCalls += 1;
        return { ok: true, value: relocationResult(intent) };
      },
    };
    const hub = new DocumentSyncHub(backend);
    const shared = new FakeTarget(10);
    const sourceOnly = new FakeTarget(11);
    const targetOnly = new FakeTarget(12);
    subscribe(hub, shared, "doc-source", "session-shared");
    subscribe(hub, shared, "doc-target", "session-shared");
    subscribe(hub, sourceOnly, "doc-source", "session-source");
    subscribe(hub, targetOnly, "doc-target", "session-target");
    await syncSubscription(hub, shared, "doc-source", "session-shared");
    await syncSubscription(hub, shared, "doc-target", "session-shared");
    await syncSubscription(hub, sourceOnly, "doc-source", "session-source");
    await syncSubscription(hub, targetOnly, "doc-target", "session-target");
    clearSent(shared, sourceOnly, targetOnly);

    const pending = hub.relocate(shared, intent);
    await waitUntil(
      () =>
        [shared, sourceOnly, targetOnly].flatMap((target) => target.sent)
          .filter(
            (sent) =>
              (sent.value as DocumentSyncRealtimeEvent).kind ===
              "relocation-lease-prepare",
          ).length === 4,
    );
    const deliveries = [shared, sourceOnly, targetOnly].flatMap((target) =>
      target.sent
        .map((sent) => sent.value as DocumentSyncRealtimeEvent)
        .filter(
          (
            event,
          ): event is Extract<
            DocumentSyncRealtimeEvent,
            { kind: "relocation-lease-prepare" }
          > => event.kind === "relocation-lease-prepare",
        )
        .map((event) => ({ target, event })),
    );
    for (const [index, delivery] of deliveries.entries()) {
      if (index === deliveries.length - 1) {
        expect(relocateCalls).toBe(0);
      }
      const headSeq =
        delivery.event.documentId === "doc-source"
          ? delivery.event.clientSessionId === "session-shared"
            ? 2
            : 1
          : 1;
      const response = hub.respondToRelocationLease(delivery.target, {
        response: "ack",
        leaseId: delivery.event.leaseId,
        documentId: delivery.event.documentId,
        clientSessionId: delivery.event.clientSessionId,
        storeEpoch: delivery.event.storeEpoch,
        generation: delivery.event.generation,
        headSeq,
      });
      expect(response.ok).toBeTrue();
    }

    const result = await pending;
    expect(result.ok).toBeTrue();
    expect(prepareCalls).toBe(2);
    expect(relocateCalls).toBe(1);
    const sharedKinds = shared.sent.map(
      (sent) => (sent.value as DocumentSyncRealtimeEvent).kind,
    );
    expect(sharedKinds.filter((kind) => kind === "document-update").length).toBe(
      2,
    );
    expect(
      sharedKinds.filter((kind) => kind === "relocation-lease-release").length,
    ).toBe(2);
  });

  test("NACK and timeout cancel the lease before writer mutation and release its fence", async () => {
    const intent = relocationIntent("relocation-nack");
    let relocateCalls = 0;
    const backend: DocumentSyncDurableBackend = {
      ...createBackend(),
      prepareRelocationCommand: async () => ({
        ok: true,
        value: relocationCommand(intent, 2, 0),
      }),
      relocateBlocks: async () => {
        relocateCalls += 1;
        return { ok: true, value: relocationResult(intent) };
      },
    };
    const hub = new DocumentSyncHub(backend);
    const source = new FakeTarget(20);
    subscribe(hub, source, "doc-source", "session-source");
    await syncSubscription(hub, source, "doc-source", "session-source");
    clearSent(source);
    const pending = hub.relocate(source, intent);
    await waitUntil(() =>
      source.sent.some(
        (sent) =>
          (sent.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    );
    const prepare = source.sent
      .map((sent) => sent.value as DocumentSyncRealtimeEvent)
      .find(
        (
          event,
        ): event is Extract<
          DocumentSyncRealtimeEvent,
          { kind: "relocation-lease-prepare" }
        > => event.kind === "relocation-lease-prepare",
      );
    if (!prepare) throw new Error("Missing relocation prepare event");
    const nack = hub.respondToRelocationLease(source, {
      response: "nack",
      leaseId: prepare.leaseId,
      documentId: prepare.documentId,
      clientSessionId: prepare.clientSessionId,
      storeEpoch: prepare.storeEpoch,
      generation: prepare.generation,
      headSeq: 0,
      reason: "surface_prepare_failed",
      message: "IME did not flush",
    });
    expect(nack.ok).toBeTrue();
    const failed = await pending;
    expect(failed.ok).toBeFalse();
    if (!failed.ok) expect(failed.error.code).toBe("relocation_lease_timeout");
    expect(relocateCalls).toBe(0);
    expect(
      source.sent.some(
        (sent) =>
          (sent.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-cancel",
      ),
    ).toBeTrue();
    const afterCancel = new FakeTarget(21);
    expect(
      hub.subscribe(afterCancel, {
        documentId: "doc-source",
        clientSessionId: "session-after-cancel",
      }).ok,
    ).toBeTrue();
    clearSent(source, afterCancel);
    const retry = hub.relocate(source, intent);
    await waitUntil(() =>
      source.sent.some(
        (sent) =>
          (sent.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    );
    const retryPrepare = source.sent
      .map((sent) => sent.value as DocumentSyncRealtimeEvent)
      .find(
        (
          event,
        ): event is Extract<
          DocumentSyncRealtimeEvent,
          { kind: "relocation-lease-prepare" }
        > => event.kind === "relocation-lease-prepare",
      );
    if (!retryPrepare) throw new Error("Missing retry lease prepare event");
    expect(retryPrepare.leaseId === prepare.leaseId).toBeFalse();
    hub.respondToRelocationLease(source, {
      response: "nack",
      leaseId: retryPrepare.leaseId,
      documentId: retryPrepare.documentId,
      clientSessionId: retryPrepare.clientSessionId,
      storeEpoch: retryPrepare.storeEpoch,
      generation: retryPrepare.generation,
      headSeq: retryPrepare.expectedHeadSeq,
      reason: "surface_prepare_failed",
      message: "cancel retry probe",
    });
    expect((await retry).ok).toBeFalse();

    let timeoutCallback: (() => void) | null = null;
    const timeoutIntent = relocationIntent("relocation-timeout");
    const timeoutHub = new DocumentSyncHub(
      {
        ...createBackend(),
        prepareRelocationCommand: async () => ({
          ok: true,
          value: relocationCommand(timeoutIntent, 0, 0),
        }),
      },
      {
        relocationLease: {
          clock: { now: () => 1_000 },
          timers: {
            setTimeout: (callback) => {
              timeoutCallback = callback;
              return 1;
            },
            clearTimeout: () => undefined,
          },
        },
      },
    );
    const timeoutSource = new FakeTarget(22);
    subscribe(
      timeoutHub,
      timeoutSource,
      "doc-source",
      "session-timeout",
    );
    await syncSubscription(
      timeoutHub,
      timeoutSource,
      "doc-source",
      "session-timeout",
    );
    const timedPending = timeoutHub.relocate(timeoutSource, timeoutIntent);
    await waitUntil(() => timeoutCallback !== null);
    const fireTimeout = timeoutCallback as (() => void) | null;
    if (!fireTimeout) throw new Error("Missing lease timeout callback");
    fireTimeout();
    const timedOut = await timedPending;
    expect(timedOut.ok).toBeFalse();
    if (!timedOut.ok) {
      expect(timedOut.error.code).toBe("relocation_lease_timeout");
    }
  });

  test("committed retry skips lease and mutation while forcing state-vector resync", async () => {
    const intent = relocationIntent("relocation-duplicate");
    const committed = relocationResult(intent, true);
    let prepareCalls = 0;
    let relocateCalls = 0;
    const hub = new DocumentSyncHub({
      ...createBackend(),
      lookupCommittedRelocation: async () => ({
        ok: true,
        value: committed,
      }),
      prepareRelocationCommand: async () => {
        prepareCalls += 1;
        return { ok: true, value: relocationCommand(intent, 0, 0) };
      },
      relocateBlocks: async () => {
        relocateCalls += 1;
        return { ok: true, value: committed };
      },
    });
    const source = new FakeTarget(30);
    subscribe(hub, source, "doc-source", "session-source");
    await syncSubscription(hub, source, "doc-source", "session-source");
    clearSent(source);
    const result = await hub.relocate(source, intent);
    expect(result.ok).toBeTrue();
    if (result.ok) expect(result.value.duplicate).toBeTrue();
    expect(prepareCalls).toBe(0);
    expect(relocateCalls).toBe(0);
    expect(
      source.sent.some(
        (sent) =>
          (sent.value as DocumentSyncRealtimeEvent).kind === "resync-required",
      ),
    ).toBeTrue();
  });

  test("authorization and post-commit fanout failures never create a retryable mutation seam", async () => {
    const intent = relocationIntent("relocation-fanout");
    let lookupCalls = 0;
    const backend: DocumentSyncDurableBackend = {
      ...createBackend(),
      lookupCommittedRelocation: async () => {
        lookupCalls += 1;
        return { ok: true, value: null };
      },
      prepareRelocationCommand: async () => ({
        ok: true,
        value: relocationCommand(intent, 0, 0),
      }),
      relocateBlocks: async () => ({
        ok: true,
        value: relocationResult(intent),
      }),
    };
    const hub = new DocumentSyncHub(backend);
    const attacker = new FakeTarget(40);
    const unauthorized = await hub.relocate(attacker, intent);
    expect(unauthorized.ok).toBeFalse();
    expect(lookupCalls).toBe(0);

    const source = new FakeTarget(41);
    subscribe(hub, source, "doc-source", "session-source");
    await syncSubscription(hub, source, "doc-source", "session-source");
    clearSent(source);
    source.throwOnSend = (value) =>
      (value as DocumentSyncRealtimeEvent).kind === "document-update";
    const pending = hub.relocate(source, intent);
    await waitUntil(() =>
      source.sent.some(
        (sent) =>
          (sent.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    );
    const prepare = source.sent
      .map((sent) => sent.value as DocumentSyncRealtimeEvent)
      .find(
        (
          event,
        ): event is Extract<
          DocumentSyncRealtimeEvent,
          { kind: "relocation-lease-prepare" }
        > => event.kind === "relocation-lease-prepare",
      );
    if (!prepare) throw new Error("Missing relocation prepare event");
    const spoofed = hub.respondToRelocationLease(attacker, {
      response: "ack",
      leaseId: prepare.leaseId,
      documentId: prepare.documentId,
      clientSessionId: prepare.clientSessionId,
      storeEpoch: prepare.storeEpoch,
      generation: prepare.generation,
      headSeq: prepare.expectedHeadSeq,
    });
    expect(spoofed.ok).toBeFalse();
    if (!spoofed.ok) expect(spoofed.error.code).toBe("unauthorized");
    expect(
      hub.respondToRelocationLease(source, {
        response: "ack",
        leaseId: prepare.leaseId,
        documentId: prepare.documentId,
        clientSessionId: prepare.clientSessionId,
        storeEpoch: prepare.storeEpoch,
        generation: prepare.generation,
        headSeq: prepare.expectedHeadSeq,
      }).ok,
    ).toBeTrue();
    const result = await pending;
    expect(result.ok).toBeTrue();
    if (result.ok) expect(result.value.duplicate).toBeFalse();
  });

  test("merge-friendly and duplicate Document mutations commit without a lease", async () => {
    const request = documentMutationRequest("document-mutation-merge");
    let calls = 0;
    const hub = new DocumentSyncHub({
      ...createBackend(),
      applyDocumentMutation: async (received, writeFence) => {
        calls += 1;
        expect(writeFence === undefined).toBeTrue();
        return documentMutationCommitted(received, {
          duplicate: calls === 2,
        });
      },
    });
    const surface = new FakeTarget(50);
    subscribe(hub, surface, "doc-source", "surface-1");
    await syncSubscription(hub, surface, "doc-source", "surface-1");
    clearSent(surface);

    const committed = await hub.applyDocumentMutation(request);
    expect(committed.ok).toBeTrue();
    expect(
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    ).toBeFalse();
    expect(
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "resync-required",
      ),
    ).toBeTrue();

    clearSent(surface);
    const duplicate = await hub.applyDocumentMutation(request);
    expect(duplicate.ok).toBeTrue();
    if (duplicate.ok) expect(duplicate.value.duplicate).toBeTrue();
    expect(calls).toBe(2);
    expect(
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "resync-required",
      ),
    ).toBeTrue();
  });

  test("structural Document mutation flushes and freezes every mounted surface", async () => {
    const request = documentMutationRequest("document-mutation-fenced", true);
    const proofs: Array<DocumentWriteFenceProof | undefined> = [];
    const hub = new DocumentSyncHub({
      ...createBackend(),
      applyDocumentMutation: async (received, writeFence) => {
        proofs.push(writeFence);
        if (!writeFence) {
          return {
            ok: false,
            error: {
              code: "write_fence_required",
              message: "fence required",
              retryable: true,
              mutationId: received.mutationId,
              expectedGeneration: received.generation,
              expectedHeadSeq: received.expectedHeadSeq,
            },
          };
        }
        return documentMutationCommitted(received, { fenced: true });
      },
    });
    const left = new FakeTarget(51);
    const right = new FakeTarget(52);
    subscribe(hub, left, "doc-source", "surface-left");
    subscribe(hub, right, "doc-source", "surface-right");
    await syncSubscription(hub, left, "doc-source", "surface-left");
    await syncSubscription(hub, right, "doc-source", "surface-right");
    clearSent(left, right);

    const pending = hub.applyDocumentMutation(request);
    await waitUntil(() =>
      [left, right].every((surface) =>
        surface.sent.some(
          (delivery) =>
            (delivery.value as DocumentSyncRealtimeEvent).kind ===
            "relocation-lease-prepare",
        ),
      ),
    );
    for (const surface of [left, right]) {
      const prepare = surface.sent
        .map((delivery) => delivery.value as DocumentSyncRealtimeEvent)
        .find(
          (
            event,
          ): event is Extract<
            DocumentSyncRealtimeEvent,
            { kind: "relocation-lease-prepare" }
          > => event.kind === "relocation-lease-prepare",
        );
      if (!prepare) throw new Error("Missing Document write lease prepare");
      expect(
        hub.respondToRelocationLease(surface, {
          response: "ack",
          leaseId: prepare.leaseId,
          documentId: prepare.documentId,
          clientSessionId: prepare.clientSessionId,
          storeEpoch: prepare.storeEpoch,
          generation: prepare.generation,
          headSeq: prepare.expectedHeadSeq,
        }).ok,
      ).toBeTrue();
    }

    const result = await pending;
    expect(result.ok).toBeTrue();
    expect(proofs.length).toBe(2);
    expect(proofs[0] === undefined).toBeTrue();
    expect(proofs[1]?.documentId).toBe("doc-source");
    expect(proofs[1]?.headSeq).toBe(0);
    for (const surface of [left, right]) {
      const eventKinds = surface.sent.map(
        (delivery) => (delivery.value as DocumentSyncRealtimeEvent).kind,
      );
      expect(eventKinds.includes("resync-required")).toBeTrue();
      expect(eventKinds.includes("relocation-lease-release")).toBeTrue();
    }
  });

  test("a lease flush that advances the head aborts the original CAS", async () => {
    const request = documentMutationRequest("document-mutation-stale", true);
    let calls = 0;
    const hub = new DocumentSyncHub({
      ...createBackend(),
      applyDocumentMutation: async (received) => {
        calls += 1;
        return {
          ok: false,
          error: {
            code: "write_fence_required",
            message: "fence required",
            retryable: true,
            mutationId: received.mutationId,
            expectedGeneration: received.generation,
            expectedHeadSeq: received.expectedHeadSeq,
          },
        };
      },
    });
    const surface = new FakeTarget(53);
    subscribe(hub, surface, "doc-source", "surface-stale");
    await syncSubscription(hub, surface, "doc-source", "surface-stale");
    clearSent(surface);

    const pending = hub.applyDocumentMutation(request);
    await waitUntil(() =>
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    );
    const prepare = surface.sent
      .map((delivery) => delivery.value as DocumentSyncRealtimeEvent)
      .find(
        (
          event,
        ): event is Extract<
          DocumentSyncRealtimeEvent,
          { kind: "relocation-lease-prepare" }
        > => event.kind === "relocation-lease-prepare",
      );
    if (!prepare) throw new Error("Missing stale write lease prepare");
    expect(
      hub.respondToRelocationLease(surface, {
        response: "ack",
        leaseId: prepare.leaseId,
        documentId: prepare.documentId,
        clientSessionId: prepare.clientSessionId,
        storeEpoch: prepare.storeEpoch,
        generation: prepare.generation,
        headSeq: prepare.expectedHeadSeq + 1,
      }).ok,
    ).toBeTrue();

    const result = await pending;
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.error.code).toBe("document_head_conflict");
      expect(result.error.expectedHeadSeq).toBe(0);
      expect(result.error.actualHeadSeq).toBe(1);
      expect(result.error.retryable).toBeFalse();
    }
    expect(calls).toBe(1);
    expect(
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-cancel",
      ),
    ).toBeTrue();
  });
});
