import { describe, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
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
  ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  encodeAdditionalDocumentCommandSemanticHashInput,
  type AdditionalDocumentCommandRequest,
  type AdditionalDocumentCommandResult,
} from "../shared/additional-document-commands";
import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneMutationRequest,
} from "../shared/block-documents/canvas-scene-sync";
import type {
  BlockTransferIntent,
  BlockTransferPreparation,
  BlockTransferReceipt,
} from "../shared/block-transfer";
import {
  CreateInputSchema,
  CreatePagesV3InputSchema,
  CreatePagesV3OutputSchema,
  type NodexAgentCreatePagesCommand,
} from "../shared/nodex-agent-tools";
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
        : "nfm" in request
          ? "replace_document_from_nfm"
          : "document_version_restore",
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

const additionalDocumentRequest = (
  operationId = "additional:promote",
): AdditionalDocumentCommandRequest => ({
  version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  operationId,
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "agent-session",
  actor: { kind: "test" },
  coordination: {
    kind: "hub_lease",
    leaseId: "caller-supplied-lease",
    documents: [
      { documentId: "doc-source", generation: 1, headSeq: 1 },
    ],
  },
  operation: {
    kind: "promote_synced_source",
    host: { documentId: "doc-source", generation: 1 },
    rootBlockId: "block-root",
    referenceBlockId: "synced-reference",
    sourceBlockId: "synced-source",
    sourceDocumentId: "doc-synced-source",
  },
});

