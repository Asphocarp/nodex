import { describe, expect, test } from "bun:test";
import { CardMutationWriter, type CardMutationWorkerLike } from "./card-mutation-writer";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type { CardMutationMetrics, CardMutationWorkerMessage, CardMutationWorkerRequest } from "./card-mutation-worker-protocol";
import type { CardSummary } from "../shared/types";
import type { DocumentSyncApplyRequest } from "../shared/block-documents";

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
  test("resolves worker ack and republishes board events", async () => {
    const worker = new FakeWorker();
    const published: BoardChangeEvent[] = [];
    const writer = new CardMutationWriter({
      createWorker: () => worker,
      publishBoardEvent: (event) => {
        published.push(event);
      },
    });

    const summary = makeSummary();
    const pending = writer.updateCard("project-1", "draft", "card-1", { title: "Next" });
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
        changedFields: ["title"],
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
    expect(envelope.metrics.mainEventLoopLagMaxMs !== undefined).toBeTrue();
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
    expect(syncResult.ok).toBeTrue();
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
    expect(projectResult.ok).toBeFalse();
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
    expect(applyResult.ok).toBeFalse();
    if (applyResult.ok) return;
    expect(applyResult.error.code).toBe("document_update_missing_dependencies");
    expect(applyResult.error.retryable).toBeTrue();
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
    expect(worker.terminated).toBeFalse();

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
    expect(barrierResolved).toBeFalse();

    worker.emitMessage({
      id: projectRequest.id,
      ok: true,
      result: { ok: true, value: "project-1" },
      events: [],
      metrics: makeMetrics(projectRequest.mutationId),
    });
    const projectResult = await projectPending;
    expect(projectResult.ok).toBeTrue();
    if (projectResult.ok) {
      expect(projectResult.value).toBe("project-1");
    }
    expect(barrierResolved).toBeFalse();

    worker.emitMessage({
      id: barrierRequest.id,
      ok: true,
      result: undefined,
      events: [],
      metrics: makeMetrics(barrierRequest.mutationId),
    });
    await barrierPending;
    expect(barrierResolved).toBeTrue();
    expect(worker.terminated).toBeFalse();

    worker.emitMessage({
      id: shutdownRequest.id,
      ok: true,
      result: undefined,
      events: [],
      metrics: makeMetrics(shutdownRequest.mutationId),
    });
    await shutdownPending;
    expect(worker.terminated).toBeFalse();
    worker.emitExit(0);
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

    expect(worker.terminated).toBeFalse();
    expect(scheduledTimeoutMs).toBe(123);
    expect(scheduled.deadline !== undefined).toBeTrue();
    scheduled.deadline?.();

    expect(await mutationPending).toBe(
      "Card mutation writer did not drain within 123ms",
    );
    expect(await shutdownPending).toBe(
      "Card mutation writer did not drain within 123ms",
    );
    expect(worker.terminated).toBeTrue();
    expect(deadlineCancelled).toBeTrue();
  });
});
