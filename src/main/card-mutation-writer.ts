import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { getLocalStoreDir } from "./local-store/config";
import { dbNotifier, type ChangeType } from "./local-store/notifier";
import { getLogger } from "./logging/logger";
import type {
  BoardChangeEvent,
  UndoRedoResult,
} from "../shared/ipc-api";
import type {
  BlockDropImportInput,
  BlockDropImportResult,
  Card,
  CardCreateInput,
  CardCreatePlacement,
  CardDropMoveToEditorInput,
  CardDropMoveToEditorResult,
  CardInput,
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
  CardUpdateResult,
  MoveCardInput,
  MoveCardsInput,
  MoveCardToProjectInput,
  MoveCardToProjectResult,
} from "../shared/types";
import type {
  CardMutationMetrics,
  CardMutationWorkerEvent,
  CardMutationWorkerMessage,
  CardMutationWorkerRequest,
  CardMutationWorkerResponse,
  CardMutationWorkerResult,
  CardOccurrenceMutationResult,
  CardHistoryVersionPreviewResult,
  CardReadModelBackfillResult,
  HistoryMutationResult,
} from "./card-mutation-worker-protocol";

const LONG_MUTATION_WARN_MS = 1_000;

const logger = getLogger({ subsystem: "ipc", component: "card-mutation-writer" });

type CardMutationWorkerRequestInput = CardMutationWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id" | "mutationId" | "queuedAtEpochMs">
    : never
  : never;

export interface CardMutationEnvelope<T> {
  result: T;
  events: BoardChangeEvent[];
  metrics: CardMutationMetrics;
}

export interface CardMutationWorkerLike {
  postMessage(message: CardMutationWorkerRequest): void;
  on(event: "message", listener: (message: CardMutationWorkerMessage) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
  removeAllListeners(): void;
  terminate(): unknown;
}

export interface CardMutationWriterOptions {
  createWorker?: () => CardMutationWorkerLike;
  publishBoardEvent?: (event: BoardChangeEvent, metrics: CardMutationMetrics) => void;
}

interface PendingRequest {
  request: CardMutationWorkerRequest;
  resolve: (response: CardMutationWorkerResponse) => void;
  reject: (error: Error) => void;
  warnTimer: ReturnType<typeof setTimeout>;
}

export class CardMutationWriter {
  private worker: Worker | null = null;
  private terminating = false;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(private readonly options: CardMutationWriterOptions = {}) {}

  async createCard(
    projectId: string,
    columnId: Card["status"],
    input: CardCreateInput,
    sessionId?: string,
    placement?: CardCreatePlacement,
  ): Promise<CardMutationEnvelope<Card>> {
    return await this.executeTyped<Card>({
      type: "createCard",
      payload: { projectId, columnId, input, sessionId, placement },
    });
  }

  async updateCard(
    projectId: string,
    columnId: Card["status"] | undefined,
    cardId: string,
    updates: Partial<CardInput>,
    sessionId?: string,
    expectedRevision?: number,
  ): Promise<CardMutationEnvelope<CardUpdateResult>> {
    return await this.executeTyped<CardUpdateResult>({
      type: "updateCard",
      payload: { projectId, columnId, cardId, updates, sessionId, expectedRevision },
    });
  }

  async updateCardDescriptionFromFile(
    projectId: string,
    columnId: Card["status"] | undefined,
    cardId: string,
    descriptionFilePath: string,
    sessionId?: string,
    expectedRevision?: number,
  ): Promise<CardMutationEnvelope<CardUpdateResult>> {
    return await this.executeTyped<CardUpdateResult>({
      type: "updateCardDescriptionFromFile",
      payload: { projectId, columnId, cardId, descriptionFilePath, sessionId, expectedRevision },
    });
  }