const additionalDocumentCommitted = (
  request: AdditionalDocumentCommandRequest,
): AdditionalDocumentCommandResult => ({
  ok: true,
  value: {
    version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operationKind: request.operation.kind,
    semanticHash: createHash("sha256")
      .update(encodeAdditionalDocumentCommandSemanticHashInput(request))
      .digest("hex"),
    duplicate: false,
    effect: {
      createdBlockIds: ["synced-reference", "synced-source"],
      preservedBlockIds: ["block-root"],
      deletedBlockIds: [],
      documentHeads: [
        { documentId: "doc-source", generation: 1, headSeq: 2 },
        { documentId: "doc-synced-source", generation: 1, headSeq: 1 },
      ],
    },
    changeLogSeq: 12,
    committedAt: "2026-07-12T00:00:00.000Z",
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

const nodexAgentCreateCardsCommand = (): NodexAgentCreatePagesCommand => {
  const pageInput = CreateInputSchema.parse({
    resource: { kind: "page", title: { kind: "plain", text: "Created" } },
    destination: {
      kind: "document",
      documentId: "doc-source",
      at: { kind: "end" },
    },
  });
  return {
    threadId: "thread-1",
    callId: "call-create-cards",
    projectId: "project-1",
    requestHash: "c".repeat(64),
    mutationId: "nodex-create-cards:test",
    storeEpoch: "epoch-1",
    input: CreatePagesV3InputSchema.parse({
      destination: { kind: "page", pageId: "card-parent" },
      pages: [{ title: "Created A" }, { title: "Created B" }],
    }),
    destination: {
      kind: "document",
      documentId: "doc-source",
      generation: 1,
      expectedHeadSeq: 0,
    },
    pages: [
      {
        input: pageInput,
        pageId: "card-created-a",
        bodyBlockIds: ["body-created-a"],
        primaryMembershipId: "membership-primary-a",
        targetMembershipId: "membership-target-a",
      },
      {
        input: pageInput,
        pageId: "card-created-b",
        bodyBlockIds: ["body-created-b"],
        primaryMembershipId: "membership-primary-b",
        targetMembershipId: "membership-target-b",
      },
    ],
  };
};

const subscribe = (
  hub: DocumentSyncHub,
  target: FakeTarget,
  documentId: string,
  clientSessionId: string,
): void => {
  const result = hub.subscribe(target, { documentId, clientSessionId });
  expect(result.ok).toBe(true);
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

const blockTransferIntent = (): BlockTransferIntent => ({
  version: 2,
  operationId: "block-transfer-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "transfer-caller",
  actor: { kind: "test" },
  mode: "copy",
  rootBlockIds: ["card-source"],
  source: { kind: "data_source", dataSourceId: "source-a" },
  target: { kind: "document", documentId: "doc-target" },
});

const blockTransferPreparation = (
  intent: BlockTransferIntent,
  ownedHeadSeq: number,
  targetHeadSeq: number,
): BlockTransferPreparation => ({
  request: {
    ...intent,
    version: 1,
    expectedLocationRevisions: { "card-source": 1 },
    source: {
      kind: "database",
      databaseBlockId: "database-source",
      dataSourceId: "source-a",
      memberships: {
        "card-source": { membershipId: "membership-source", revision: 1 },
      },
    },
    target: {
      kind: "document",
      documentId: "doc-target",
      generation: 1,
      expectedHeadSeq: targetHeadSeq,
    },
  },
  leaseDocuments: [
    {
      documentId: "doc-owned-source",
      generation: 1,
      expectedHeadSeq: ownedHeadSeq,
    },
    {
      documentId: "doc-target",
      generation: 1,
      expectedHeadSeq: targetHeadSeq,
    },
  ],
});

const blockTransferReceipt = (
  intent: BlockTransferIntent,
  duplicate: boolean,
): BlockTransferReceipt => ({
  version: 1,
  operationId: intent.operationId,
  projectId: intent.projectId,
  storeEpoch: intent.storeEpoch,
  mode: intent.mode,
  duplicate,
  sourceRootBlockIds: ["card-source"],
  resultRootBlockIds: ["card-copy"],
  copiedBlockIds: { "card-source": "card-copy" },
  transformationEvidence: [],
  finalLocations: {
    "card-copy": { kind: "document", documentId: "doc-target" },
  },
  finalLocationRevisions: { "card-copy": 1 },
  documentCommits: [
    {
      documentId: "doc-target",
      generation: 1,
      baseHeadSeq: 2,
      headSeq: 3,
      updateId: "block-transfer-target-update",
      update: new Uint8Array([9]),
      stateVector: new Uint8Array([3]),
    },
  ],
  affectedDatabaseBlockIds: ["database-source"],
  changeLogSeq: 20,
  committedAt: "2026-07-13T00:00:00.000Z",
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
  expect(result.ok).toBe(true);
};

describe("DocumentSyncHub", () => {
  test("fans out Canvas scene events only after durable mutation ACK", async () => {
    let resolveMutation: (result: CanvasSceneMutationCommandResult) => void =
      () => undefined;
    const durable = new Promise<CanvasSceneMutationCommandResult>((resolve) => {
      resolveMutation = resolve;
    });
    const hub = new DocumentSyncHub({
      ...createBackend(),
      syncCanvasScene: async () => ({
        ok: false,
        error: {
          code: "unknown",
          message: "unused",
          retryable: false,
          resetRequired: false,
        },
      }),
      applyCanvasSceneMutation: async () => durable,
    });
    const first = new FakeTarget(101);
    const second = new FakeTarget(102);
    for (const [target, clientSessionId] of [
      [first, "canvas-session-1"],
      [second, "canvas-session-2"],
    ] as const) {
      const subscribed = hub.subscribeCanvasScene(target, {
        version: 1,
        projectId: "project-1",
        documentId: "canvas-1",
        clientSessionId,
      });
      expect(subscribed.ok).toBe(true);
    }
    const request: CanvasSceneMutationRequest = {
      version: 1,
      mutationId: "canvas-mutation-1",
      projectId: "project-1",
      documentId: "canvas-1",
      storeEpoch: "epoch-1",
      generation: 1,
      baseHeadSeq: 2,
      clientSessionId: "canvas-session-1",
      elementCandidates: [],
      appStateIntents: {},
      fileAdditions: {},
    };
    const pending = hub.applyCanvasSceneMutation(first, request);
    await Promise.resolve();
    expect(first.sent.length).toBe(0);
    expect(second.sent.length).toBe(0);

    resolveMutation({
      ok: true,
      value: {
        version: 1,
        mutationId: request.mutationId,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        baseHeadSeq: request.baseHeadSeq,
        headSeq: 3,
        duplicate: false,
        outcome: "committed",
        sceneHash: "a".repeat(64),
        changedElementIds: [],
        appliedAppStateKeys: [],
        skippedAppStateKeys: [],
        addedFileIds: [],
        removedFileIds: [],
        committedAt: "2026-07-13T00:00:00.000Z",
      },
      event: {
        type: "canvas_scene_committed",
        version: 1,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        mutationId: request.mutationId,
        baseHeadSeq: request.baseHeadSeq,
        headSeq: 3,
        sceneHash: "a".repeat(64),
        elementUpdates: [],
        appState: {},
        fileAdditions: {},
        removedFileIds: [],
      },
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(first.sent[0]?.channel).toBe("document-sync:event");
    expect(second.sent[0]?.channel).toBe("document-sync:event");
  });

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
    expect(result.ok).toBe(true);
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
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.code).toBe("future_base_head");
    }
    expect(second.sent.length).toBe(0);

    mode = "duplicate";
    const duplicate = await hub.applyUpdate(first, request);
    expect(duplicate.ok).toBe(true);
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
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("transport_unavailable");
      expect(result.error.retryable).toBe(true);
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
    expect(spoofedSubscribe.ok).toBe(false);
    if (!spoofedSubscribe.ok) {
      expect(spoofedSubscribe.error.code).toBe("unauthorized");
    }
    const spoofedSync = await hub.sync(imposter, {
      documentId: "doc-1",
      clientSessionId: "session-1",
      stateVector: new Uint8Array([0]),
    });
    expect(spoofedSync.ok).toBe(false);
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
    expect(published.ok).toBe(true);

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
      expect(response.ok).toBe(true);
    }

    const result = await pending;
    expect(result.ok).toBe(true);
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
    expect(nack.ok).toBe(true);
    const failed = await pending;
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("relocation_lease_timeout");
    expect(relocateCalls).toBe(0);
    expect(
      source.sent.some(
        (sent) =>
          (sent.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-cancel",
      ),
    ).toBe(true);
    const afterCancel = new FakeTarget(21);
    expect(
      hub.subscribe(afterCancel, {
        documentId: "doc-source",
        clientSessionId: "session-after-cancel",
      }).ok,
    ).toBe(true);
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
    expect(retryPrepare.leaseId === prepare.leaseId).toBe(false);
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
    expect((await retry).ok).toBe(false);

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
    expect(timedOut.ok).toBe(false);
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
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.duplicate).toBe(true);
    expect(prepareCalls).toBe(0);
    expect(relocateCalls).toBe(0);
    expect(
      source.sent.some(
        (sent) =>
          (sent.value as DocumentSyncRealtimeEvent).kind === "resync-required",
      ),
    ).toBe(true);
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
    expect(unauthorized.ok).toBe(false);
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
    expect(spoofed.ok).toBe(false);
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
    ).toBe(true);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.duplicate).toBe(false);
  });

  test("merge-friendly and duplicate Document mutations commit without a lease", async () => {
    const request = documentMutationRequest("document-mutation-merge");
    let calls = 0;
    const hub = new DocumentSyncHub({
      ...createBackend(),
      applyDocumentMutation: async (received, writeFence) => {
        calls += 1;
        expect(writeFence === undefined).toBe(true);
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
    expect(committed.ok).toBe(true);
    expect(
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    ).toBe(false);
    expect(
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "resync-required",
      ),
    ).toBe(true);

    clearSent(surface);
    const duplicate = await hub.applyDocumentMutation(request);
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) expect(duplicate.value.duplicate).toBe(true);
    expect(calls).toBe(2);
    expect(
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "resync-required",
      ),
    ).toBe(true);
  });

  test("coordinates checkpoint restore as a first-class fenced mutation", async () => {
    const request: DocumentMutationRequest = {
      version: 1,
      mutationId: "document-version-restore-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      actor: { kind: "test" },
      clientSessionId: "agent-session",
      documentId: "doc-source",
      versionId: `document-version:${"a".repeat(64)}`,
      generation: 1,
      expectedHeadSeq: 0,
    };
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
              message: "restore fence required",
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

    const result = await hub.applyDocumentMutation(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mutationKind).toBe("document_version_restore");
    expect(proofs.length).toBe(2);
    expect(proofs[0] === undefined).toBe(true);
    expect(proofs[1]?.headSeq).toBe(0);
  });

  test("repairs Canvas subscribers with scene-native resync after a durable restore", async () => {
    const request: DocumentMutationRequest = {
      version: 1,
      mutationId: "canvas-version-restore",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      actor: { kind: "test" },
      clientSessionId: "canvas-agent",
      documentId: "canvas-1",
      versionId: `document-version:${"b".repeat(64)}`,
      generation: 1,
      expectedHeadSeq: 2,
    };
    const target = new FakeTarget(91);
    const hub = new DocumentSyncHub({
      ...createBackend(),
      applyDocumentMutation: async (received) =>
        documentMutationCommitted(received, { fenced: true }),
    });
    expect(hub.subscribeCanvasScene(target, {
      version: 1,
      projectId: "project-1",
      documentId: "canvas-1",
      clientSessionId: "canvas-window",
    }).ok).toBe(true);

    const result = await hub.applyDocumentMutation(request);
    expect(result.ok).toBe(true);
    expect(target.sent).toContainEqual(expect.objectContaining({
      value: expect.objectContaining({
        type: "canvas_scene_resync_required",
        projectId: "project-1",
        documentId: "canvas-1",
        headSeq: 3,
      }),
    }));
    expect(target.sent.some(({ value }) =>
      (value as { readonly kind?: string }).kind === "resync-required"
    )).toBe(false);
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
      ).toBe(true);
    }

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(proofs.length).toBe(2);
    expect(proofs[0] === undefined).toBe(true);
    expect(proofs[1]?.documentId).toBe("doc-source");
    expect(proofs[1]?.headSeq).toBe(0);
    for (const surface of [left, right]) {
      const eventKinds = surface.sent.map(
        (delivery) => (delivery.value as DocumentSyncRealtimeEvent).kind,
      );
      expect(eventKinds.includes("resync-required")).toBe(true);
      expect(eventKinds.includes("relocation-lease-release")).toBe(true);
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
    ).toBe(true);

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("document_head_conflict");
      expect(result.error.expectedHeadSeq).toBe(0);
      expect(result.error.actualHeadSeq).toBe(1);
      expect(result.error.retryable).toBe(false);
    }
    expect(calls).toBe(1);
    expect(
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-cancel",
      ),
    ).toBe(true);
  });

  test("recompiles an additional Document command against post-flush heads before durable fanout", async () => {
    const received: AdditionalDocumentCommandRequest[] = [];
    const backend: DocumentSyncDurableBackend = {
      ...createBackend(),
      applyAdditionalDocumentCommand: async (request) => {
        received.push(request);
        return additionalDocumentCommitted(request);
      },
    };
    const hub = new DocumentSyncHub(backend);
    const surface = new FakeTarget(70);
    subscribe(hub, surface, "doc-source", "surface-additional");
    await syncSubscription(
      hub,
      surface,
      "doc-source",
      "surface-additional",
    );
    clearSent(surface);

    const request = additionalDocumentRequest();
    const pending = hub.applyAdditionalDocumentCommand(request);
    await waitUntil(() =>
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    );
    expect(received.length).toBe(0);
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
    if (!prepare) throw new Error("Missing additional Document lease prepare");
    expect(prepare.leaseId === "caller-supplied-lease").toBe(false);
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
    ).toBe(true);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(received.length).toBe(1);
    const coordination = received[0]?.coordination;
    expect(coordination?.kind).toBe("hub_lease");
    if (coordination?.kind === "hub_lease") {
      expect(coordination.leaseId).toBe(prepare.leaseId);
      expect(coordination.documents[0]?.headSeq).toBe(1);
    }
    const kinds = surface.sent.map(
      (delivery) => (delivery.value as DocumentSyncRealtimeEvent).kind,
    );
    expect(kinds.includes("resync-required")).toBe(true);
    expect(kinds.includes("relocation-lease-release")).toBe(true);

    clearSent(surface);
    const flushedRequest = additionalDocumentRequest("additional:flushed");
    const flushedPending = hub.applyAdditionalDocumentCommand(flushedRequest);
    await waitUntil(() =>
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    );
    const flushedPrepare = surface.sent
      .map((delivery) => delivery.value as DocumentSyncRealtimeEvent)
      .find(
        (
          event,
        ): event is Extract<
          DocumentSyncRealtimeEvent,
          { kind: "relocation-lease-prepare" }
        > => event.kind === "relocation-lease-prepare",
      );
    if (!flushedPrepare) throw new Error("Missing flushed lease prepare");
    hub.respondToRelocationLease(surface, {
      response: "ack",
      leaseId: flushedPrepare.leaseId,
      documentId: flushedPrepare.documentId,
      clientSessionId: flushedPrepare.clientSessionId,
      storeEpoch: flushedPrepare.storeEpoch,
      generation: flushedPrepare.generation,
      headSeq: flushedPrepare.expectedHeadSeq + 1,
    });
    const flushed = await flushedPending;
    expect(flushed.ok).toBe(true);
    expect(received.length).toBe(2);
    const flushedCoordination = received[1]?.coordination;
    expect(flushedCoordination?.kind).toBe("hub_lease");
    if (flushedCoordination?.kind === "hub_lease") {
      expect(flushedCoordination.documents[0]?.headSeq).toBe(2);
    }

    clearSent(surface);
    const regeneratedPending = hub.applyAdditionalDocumentCommand(
      additionalDocumentRequest("additional:regenerated"),
    );
    await waitUntil(() =>
      surface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "relocation-lease-prepare",
      ),
    );
    const regeneratedPrepare = surface.sent
      .map((delivery) => delivery.value as DocumentSyncRealtimeEvent)
      .find(
        (
          event,
        ): event is Extract<
          DocumentSyncRealtimeEvent,
          { kind: "relocation-lease-prepare" }
        > => event.kind === "relocation-lease-prepare",
      );
    if (!regeneratedPrepare) {
      throw new Error("Missing regenerated lease prepare");
    }
    const generationMismatch = hub.respondToRelocationLease(surface, {
      response: "ack",
      leaseId: regeneratedPrepare.leaseId,
      documentId: regeneratedPrepare.documentId,
      clientSessionId: regeneratedPrepare.clientSessionId,
      storeEpoch: regeneratedPrepare.storeEpoch,
      generation: regeneratedPrepare.generation + 1,
      headSeq: regeneratedPrepare.expectedHeadSeq,
    });
    expect(generationMismatch.ok).toBe(false);
    if (!generationMismatch.ok) {
      expect(generationMismatch.error.code).toBe(
        "document_generation_mismatch",
      );
    }
    expect(
      hub.respondToRelocationLease(surface, {
        response: "nack",
        leaseId: regeneratedPrepare.leaseId,
        documentId: regeneratedPrepare.documentId,
        clientSessionId: regeneratedPrepare.clientSessionId,
        storeEpoch: regeneratedPrepare.storeEpoch,
        generation: regeneratedPrepare.generation,
        headSeq: regeneratedPrepare.expectedHeadSeq,
        reason: "surface_prepare_failed",
        message: "Document generation changed",
      }).ok,
    ).toBe(true);
    const regenerated = await regeneratedPending;
    expect(regenerated.ok).toBe(false);
    if (!regenerated.ok) {
      expect(regenerated.error.code).toBe("coordination_failed");
    }
    expect(received.length).toBe(2);
  });

  test("store replacement resets every surface and invalidates old Hub authorization", async () => {
    let durableApplyCalls = 0;
    const hub = new DocumentSyncHub(
      createBackend(async (request) => {
        durableApplyCalls += 1;
        return applyAck(request);
      }),
    );
    const left = new FakeTarget(61);
    const right = new FakeTarget(62);
    subscribe(hub, left, "doc-source", "surface-left");
    subscribe(hub, right, "doc-source", "surface-right");
    await syncSubscription(hub, left, "doc-source", "surface-left");
    await syncSubscription(hub, right, "doc-source", "surface-right");
    clearSent(left, right);

    hub.resetForStoreReplacement("epoch-restored");
    for (const target of [left, right]) {
      expect(target.sent.length).toBe(1);
      const event = target.sent[0]?.value as DocumentSyncRealtimeEvent;
      expect(event.kind).toBe("store-reset");
      if (event.kind === "store-reset") {
        expect(event.storeEpoch).toBe("epoch-restored");
      }
    }

    const staleSync = await hub.sync(left, {
      documentId: "doc-source",
      clientSessionId: "surface-left",
      stateVector: new Uint8Array([0]),
    });
    expect(staleSync.ok).toBe(false);
    if (!staleSync.ok) expect(staleSync.error.code).toBe("unauthorized");
    const staleApply = await hub.applyUpdate(left, {
      documentId: "doc-source",
      storeEpoch: "epoch-1",
      generation: 1,
      updateId: "stale-after-restore",
      clientSessionId: "surface-left",
      baseHeadSeq: 0,
      touchedBlockIds: [],
      update: new Uint8Array([0]),
    });
    expect(staleApply.ok).toBe(false);
    expect(durableApplyCalls).toBe(0);

    subscribe(hub, left, "doc-source", "surface-left");
    const freshSync = await hub.sync(left, {
      documentId: "doc-source",
      clientSessionId: "surface-left",
      stateVector: new Uint8Array([0]),
    });
    expect(freshSync.ok).toBe(true);
  });

  test("Project deletion resets only removed Documents and revokes their Hub authorization", async () => {
    const hub = new DocumentSyncHub(createBackend());
    const deletedSurface = new FakeTarget(63);
    const retainedSurface = new FakeTarget(64);
    subscribe(hub, deletedSurface, "doc-deleted", "surface-deleted");
    subscribe(hub, retainedSurface, "doc-retained", "surface-retained");
    await syncSubscription(
      hub,
      deletedSurface,
      "doc-deleted",
      "surface-deleted",
    );
    await syncSubscription(
      hub,
      retainedSurface,
      "doc-retained",
      "surface-retained",
    );
    clearSent(deletedSurface, retainedSurface);

    hub.resetForDeletedDocuments(["doc-deleted"], "epoch-1");

    expect(deletedSurface.sent.length).toBe(1);
    const reset = deletedSurface.sent[0]?.value as DocumentSyncRealtimeEvent;
    expect(reset.kind).toBe("store-reset");
    expect(retainedSurface.sent.length).toBe(0);

    const deletedSync = await hub.sync(deletedSurface, {
      documentId: "doc-deleted",
      clientSessionId: "surface-deleted",
      stateVector: new Uint8Array([0]),
    });
    expect(deletedSync.ok).toBe(false);
    if (!deletedSync.ok) expect(deletedSync.error.code).toBe("unauthorized");

    const retainedSync = await hub.sync(retainedSurface, {
      documentId: "doc-retained",
      clientSessionId: "surface-retained",
      stateVector: new Uint8Array([0]),
    });
    expect(retainedSync.ok).toBe(true);
  });

  test("leases one prepared Document closure for an atomic Agent Card batch", async () => {
    const command = nodexAgentCreateCardsCommand();
    let executeCalls = 0;
    const hub = new DocumentSyncHub({
      ...createBackend(),
      executeNodexAgentCreatePages: async () => {
        executeCalls += 1;
        return {
          ok: true,
          value: {
            output: CreatePagesV3OutputSchema.parse({
              data: {
                pages: command.pages.map((page) => ({
                  pageId: page.pageId,
                  location: { kind: "page", pageId: "card-parent" },
                  bodyBlocksCreated: page.bodyBlockIds.length,
                })),
                created: 2,
              },
            }),
            duplicate: false,
            documentCommits: [],
            affectedDatabaseBlockIds: ["database-primary"],
            changeLogSeq: 10,
          },
        };
      },
    });
    const leaseDocuments = [{
      documentId: "doc-source",
      generation: 1,
      expectedHeadSeq: 0,
    }];

    const result = await hub.executeNodexAgentCreatePages(command, leaseDocuments);
    expect(result.ok).toBe(true);
    expect(executeCalls).toBe(1);
    const mismatched = await hub.executeNodexAgentCreatePages(command, []);
    expect(mismatched).toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
    expect(executeCalls).toBe(1);
  });

  test("coordinates BlockTransfer over every source-owned and target Document", async () => {
    const intent = blockTransferIntent();
    let prepareCalls = 0;
    let applyCalls = 0;
    let committed = false;
    const hub = new DocumentSyncHub({
      ...createBackend(),
      lookupCommittedBlockTransfer: async () => ({
        ok: true,
        value: committed ? blockTransferReceipt(intent, true) : null,
      }),
      prepareBlockTransfer: async () => {
        prepareCalls += 1;
        return {
          ok: true,
          value: blockTransferPreparation(
            intent,
            prepareCalls > 1 ? 2 : 1,
            prepareCalls > 1 ? 2 : 1,
          ),
        };
      },
      applyBlockTransfer: async (request) => {
        applyCalls += 1;
        expect(request.target.kind).toBe("document");
        if (request.target.kind === "document") {
          expect(request.target.expectedHeadSeq).toBe(2);
        }
        committed = true;
        return { ok: true, value: blockTransferReceipt(intent, false) };
      },
    });
    const ownedSurface = new FakeTarget(90);
    const targetSurface = new FakeTarget(91);
    subscribe(hub, ownedSurface, "doc-owned-source", "surface-owned");
    subscribe(hub, targetSurface, "doc-target", "surface-target");
    await syncSubscription(
      hub,
      ownedSurface,
      "doc-owned-source",
      "surface-owned",
    );
    await syncSubscription(hub, targetSurface, "doc-target", "surface-target");
    clearSent(ownedSurface, targetSurface);

    const pending = hub.transferBlocks(intent);
    await waitUntil(() =>
      [ownedSurface, targetSurface].every((surface) =>
        surface.sent.some(
          (delivery) =>
            (delivery.value as DocumentSyncRealtimeEvent).kind ===
            "relocation-lease-prepare",
        ),
      ),
    );
    for (const surface of [ownedSurface, targetSurface]) {
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
      if (!prepare) throw new Error("Missing Block transfer lease prepare");
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
      ).toBe(true);
    }
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(prepareCalls).toBe(2);
    expect(applyCalls).toBe(1);
    expect(
      targetSurface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "document-update",
      ),
    ).toBe(true);
    for (const surface of [ownedSurface, targetSurface]) {
      expect(
        surface.sent.some(
          (delivery) =>
            (delivery.value as DocumentSyncRealtimeEvent).kind ===
            "relocation-lease-release",
        ),
      ).toBe(true);
    }

    clearSent(ownedSurface, targetSurface);
    const retry = await hub.transferBlocks({
      ...intent,
      clientSessionId: "retry-session",
    });
    expect(retry.ok && retry.value.duplicate).toBe(true);
    expect(prepareCalls).toBe(2);
    expect(applyCalls).toBe(1);
    expect(
      targetSurface.sent.some(
        (delivery) =>
          (delivery.value as DocumentSyncRealtimeEvent).kind ===
          "resync-required",
      ),
    ).toBe(true);
  });
});
