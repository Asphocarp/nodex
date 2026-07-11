import { describe, expect, test } from "vitest";
import { CardMutationWriter, type CardMutationWorkerLike } from "./card-mutation-writer";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type { CardMutationMetrics, CardMutationWorkerMessage, CardMutationWorkerRequest } from "./card-mutation-worker-protocol";
import type { CardSummary } from "../shared/types";
import type {
  DocumentMutationRequest,
  DocumentSyncApplyRequest,
  RelocateBlocks,
} from "../shared/block-documents";
import type { BlockPropertyMutationRequest } from "../shared/block-property-mutations";
import type { DatabaseMutationRequest } from "../shared/database-kernel";
import type { DatabaseChangeEvent } from "../shared/database-events";
import type { CardLifecycleMutationRequest } from "../shared/card-lifecycle";
import type { AdditionalDocumentCommandRequest } from "../shared/additional-document-commands";
import type { CardProjectTransferRequest } from "../shared/card-project-transfer";

class FakeWorker implements CardMutationWorkerLike {
  readonly messages: CardMutationWorkerRequest[] = [];
  terminated = false;
  private messageListeners: Array<(message: CardMutationWorkerMessage) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];

  postMessage(message: CardMutationWorkerRequest): void {
    this.messages.push(message);
  }

  on(event: "message", listener: (message: CardMutationWorkerMessage) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
  on(
    event: "message" | "error" | "exit",
    listener: ((message: CardMutationWorkerMessage) => void) | ((error: Error) => void) | ((code: number) => void),
  ): void {
    if (event === "message") {
      this.messageListeners.push(listener as (message: CardMutationWorkerMessage) => void);
      return;
    }
    if (event === "error") {
      this.errorListeners.push(listener as (error: Error) => void);
      return;
    }
    this.exitListeners.push(listener as (code: number) => void);
  }

  removeAllListeners(): void {
    this.messageListeners = [];
    this.errorListeners = [];
    this.exitListeners = [];
  }

  terminate(): unknown {
    this.terminated = true;
    return undefined;
  }

  emitMessage(message: CardMutationWorkerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }

  emitExit(code: number): void {
    for (const listener of this.exitListeners) listener(code);
  }
}

function makeSummary(overrides: Partial<CardSummary> = {}): CardSummary {
  return {
    id: "card-1",
    status: "draft",
    archived: false,
    title: "Card",
    priority: undefined,
    estimate: undefined,
    tags: [],
    dueDate: undefined,
    scheduledStart: undefined,
    scheduledEnd: undefined,
    isAllDay: undefined,
    recurrence: undefined,
    reminders: [],
    scheduleTimezone: undefined,
    assignee: undefined,
    agentBlocked: false,
    agentStatus: undefined,
    runInTarget: undefined,
    runInLocalPath: undefined,
    runInBaseBranch: undefined,
    runInWorktreePath: undefined,
    runInEnvironmentPath: undefined,
    revision: 2,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 0,
    descriptionPreview: "preview",
    descriptionLength: 7,
    hasDescription: true,
    ...overrides,
  };
}

function makeMetrics(mutationId: string): CardMutationMetrics {
  return {
    mutationId,
    queueWaitMs: 1,
    workerDurationMs: 2,
    transactionMs: 2,
    eventCount: 1,
  };
}