  async deleteCard(
    projectId: string,
    columnId: Card["status"] | undefined,
    cardId: string,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<boolean>> {
    return await this.executeTyped<boolean>({
      type: "deleteCard",
      payload: { projectId, columnId, cardId, sessionId },
    });
  }

  async moveCard(
    input: MoveCardInput & { projectId: string; sessionId?: string },
  ): Promise<CardMutationEnvelope<"moved" | "not_found" | "wrong_column">> {
    return await this.executeTyped<"moved" | "not_found" | "wrong_column">({
      type: "moveCard",
      payload: input,
    });
  }

  async moveCards(
    input: MoveCardsInput & { projectId: string; sessionId?: string },
  ): Promise<CardMutationEnvelope<"moved" | "not_found" | "wrong_column">> {
    return await this.executeTyped<"moved" | "not_found" | "wrong_column">({
      type: "moveCards",
      payload: input,
    });
  }

  async moveCardToProject(
    input: MoveCardToProjectInput & { sessionId?: string },
  ): Promise<CardMutationEnvelope<MoveCardToProjectResult | "not_found" | "wrong_column" | "target_project_not_found">> {
    return await this.executeTyped<MoveCardToProjectResult | "not_found" | "wrong_column" | "target_project_not_found">(
      {
        type: "moveCardToProject",
        payload: input,
      },
    );
  }

  async importBlockDropAsCards(
    projectId: string,
    input: BlockDropImportInput,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<BlockDropImportResult>> {
    return await this.executeTyped<BlockDropImportResult>({
      type: "importBlockDropAsCards",
      payload: { projectId, input, sessionId },
    });
  }

  async moveCardDropToEditor(
    projectId: string,
    input: CardDropMoveToEditorInput,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<CardDropMoveToEditorResult>> {
    return await this.executeTyped<CardDropMoveToEditorResult>({
      type: "moveCardDropToEditor",
      payload: { projectId, input, sessionId },
    });
  }

  async completeCardOccurrence(
    projectId: string,
    input: CardOccurrenceActionInput,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<CardOccurrenceMutationResult>> {
    return await this.executeTyped<CardOccurrenceMutationResult>({
      type: "completeCardOccurrence",
      payload: { projectId, input, sessionId },
    });
  }

  async skipCardOccurrence(
    projectId: string,
    input: CardOccurrenceActionInput,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<CardOccurrenceMutationResult>> {
    return await this.executeTyped<CardOccurrenceMutationResult>({
      type: "skipCardOccurrence",
      payload: { projectId, input, sessionId },
    });
  }

  async updateCardOccurrence(
    projectId: string,
    input: CardOccurrenceUpdateInput,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<CardOccurrenceMutationResult>> {
    return await this.executeTyped<CardOccurrenceMutationResult>({
      type: "updateCardOccurrence",
      payload: { projectId, input, sessionId },
    });
  }

  async undoLatest(projectId: string, sessionId?: string): Promise<CardMutationEnvelope<UndoRedoResult>> {
    return await this.executeTyped<UndoRedoResult>({
      type: "undoLatest",
      payload: { projectId, sessionId },
    });
  }

  async redoLatest(projectId: string, sessionId?: string): Promise<CardMutationEnvelope<UndoRedoResult>> {
    return await this.executeTyped<UndoRedoResult>({
      type: "redoLatest",
      payload: { projectId, sessionId },
    });
  }

  async revertEntry(
    projectId: string,
    historyId: number,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<HistoryMutationResult>> {
    return await this.executeTyped<HistoryMutationResult>({
      type: "revertEntry",
      payload: { projectId, historyId, sessionId },
    });
  }

  async restoreToEntry(
    projectId: string,
    cardId: string,
    historyId: number,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<HistoryMutationResult>> {
    return await this.executeTyped<HistoryMutationResult>({
      type: "restoreToEntry",
      payload: { projectId, cardId, historyId, sessionId },
    });
  }

  async getCardHistoryVersionPreview(
    projectId: string,
    cardId: string,
    historyId: number,
  ): Promise<CardMutationEnvelope<CardHistoryVersionPreviewResult>> {
    return await this.executeTyped<CardHistoryVersionPreviewResult>({
      type: "getCardHistoryVersionPreview",
      payload: { projectId, cardId, historyId },
    });
  }

  async backfillCardReadModel(limit?: number): Promise<CardMutationEnvelope<CardReadModelBackfillResult>> {
    return await this.executeTyped<CardReadModelBackfillResult>({
      type: "backfillCardReadModel",
      payload: { limit },
    });
  }

  shutdown(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.warnTimer);
      pending.reject(new Error("Card mutation writer shut down"));
      this.pending.delete(id);
    }

    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    this.terminating = true;
    void worker.terminate();
  }

  private async executeTyped<T>(input: CardMutationWorkerRequestInput): Promise<CardMutationEnvelope<T>> {
    const envelope = await this.execute(input);
    return {
      ...envelope,
      result: envelope.result as T,
    };
  }

  private async execute(
    input: CardMutationWorkerRequestInput,
  ): Promise<CardMutationEnvelope<CardMutationWorkerResult>> {
    const worker = this.ensureWorker();
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const request = {
      ...input,
      id,
      mutationId: randomUUID(),
      queuedAtEpochMs: Date.now(),
    } as CardMutationWorkerRequest;

    const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
    eventLoopDelay.enable();
    const response = await new Promise<CardMutationWorkerResponse>((resolve, reject) => {
      const warnTimer = setTimeout(() => {
        logger.warn("Card mutation still running", {
          mutationId: request.mutationId,
          requestType: request.type,
          elapsedMs: Date.now() - request.queuedAtEpochMs,
        });
      }, LONG_MUTATION_WARN_MS);
      this.pending.set(id, { request, resolve, reject, warnTimer });
      worker.postMessage(request);
    }).finally(() => {
      eventLoopDelay.disable();
    });

    if (!response.ok) {
      throw new Error(response.error);
    }

    response.metrics.mainEventLoopLagMaxMs = Math.round(eventLoopDelay.max / 1_000_000);
    this.publishBoardEvents(response.events, response.metrics);

    return {
      result: response.result,
      events: response.events,
      metrics: response.metrics,
    };
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    this.worker = this.createWorker();
    this.worker.on("message", (message: CardMutationWorkerMessage) => this.handleWorkerMessage(message));
    this.worker.on("error", (error) => {
      this.handleWorkerFailure(error instanceof Error ? error : new Error(String(error)));
    });
    this.worker.on("exit", (code) => {
      if (this.terminating) {
        this.terminating = false;
        return;
      }
      const message = code === 0
        ? "Card mutation worker exited unexpectedly"
        : `Card mutation worker exited with code ${code}`;
      this.handleWorkerFailure(new Error(message));
    });
    logger.info("Started card mutation worker");
    return this.worker;
  }

  private handleWorkerMessage(message: CardMutationWorkerMessage): void {
    if ("type" in message) {
      this.handleWorkerEvent(message);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.warnTimer);
    pending.resolve(message);
  }

  private handleWorkerEvent(event: CardMutationWorkerEvent): void {
    if (event.payload.level === "debug") {
      logger.debug(event.payload.message, event.payload.data);
      return;
    }
    if (event.payload.level === "info") {
      logger.info(event.payload.message, event.payload.data);
      return;
    }
    if (event.payload.level === "warn") {
      logger.warn(event.payload.message, event.payload.data);
      return;
    }
    logger.error(event.payload.message, event.payload.data);
  }

  private handleWorkerFailure(error: Error): void {
    logger.warn("Card mutation worker failed", { error: error.message });
    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker = null;
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.warnTimer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private createWorker(): Worker {
    if (this.options.createWorker) {
      return this.options.createWorker() as Worker;
    }

    const workerUrl = new URL("./card-mutation-worker.js", import.meta.url);
    return new Worker(workerUrl, {
      env: {
        ...process.env,
        NODEX_DIR: getLocalStoreDir(),
      },
    });
  }

  private publishBoardEvents(events: readonly BoardChangeEvent[], metrics: CardMutationMetrics): void {
    for (const event of events) {
      if (this.options.publishBoardEvent) {
        this.options.publishBoardEvent(event, metrics);
        continue;
      }

      dbNotifier.notifyChange(
        event.projectId,
        event.changeType as ChangeType,
        event.status,
        event.cardId,
        {
          summary: event.summary,
          mutationId: event.mutationId ?? metrics.mutationId,
          metrics: event.metrics ?? {
            workerDurationMs: metrics.workerDurationMs,
            queueWaitMs: metrics.queueWaitMs,
            transactionMs: metrics.transactionMs,
          },
        },
      );
    }
  }
}

export const cardMutationWriter = new CardMutationWriter();
