import { describe, expect, test } from "bun:test";
import { CardMutationWriter, type CardMutationWorkerLike } from "./card-mutation-writer";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type { CardMutationMetrics, CardMutationWorkerMessage, CardMutationWorkerRequest } from "./card-mutation-worker-protocol";
import type { CardSummary } from "../shared/types";

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
});