describe("CardMutationWriter", () => {
  test("publishes source and target Database invalidations once for a Card transfer", async () => {
    const worker = new FakeWorker();
    const databaseEvents: DatabaseChangeEvent[] = [];
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
      publishDatabaseEvent: (event) => databaseEvents.push(event),
    });
    const input: CardProjectTransferRequest = {
      version: 1,
      operationId: "transfer-writer-1",
      storeEpoch: "epoch-1",
      sourceProjectId: "project-a",
      targetProjectId: "project-b",
      cardId: "card-1",
      expectedTopLevelRankKey: "1000",
      expectedBlocks: [
        {
          blockId: "card-1",
          type: "card",
          lifecycle: "active",
          location: { kind: "space" },
          locationRevision: 1,
          metadataRevision: 1,
        },
      ],
      expectedDocuments: [
        {
          ownerBlockId: "card-1",
          documentId: "document-card-1",
          generation: 1,
          headSeq: 2,
          schemaKey: "nodex.card",
          schemaVersion: 1,
        },
      ],
      expectedMemberships: [
        {
          cardBlockId: "card-1",
          membershipId: "membership-a",
          databaseBlockId: "database-a",
          databaseSchemaRevision: 1,
          membershipRevision: 1,
          statusPropertyId: "property-status-a",
          statusValueRevision: 1,
          status: "draft",
        },
      ],
      target: {
        databaseBlockId: "database-b",
        databaseSchemaRevision: 2,
        viewId: "view-b",
        viewRevision: 3,
        status: "in_progress",
      },
      clientSessionId: "window-1",
      actor: { kind: "electron_renderer" },
    };
    const pending = writer.applyCardProjectTransfer(input);
    const request = worker.messages[0];
    if (!request || request.type !== "applyCardProjectTransfer") {
      throw new Error("Expected Card transfer writer request");
    }
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          version: 1,
          operationId: input.operationId,
          storeEpoch: input.storeEpoch,
          sourceProjectId: input.sourceProjectId,
          targetProjectId: input.targetProjectId,
          cardId: input.cardId,
          duplicate: false,
          movedBlockIds: ["card-1"],
          movedDocumentIds: ["document-card-1"],
          sourceMembershipIds: ["membership-a"],
          targetMembershipIds: { "card-1": "membership-b" },
          blockMetadataRevisions: { "card-1": 2 },
          rootLocationRevision: 2,
          documentHeads: {
            "document-card-1": { generation: 1, headSeq: 2 },
          },
          targetDatabaseBlockId: "database-b",
          targetDatabaseSchemaRevision: 2,
          targetViewId: "view-b",
          targetStatus: "in_progress",
          targetTopLevelRankKey: "2000",
          targetViewRankKey: "3000",
          changeLogSeq: 8,
          committedAt: "2026-07-12T00:00:00.000Z",
        },
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(databaseEvents.length).toBe(2);
    expect(databaseEvents[0]?.projectId).toBe("project-a");
    expect(databaseEvents[0]?.affectedDatabaseBlockIds.join(",")).toBe(
      "database-a",
    );
    expect(databaseEvents[1]?.projectId).toBe("project-b");
    expect(databaseEvents[1]?.affectedDatabaseBlockIds.join(",")).toBe(
      "database-b",
    );
    expect(
      databaseEvents.every(
        (event) => event.sourceKind === "card_project_transfer",
      ),
    ).toBe(true);
  });

  test("rejects Card title and body snapshots before creating a worker", async () => {
    let workerCreations = 0;
    const writer = new CardMutationWriter({
      createWorker: () => {
        workerCreations += 1;
        return new FakeWorker();
      },
    });
    const messages: string[] = [];

    for (const patch of [
      { title: "stale title" },
      { description: "stale body" },
    ]) {
      try {
        await writer.updateCard(
          "project-1",
          "draft",
          "card-1",
          patch,
        );
      } catch (error) {
        messages.push(error instanceof Error ? error.message : String(error));
      }
    }

    expect(workerCreations).toBe(0);
    expect(messages.length).toBe(2);
    expect(messages.every((message) => message.includes("Card Document"))).toBe(true);
  });

  test("preserves an additional Document command and strict receipt through the FIFO", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });
    const input: AdditionalDocumentCommandRequest = {
      version: 1,
      operationId: "additional:create-synced",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      clientSessionId: "surface-1",
      actor: { kind: "test" },
      coordination: { kind: "fifo_only" },
      operation: {
        kind: "create_synced_source",
        sourceBlockId: "synced-source",
        documentId: "synced-document",
        initialBlocks: [],
        placement: { kind: "space" },
      },
    };
    const pending = writer.applyAdditionalDocumentCommand(input);
    const request = worker.messages[0];
    expect(request?.type).toBe("applyAdditionalDocumentCommand");
    if (!request || request.type !== "applyAdditionalDocumentCommand") return;
    expect(request.payload.operationId).toBe(input.operationId);
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          version: 1,
          operationId: input.operationId,
          projectId: input.projectId,
          storeEpoch: input.storeEpoch,
          operationKind: input.operation.kind,
          semanticHash: "a".repeat(64),
          duplicate: false,
          effect: {
            createdBlockIds: ["synced-source"],
            preservedBlockIds: [],
            deletedBlockIds: [],
            documentHeads: [
              {
                documentId: "synced-document",
                generation: 1,
                headSeq: 1,
              },
            ],
          },
          changeLogSeq: 9,
          committedAt: "2026-07-12T00:00:00.000Z",
        },
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.changeLogSeq).toBe(9);
  });

  test("serializes Document history reads through the same FIFO worker", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });
    const pending = writer.listDocumentVersions({
      projectId: "project-1",
      documentId: "document-1",
      limit: 20,
    });
    const request = worker.messages[0];
    expect(request?.type).toBe("listDocumentVersions");
    if (!request || request.type !== "listDocumentVersions") return;
    expect(request.payload.limit).toBe(20);
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: { ok: true, value: [] },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(0);
  });

  test("preserves the property mutation envelope and typed receipt through the FIFO", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });
    const input: BlockPropertyMutationRequest = {
      version: 1,
      mutationId: "property-mutation-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      clientSessionId: "renderer-1",
      actor: { kind: "electron_renderer", clientId: "renderer-1" },
      fields: [
        {
          scope: "intrinsic",
          blockId: "card-1",
          propertyKey: "agent.status",
          operation: "set",
          expectedRevision: 1,
          value: "running",
        },
      ],
    };

    const pending = writer.applyBlockPropertyMutation(input);
    const request = worker.messages[0];
    expect(request?.type).toBe("applyBlockPropertyMutation");
    if (!request || request.type !== "applyBlockPropertyMutation") return;
    expect(request.payload.mutationId).toBe("property-mutation-1");
    expect(request.payload.clientSessionId).toBe("renderer-1");

    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          version: 1,
          mutationId: "property-mutation-1",
          projectId: "project-1",
          storeEpoch: "epoch-1",
          duplicate: false,
          fields: [
            {
              path: "intrinsic/card-1/agent.status",
              scope: "intrinsic",
              blockId: "card-1",
              propertyKey: "agent.status",
              operation: "set",
              revision: 2,
              value: "running",
            },
          ],
          blockMetadataRevisions: { "card-1": 2 },
          changeLogSeq: 7,
          committedAt: "2026-07-11T00:00:00.000Z",
        },
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });

    const envelope = await pending;
    expect(envelope.result.ok).toBe(true);
    if (!envelope.result.ok) return;
    expect(envelope.result.value.mutationId).toBe("property-mutation-1");
    expect(envelope.result.value.changeLogSeq).toBe(7);
  });

  test("preserves an atomic Database operation batch through the FIFO", async () => {
    const worker = new FakeWorker();
    const databaseEvents: DatabaseChangeEvent[] = [];
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
      publishDatabaseEvent: (event) => databaseEvents.push(event),
    });
    const input: DatabaseMutationRequest = {
      version: 1,
      operationId: "database-operation-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      clientSessionId: "trusted-window-1",
      actor: { kind: "electron_renderer" },
      operations: [
        {
          kind: "set_value",
          cardBlockId: "card-1",
          databaseBlockId: "database-1",
          propertyId: "status-property",
          expectedValueRevision: 1,
          value: "done",
        },
        {
          kind: "position_card",
          viewId: "view-1",
          cardBlockId: "card-1",
          expectedPositionRevision: 1,
          groupKey: "done",
        },
      ],
    };

    const pending = writer.applyDatabaseMutation(input);
    const request = worker.messages[0];
    expect(request?.type).toBe("applyDatabaseMutation");
    if (!request || request.type !== "applyDatabaseMutation") return;
    expect(request.payload.operationId).toBe("database-operation-1");
    expect(request.payload.operations.length).toBe(2);
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          version: 1,
          operationId: "database-operation-1",
          projectId: "project-1",
          storeEpoch: "epoch-1",
          operationKinds: ["set_value", "position_card"],
          affectedDatabaseBlockIds: ["database-1"],
          duplicate: false,
          payload: { operationResults: [] },
          changeLogSeq: 9,
          committedAt: "2026-07-11T00:00:00.000Z",
        },
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });

    const envelope = await pending;
    expect(envelope.result.ok).toBe(true);
    if (!envelope.result.ok) return;
    expect(envelope.result.value.operationKinds.join(",")).toBe(
      "set_value,position_card",
    );
    expect(envelope.result.value.changeLogSeq).toBe(9);
    expect(databaseEvents.length).toBe(1);
    expect(databaseEvents[0]?.affectedDatabaseBlockIds.join(",")).toBe(
      "database-1",
    );

    const duplicatePending = writer.applyDatabaseMutation(input);
    const duplicateRequest = worker.messages[1];
    if (!duplicateRequest || duplicateRequest.type !== "applyDatabaseMutation") {
      throw new Error("Expected duplicate Database request");
    }
    worker.emitMessage({
      id: duplicateRequest.id,
      ok: true,
      result: {
        ok: true,
        value: {
          ...envelope.result.value,
          duplicate: true,
        },
      },
      events: [],
      metrics: makeMetrics(duplicateRequest.mutationId),
    });
    const duplicate = await duplicatePending;
    expect(duplicate.result.ok && duplicate.result.value.duplicate).toBe(true);
    expect(databaseEvents.length).toBe(1);

  });

  test("publishes schema-only Database receipts without inventing Card summary events", async () => {
    const worker = new FakeWorker();
    const boardEvents: BoardChangeEvent[] = [];
    const databaseEvents: DatabaseChangeEvent[] = [];
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: (event) => boardEvents.push(event),
      publishDatabaseEvent: (event) => databaseEvents.push(event),
    });
    const input: DatabaseMutationRequest = {
      version: 1,
      operationId: "database-schema-operation-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      actor: { kind: "test" },
      operations: [
        {
          kind: "put_property",
          databaseBlockId: "database-1",
          propertyId: "property-1",
          expectedDatabaseSchemaRevision: 1,
          expectedPropertyRevision: 0,
          key: "owner",
          name: "Owner",
          valueType: "person",
          config: {},
        },
      ],
    };
    const pending = writer.applyDatabaseMutation(input);
    const request = worker.messages[0];
    if (!request || request.type !== "applyDatabaseMutation") {
      throw new Error("Expected Database schema request");
    }
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          version: 1,
          operationId: input.operationId,
          projectId: input.projectId,
          storeEpoch: input.storeEpoch,
          operationKinds: ["put_property"],
          affectedDatabaseBlockIds: ["database-1"],
          duplicate: false,
          payload: {},
          changeLogSeq: 10,
          committedAt: "2026-07-11T00:00:00.000Z",
        },
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });
    await pending;

    expect(boardEvents.length).toBe(0);
    expect(databaseEvents.length).toBe(1);
    expect(databaseEvents[0]?.sourceKind).toBe("database_mutation");
  });

  test("serializes the Card lifecycle preflight through the same FIFO worker", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });
    const pending = writer.readCardLifecyclePreflight(
      "project-1",
      "card-1",
    );
    const request = worker.messages[0];
    expect(request?.type).toBe("readCardLifecyclePreflight");
    if (!request || request.type !== "readCardLifecyclePreflight") return;
    expect(request.payload.projectId).toBe("project-1");
    expect(request.payload.cardId).toBe("card-1");
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          version: 1,
          projectId: "project-1",
          storeEpoch: "epoch-1",
          changeLogSeq: 4,
          value: null,
        },
      },
      events: [],
      metrics: { ...makeMetrics(request.mutationId), eventCount: 0 },
    });
    const envelope = await pending;
    expect(envelope.result.ok).toBe(true);
    expect(envelope.events.length).toBe(0);
  });

  test("preserves the trusted Card lifecycle identity and typed receipt through the FIFO", async () => {
    const worker = new FakeWorker();
    const databaseEvents: DatabaseChangeEvent[] = [];
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
      publishDatabaseEvent: (event) => databaseEvents.push(event),
    });
    const input: CardLifecycleMutationRequest = {
      version: 1,
      operationId: "card-lifecycle-operation-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      clientSessionId: "trusted-window-1",
      actor: { kind: "electron_renderer", windowId: "window-1" },
      operation: {
        kind: "archive_card",
        cardId: "card-1",
        expectedMetadataRevision: 3,
      },
    };

    const pending = writer.applyCardLifecycleMutation(input);
    const request = worker.messages[0];
    expect(request?.type).toBe("applyCardLifecycleMutation");
    if (!request || request.type !== "applyCardLifecycleMutation") return;
    expect(request.payload.operationId).toBe(input.operationId);
    expect(request.payload.storeEpoch).toBe(input.storeEpoch);
    expect(request.payload.clientSessionId).toBe(input.clientSessionId);
    expect(request.payload.actor.windowId).toBe("window-1");
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          version: 1,
          operationId: input.operationId,
          projectId: input.projectId,
          storeEpoch: input.storeEpoch,
          operationKind: "archive_card",
          cardId: "card-1",
          duplicate: false,
          metadataRevision: 4,
          locationRevision: 1,
          lifecycle: "archived",
          documentId: "document:card-1",
          documentGeneration: 1,
          documentHeadSeq: 1,
          databaseBlockId: "database-1",
          membershipId: "membership-1",
          viewId: "view-1",
          topLevelRankKey: "a0",
          viewRankKey: "a0",
          createdBlockIds: [],
          changeLogSeq: 10,
          committedAt: "2026-07-11T00:00:00.000Z",
        },
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });

    const envelope = await pending;
    expect(envelope.result.ok).toBe(true);
    if (!envelope.result.ok) return;
    expect(envelope.result.value.operationId).toBe(input.operationId);
    expect(envelope.result.value.lifecycle).toBe("archived");
    expect(envelope.result.value.changeLogSeq).toBe(10);
    expect(databaseEvents.length).toBe(1);
    expect(databaseEvents[0]?.sourceKind).toBe("card_lifecycle");
    expect(databaseEvents[0]?.affectedDatabaseBlockIds.join(",")).toBe(
      "database-1",
    );

    const duplicatePending = writer.applyCardLifecycleMutation(input);
    const duplicateRequest = worker.messages[1];
    if (
      !duplicateRequest ||
      duplicateRequest.type !== "applyCardLifecycleMutation"
    ) {
      throw new Error("Expected duplicate lifecycle request");
    }
    worker.emitMessage({
      id: duplicateRequest.id,
      ok: true,
      result: {
        ok: true,
        value: { ...envelope.result.value, duplicate: true },
      },
      events: [],
      metrics: makeMetrics(duplicateRequest.mutationId),
    });
    const duplicate = await duplicatePending;
    expect(duplicate.result.ok && duplicate.result.value.duplicate).toBe(true);
    expect(databaseEvents.length).toBe(1);

    const rejectedPending = writer.applyCardLifecycleMutation({
      ...input,
      operationId: "card-lifecycle-operation-rejected",
    });
    const rejectedRequest = worker.messages[2];
    if (
      !rejectedRequest ||
      rejectedRequest.type !== "applyCardLifecycleMutation"
    ) {
      throw new Error("Expected rejected lifecycle request");
    }
    worker.emitMessage({
      id: rejectedRequest.id,
      ok: true,
      result: {
        ok: false,
        error: {
          code: "metadata_revision_conflict",
          message: "metadata changed",
          retryable: false,
          operationId: "card-lifecycle-operation-rejected",
          cardId: "card-1",
          expectedRevision: 3,
          actualRevision: 4,
        },
      },
      events: [],
      metrics: makeMetrics(rejectedRequest.mutationId),
    });
    const rejected = await rejectedPending;
    expect(rejected.result.ok).toBe(false);
    expect(databaseEvents.length).toBe(1);
  });

  test("serializes bounded Document compaction through the mutation FIFO", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });
    const input = {
      storeEpoch: "epoch-1",
      policy: {
        minimumUpdateCount: 4,
        maximumDocuments: 2,
        scanLimit: 8,
      },
    };

    const pending = writer.compactEligibleBlockDocuments(input);
    const request = worker.messages[0];
    expect(request?.type).toBe("compactEligibleBlockDocuments");
    if (!request || request.type !== "compactEligibleBlockDocuments") return;
    expect(request.payload.storeEpoch).toBe("epoch-1");
    expect(request.payload.policy?.maximumDocuments).toBe(2);
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        storeEpoch: "epoch-1",
        selectedDocumentCount: 1,
        selectedUpdateCount: 4,
        selectedUpdateBytes: 128,
        documents: [
          {
            documentId: "document:card-1",
            generation: 1,
            snapshotSeq: 5,
            snapshotBytes: 96,
            prunedUpdateCount: 4,
            retainedReceiptCount: 4,
          },
        ],
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });

    const envelope = await pending;
    expect(envelope.result.selectedDocumentCount).toBe(1);
    expect(envelope.result.documents[0]?.snapshotSeq).toBe(5);
    expect(envelope.events.length).toBe(0);
  });

  test("keeps trusted Document write-fence evidence inside the FIFO boundary", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });
    const input: DocumentMutationRequest = {
      version: 1,
      mutationId: "document-mutation-1",
      projectId: "project-1",
      storeEpoch: "epoch-1",
      actor: { kind: "electron_renderer" },
      clientSessionId: "renderer-1",
      documentId: "document-1",
      generation: 1,
      expectedHeadSeq: 4,
      operations: [
        {
          kind: "delete_block",
          blockId: "block-1",
        },
      ],
    };
    const fence = {
      leaseId: "document-mutation-lease:1",
      documentId: "document-1",
      generation: 1,
      headSeq: 4,
    };

    const pending = writer.applyDocumentMutation(input, fence);
    const request = worker.messages[0];
    expect(request?.type).toBe("applyDocumentMutation");
    if (!request || request.type !== "applyDocumentMutation") return;
    expect(request.payload.request.mutationId).toBe("document-mutation-1");
    expect(request.payload.writeFence?.leaseId).toBe(
      "document-mutation-lease:1",
    );
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          version: 1,
          mutationKind: "document_operation_batch",
          mutationId: "document-mutation-1",
          projectId: "project-1",
          storeEpoch: "epoch-1",
          documentId: "document-1",
          generation: 1,
          baseHeadSeq: 4,
          headSeq: 5,
          touchedBlockIds: ["block-1"],
          createdBlockIds: [],
          deletedBlockIds: ["block-1"],
          updatedBlockIds: [],
          movedBlockIds: [],
          writeFenceBlockIds: ["block-1"],
          titleChanged: false,
          coordination: "write_fence",
          changeLogSeq: 12,
          committedAt: "2026-07-11T00:00:00.000Z",
          duplicate: false,
        },
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.headSeq).toBe(5);
  });

  test("resolves worker ack and republishes board events", async () => {
    const worker = new FakeWorker();
    const published: BoardChangeEvent[] = [];
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: (event) => {
        published.push(event);
      },
    });

    const summary = makeSummary({ priority: "p1-high" });
    const pending = writer.updateCard("project-1", "draft", "card-1", {
      priority: "p1-high",
    });
    const request = worker.messages[0];
    expect(request?.type).toBe("updateCard");
    if (!request) return;

    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        status: "updated",
        projectId: "project-1",
        cardId: "card-1",
        revision: 2,
        summary,
        changedFields: ["priority"],
        didMutate: true,
      },
      events: [{
        projectId: "project-1",
        changeType: "update",
        columnId: "draft",
        status: "draft",
        cardId: "card-1",
        summary,
        mutationId: request.mutationId,
      }],
      metrics: makeMetrics(request.mutationId),
    });

    const envelope = await pending;
    expect(envelope.result.status).toBe("updated");
    expect(published.length).toBe(1);
    expect(published[0]?.summary?.id).toBe("card-1");
    expect(envelope.metrics.mainEventLoopLagMaxMs !== undefined).toBe(true);
  });

  test("publishes a committed Document summary once and never before the worker ACK", async () => {
    const worker = new FakeWorker();
    const published: BoardChangeEvent[] = [];
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: (event) => {
        published.push(event);
      },
    });
    const input: DocumentSyncApplyRequest = {
      documentId: "document:card-1",
      storeEpoch: "store-1",
      generation: 1,
      updateId: "document-update-1",
      clientSessionId: "window-1",
      baseHeadSeq: 3,
      touchedBlockIds: ["card-1"],
      update: new Uint8Array([5]),
    };
    const summary = makeSummary({
      title: "Collaborative title",
      descriptionPreview: "Collaborative body",
      descriptionLength: 18,
    });

    const firstPending = writer.applyBlockDocumentUpdate(input);
    const firstRequest = worker.messages[0];
    expect(firstRequest?.type).toBe("applyBlockDocumentUpdate");
    expect(published.length).toBe(0);
    if (!firstRequest) return;
    worker.emitMessage({
      id: firstRequest.id,
      ok: true,
      result: {
        ok: true,
        value: {
          documentId: input.documentId,
          storeEpoch: input.storeEpoch,
          generation: input.generation,
          updateId: input.updateId,
          committedSeq: 4,
          headSeq: 4,
          stateVector: new Uint8Array([1, 4]),
          duplicate: false,
        },
      },
      events: [{
        projectId: "project-1",
        changeType: "update",
        columnId: "draft",
        status: "draft",
        cardId: "card-1",
        summary,
        mutationId: firstRequest.mutationId,
      }],
      metrics: makeMetrics(firstRequest.mutationId),
    });

    const firstAck = await firstPending;
    expect(firstAck.ok).toBe(true);
    expect(published.length).toBe(1);
    expect(published[0]?.summary?.title).toBe("Collaborative title");

    const duplicatePending = writer.applyBlockDocumentUpdate(input);
    const duplicateRequest = worker.messages[1];
    expect(published.length).toBe(1);
    if (!duplicateRequest) return;
    worker.emitMessage({
      id: duplicateRequest.id,
      ok: true,
      result: {
        ok: true,
        value: {
          documentId: input.documentId,
          storeEpoch: input.storeEpoch,
          generation: input.generation,
          updateId: input.updateId,
          committedSeq: 4,
          headSeq: 4,
          stateVector: new Uint8Array([1, 4]),
          duplicate: true,
        },
      },
      events: [],
      metrics: makeMetrics(duplicateRequest.mutationId),
    });

    const duplicateAck = await duplicatePending;
    expect(duplicateAck.ok).toBe(true);
    if (!duplicateAck.ok) return;
    expect(duplicateAck.value.duplicate).toBe(true);
    expect(published.length).toBe(1);
  });

  test("returns the durable Document ACK when a board listener throws", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => {
        throw new Error("listener unavailable");
      },
    });
    const input: DocumentSyncApplyRequest = {
      documentId: "document:card-1",
      storeEpoch: "store-1",
      generation: 1,
      updateId: "document-update-1",
      clientSessionId: "window-1",
      baseHeadSeq: 3,
      touchedBlockIds: ["card-1"],
      update: new Uint8Array([5]),
    };

    const pending = writer.applyBlockDocumentUpdate(input);
    const request = worker.messages[0];
    if (!request) return;
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          documentId: input.documentId,
          storeEpoch: input.storeEpoch,
          generation: input.generation,
          updateId: input.updateId,
          committedSeq: 4,
          headSeq: 4,
          stateVector: new Uint8Array([1, 4]),
          duplicate: false,
        },
      },
      events: [{
        projectId: "project-1",
        changeType: "update",
        columnId: "draft",
        status: "draft",
        cardId: "card-1",
        summary: makeSummary(),
        mutationId: request.mutationId,
      }],
      metrics: makeMetrics(request.mutationId),
    });

    const ack = await pending;
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.value.committedSeq).toBe(4);
    expect(ack.value.duplicate).toBe(false);
  });

  test("rejects pending requests on worker failure and rebuilds for the next request", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const writer = new CardMutationWriter({
      createWorker: () => {
        const worker = workers.shift();
        if (!worker) throw new Error("No fake worker available");
        return worker;
      },
      publishBoardEvent: () => undefined,
    });

    const failed = writer.deleteCard("project-1", "draft", "card-1");
    firstWorker.emitError(new Error("worker crashed"));
    let message = "";
    try {
      await failed;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("worker crashed");

    const pending = writer.deleteCard("project-1", "draft", "card-2");
    expect(secondWorker.messages.length).toBe(1);
    const request = secondWorker.messages[0];
    if (!request) return;
    secondWorker.emitMessage({
      id: request.id,
      ok: true,
      result: true,
      events: [],
      metrics: makeMetrics(request.mutationId),
    });
    const envelope = await pending;
    expect(envelope.result).toBe(true);
  });

  test("preserves typed Document results across the worker boundary", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });

    const syncPending = writer.syncBlockDocument({
      documentId: "document:card-1",
      clientSessionId: "window-1",
      stateVector: new Uint8Array([0]),
    });
    const syncRequest = worker.messages[0];
    expect(syncRequest?.type).toBe("syncBlockDocument");
    if (!syncRequest) return;

    worker.emitMessage({
      id: syncRequest.id,
      ok: true,
      result: {
        ok: true,
        value: {
          documentId: "document:card-1",
          storeEpoch: "store-1",
          generation: 1,
          headSeq: 3,
          stateVector: new Uint8Array([1, 2]),
          update: new Uint8Array([3, 4]),
        },
      },
      events: [],
      metrics: makeMetrics(syncRequest.mutationId),
    });

    const syncResult = await syncPending;
    expect(syncResult.ok).toBe(true);
    if (!syncResult.ok) return;
    expect(syncResult.value.headSeq).toBe(3);
    expect(syncResult.value.update[1]).toBe(4);

    const projectPending = writer.getBlockDocumentProjectId("document:missing");
    const projectRequest = worker.messages[1];
    expect(projectRequest?.type).toBe("getBlockDocumentProjectId");
    if (!projectRequest) return;
    worker.emitMessage({
      id: projectRequest.id,
      ok: true,
      result: {
        ok: false,
        error: {
          code: "document_not_found",
          message: "missing document",
          retryable: false,
          resetRequired: true,
        },
      },
      events: [],
      metrics: makeMetrics(projectRequest.mutationId),
    });
    const projectResult = await projectPending;
    expect(projectResult.ok).toBe(false);
    if (!projectResult.ok) {
      expect(projectResult.error.code).toBe("document_not_found");
    }

    const applyInput: DocumentSyncApplyRequest = {
      documentId: "document:card-1",
      storeEpoch: "store-1",
      generation: 1,
      updateId: "update-1",
      clientSessionId: "window-1",
      baseHeadSeq: 3,
      touchedBlockIds: [],
      update: new Uint8Array([5]),
    };
    const applyPending = writer.applyBlockDocumentUpdate(applyInput);
    const applyRequest = worker.messages[2];
    expect(applyRequest?.type).toBe("applyBlockDocumentUpdate");
    if (!applyRequest) return;

    worker.emitMessage({
      id: applyRequest.id,
      ok: true,
      result: {
        ok: false,
        error: {
          code: "document_update_missing_dependencies",
          message: "retry after the prerequisite update",
          retryable: true,
          resetRequired: false,
        },
      },
      events: [],
      metrics: makeMetrics(applyRequest.mutationId),
    });

    const applyResult = await applyPending;
    expect(applyResult.ok).toBe(false);
    if (applyResult.ok) return;
    expect(applyResult.error.code).toBe("document_update_missing_dependencies");
    expect(applyResult.error.retryable).toBe(true);

    const descriptorPending = writer.getOwnedBlockDocumentDescriptor(
      "project-1",
      "card-1",
    );
    const descriptorRequest = worker.messages[3];
    expect(descriptorRequest?.type).toBe("getOwnedBlockDocumentDescriptor");
    if (!descriptorRequest) return;
    worker.emitMessage({
      id: descriptorRequest.id,
      ok: true,
      result: {
        projectId: "project-1",
        ownerBlockId: "card-1",
        ownerType: "card",
        ownerLifecycle: "active",
        documentId: "document:card-1",
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 3,
        schemaKey: "nodex.card",
        schemaVersion: 1,
        readiness: "ready",
        authority: "ydoc_primary",
        stateVector: new Uint8Array([1, 2]),
      },
      events: [],
      metrics: makeMetrics(descriptorRequest.mutationId),
    });
    const descriptor = await descriptorPending;
    expect(descriptor.result.ownerBlockId).toBe("card-1");
    expect(descriptor.result.authority).toBe("ydoc_primary");
  });

  test("preserves typed relocation binaries and compacted null replay through the FIFO", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });
    const input: RelocateBlocks = {
      relocationId: "relocation-1",
      projectId: "project-1",
      storeEpoch: "store-1",
      rootBlockIds: ["block-1"],
      sourceDocumentId: "document:source",
      sourceGeneration: 1,
      expectedSourceHeadSeq: 3,
      expectedLocationRevisions: { "block-1": 1 },
      target: {
        kind: "document",
        documentId: "document:target",
        generation: 1,
        expectedHeadSeq: 7,
      },
    };

    const pending = writer.relocateBlocks(input);
    const request = worker.messages[0];
    expect(request?.type).toBe("relocateBlocks");
    if (!request || request.type !== "relocateBlocks") return;
    expect(request.payload.relocationId).toBe(input.relocationId);
    worker.emitMessage({
      id: request.id,
      ok: true,
      result: {
        ok: true,
        value: {
          relocationId: input.relocationId,
          projectId: input.projectId,
          storeEpoch: input.storeEpoch,
          duplicate: false,
          rootBlockIds: ["block-1"],
          movedBlockIds: ["block-1"],
          finalLocations: {
            "block-1": { kind: "document", documentId: "document:target" },
          },
          finalLocationRevisions: { "block-1": 2 },
          sourceCommit: {
            documentId: "document:source",
            generation: 1,
            baseHeadSeq: 3,
            headSeq: 4,
            updateId: "source-update",
            update: new Uint8Array([1, 2]),
            stateVector: new Uint8Array([3, 4]),
          },
          targetCommit: {
            documentId: "document:target",
            generation: 1,
            baseHeadSeq: 7,
            headSeq: 8,
            updateId: "target-update",
            update: new Uint8Array([5, 6]),
            stateVector: new Uint8Array([7, 8]),
          },
          changeLogSeq: 9,
          committedAt: "2026-07-11T00:00:00.000Z",
        },
      },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceCommit.update?.[1]).toBe(2);
    expect(result.value.targetCommit?.stateVector[1]).toBe(8);

    const duplicatePending = writer.relocateBlocks(input);
    const duplicateRequest = worker.messages[1];
    if (!duplicateRequest) return;
    worker.emitMessage({
      id: duplicateRequest.id,
      ok: true,
      result: {
        ok: true,
        value: {
          ...result.value,
          duplicate: true,
          sourceCommit: { ...result.value.sourceCommit, update: null },
          targetCommit: result.value.targetCommit
            ? { ...result.value.targetCommit, update: null }
            : undefined,
        },
      },
      events: [],
      metrics: makeMetrics(duplicateRequest.mutationId),
    });
    const duplicate = await duplicatePending;
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.value.duplicate).toBe(true);
    expect(duplicate.value.sourceCommit.update === null).toBe(true);
    expect(duplicate.value.targetCommit?.update === null).toBe(true);
  });

  test("places barriers after accepted work and gracefully drains before shutdown", async () => {
    const worker = new FakeWorker();
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
    });

    const mutationPending = writer.deleteCard("project-1", "draft", "card-1");
    const projectPending = writer.getBlockDocumentProjectId("document:card-1");
    let barrierResolved = false;
    const barrierPending = writer.barrier().then(() => {
      barrierResolved = true;
    });
    const shutdownPending = writer.shutdown();

    expect(worker.messages.length).toBe(4);
    expect(worker.messages[0]?.type).toBe("deleteCard");
    expect(worker.messages[1]?.type).toBe("getBlockDocumentProjectId");
    expect(worker.messages[2]?.type).toBe("writerBarrier");
    expect(worker.messages[3]?.type).toBe("shutdown");
    expect(worker.terminated).toBe(false);

    let rejectedMessage = "";
    try {
      await writer.deleteCard("project-1", "draft", "card-2");
    } catch (error) {
      rejectedMessage = error instanceof Error ? error.message : String(error);
    }
    expect(rejectedMessage).toBe("Card mutation writer is shutting down");

    const mutationRequest = worker.messages[0];
    const projectRequest = worker.messages[1];
    const barrierRequest = worker.messages[2];
    const shutdownRequest = worker.messages[3];
    if (!mutationRequest || !projectRequest || !barrierRequest || !shutdownRequest) return;

    worker.emitMessage({
      id: mutationRequest.id,
      ok: true,
      result: true,
      events: [],
      metrics: makeMetrics(mutationRequest.mutationId),
    });
    await mutationPending;
    expect(barrierResolved).toBe(false);

    worker.emitMessage({
      id: projectRequest.id,
      ok: true,
      result: { ok: true, value: "project-1" },
      events: [],
      metrics: makeMetrics(projectRequest.mutationId),
    });
    const projectResult = await projectPending;
    expect(projectResult.ok).toBe(true);
    if (projectResult.ok) {
      expect(projectResult.value).toBe("project-1");
    }
    expect(barrierResolved).toBe(false);

    worker.emitMessage({
      id: barrierRequest.id,
      ok: true,
      result: undefined,
      events: [],
      metrics: makeMetrics(barrierRequest.mutationId),
    });
    await barrierPending;
    expect(barrierResolved).toBe(true);
    expect(worker.terminated).toBe(false);

    worker.emitMessage({
      id: shutdownRequest.id,
      ok: true,
      result: undefined,
      events: [],
      metrics: makeMetrics(shutdownRequest.mutationId),
    });
    await shutdownPending;
    expect(worker.terminated).toBe(false);
    worker.emitExit(0);
  });

  test("suspends the worker connection for maintenance and resumes on a fresh worker", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const writer = new CardMutationWriter({
      createWorker: () => workers.shift() ?? secondWorker,
      publishBoardEvent: () => undefined,
    });

    const accepted = writer.getBlockDocumentProjectId("document:card-1");
    const suspended = writer.suspendForMaintenance();
    expect(firstWorker.messages[0]?.type).toBe("getBlockDocumentProjectId");
    expect(firstWorker.messages[1]?.type).toBe("shutdown");

    let rejectedMessage = "";
    try {
      await writer.getBlockDocumentProjectId("document:card-2");
    } catch (error) {
      rejectedMessage = error instanceof Error ? error.message : String(error);
    }
    expect(rejectedMessage).toBe("Card mutation writer is shutting down");

    const acceptedRequest = firstWorker.messages[0];
    const suspendRequest = firstWorker.messages[1];
    if (!acceptedRequest || !suspendRequest) return;
    firstWorker.emitMessage({
      id: acceptedRequest.id,
      ok: true,
      result: { ok: true, value: "project-1" },
      events: [],
      metrics: makeMetrics(acceptedRequest.mutationId),
    });
    expect((await accepted).ok).toBe(true);
    firstWorker.emitMessage({
      id: suspendRequest.id,
      ok: true,
      result: undefined,
      events: [],
      metrics: makeMetrics(suspendRequest.mutationId),
    });
    await suspended;
    expect(firstWorker.terminated).toBe(true);

    writer.resumeAfterMaintenance();
    const resumed = writer.getBlockDocumentProjectId("document:card-3");
    expect(secondWorker.messages[0]?.type).toBe("getBlockDocumentProjectId");
    const resumedRequest = secondWorker.messages[0];
    if (!resumedRequest) return;
    secondWorker.emitMessage({
      id: resumedRequest.id,
      ok: true,
      result: { ok: true, value: "project-1" },
      events: [],
      metrics: makeMetrics(resumedRequest.mutationId),
    });
    expect((await resumed).ok).toBe(true);

    const finalShutdown = writer.shutdown();
    const shutdownRequest = secondWorker.messages[1];
    if (!shutdownRequest) return;
    secondWorker.emitMessage({
      id: shutdownRequest.id,
      ok: true,
      result: undefined,
      events: [],
      metrics: makeMetrics(shutdownRequest.mutationId),
    });
    await finalShutdown;
  });

  test("recovers to a fresh accepting worker when maintenance suspend fails", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const writer = new CardMutationWriter({
      createWorker: () => workers.shift() ?? secondWorker,
      publishBoardEvent: () => undefined,
    });

    const first = writer.getBlockDocumentProjectId("document:card-1");
    const firstSettled = first.catch(() => undefined);
    const suspended = writer.suspendForMaintenance().then(
      () => "resolved",
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );
    firstWorker.emitError(new Error("injected worker failure"));
    expect(await suspended).toBe("injected worker failure");
    await firstSettled;
    expect(firstWorker.terminated).toBe(true);

    const resumed = writer.getBlockDocumentProjectId("document:card-2");
    const request = secondWorker.messages[0];
    expect(request?.type).toBe("getBlockDocumentProjectId");
    if (!request) return;
    secondWorker.emitMessage({
      id: request.id,
      ok: true,
      result: { ok: true, value: "project-1" },
      events: [],
      metrics: makeMetrics(request.mutationId),
    });
    expect((await resumed).ok).toBe(true);
  });

  test("uses forced termination only after the graceful shutdown deadline", async () => {
    const worker = new FakeWorker();
    const scheduled: { deadline?: () => void } = {};
    let scheduledTimeoutMs = 0;
    let deadlineCancelled = false;
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: () => undefined,
      shutdownTimeoutMs: 123,
      scheduleShutdownDeadline: (callback, timeoutMs) => {
        scheduled.deadline = callback;
        scheduledTimeoutMs = timeoutMs;
        return () => {
          deadlineCancelled = true;
        };
      },
    });

    const mutationPending = writer.deleteCard("project-1", "draft", "card-1")
      .then(() => "resolved", (error: unknown) =>
        error instanceof Error ? error.message : String(error));
    const shutdownPending = writer.shutdown()
      .then(() => "resolved", (error: unknown) =>
        error instanceof Error ? error.message : String(error));

    expect(worker.terminated).toBe(false);
    expect(scheduledTimeoutMs).toBe(123);
    expect(scheduled.deadline !== undefined).toBe(true);
    scheduled.deadline?.();

    expect(await mutationPending).toBe(
      "Card mutation writer did not drain within 123ms",
    );
    expect(await shutdownPending).toBe(
      "Card mutation writer did not drain within 123ms",
    );
    expect(worker.terminated).toBe(true);
    expect(deadlineCancelled).toBe(true);
  });
});
