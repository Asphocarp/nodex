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
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRequest,
  DocumentSyncResponse,
  OwnedBlockDocumentDescriptor,
} from "../shared/block-documents";
import type { CutoverCardDocumentInput } from "./local-store/block-document-cutover";
import type {
  BlockDropImportInput,
  BlockDropImportResult,
  Card,
  CardCreateInput,
  CardCreatePlacement,
  CardEditorDropInput,
  CardEditorDropResult,
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
  BlockDocumentShadowInitializationResult,
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
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

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

export type CardMutationWriterShutdownDeadline = (
  callback: () => void,
  timeoutMs: number,
) => () => void;

export interface CardMutationWriterOptions {
  createWorker?: () => CardMutationWorkerLike;
  publishBoardEvent?: (event: BoardChangeEvent, metrics: CardMutationMetrics) => void;
  scheduleShutdownDeadline?: CardMutationWriterShutdownDeadline;
  shutdownTimeoutMs?: number;
}

interface PendingRequest {
  request: CardMutationWorkerRequest;
  resolve: (response: CardMutationWorkerResponse) => void;
  reject: (error: Error) => void;
  warnTimer: ReturnType<typeof setTimeout>;
}

export class CardMutationWriter {
  private worker: Worker | null = null;
  private lifecycle: "accepting" | "draining" | "stopped" = "accepting";
  private gracefulExitExpected = false;
  private shutdownPromise: Promise<void> | null = null;
  private cancelShutdownDeadline: (() => void) | null = null;
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

  async applyCardEditorDrop(
    projectId: string,
    input: CardEditorDropInput,
    sessionId?: string,
  ): Promise<CardMutationEnvelope<CardEditorDropResult>> {
    return await this.executeTyped<CardEditorDropResult>({
      type: "applyCardEditorDrop",
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

  async initializeBlockDocumentShadows(): Promise<
    CardMutationEnvelope<BlockDocumentShadowInitializationResult>
  > {
    return await this.executeTyped<BlockDocumentShadowInitializationResult>({
      type: "initializeBlockDocumentShadows",
    });
  }

  async syncBlockDocument(
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> {
    const envelope = await this.executeTyped<DocumentSyncCommandResult<DocumentSyncResponse>>({
      type: "syncBlockDocument",
      payload: request,
    });
    return envelope.result;
  }

  async getBlockDocumentProjectId(
    documentId: string,
  ): Promise<DocumentSyncCommandResult<string>> {
    const envelope = await this.executeTyped<DocumentSyncCommandResult<string>>({
      type: "getBlockDocumentProjectId",
      payload: { documentId },
    });
    return envelope.result;
  }

  async getOwnedBlockDocumentDescriptor(
    projectId: string,
    ownerBlockId: string,
  ): Promise<CardMutationEnvelope<OwnedBlockDocumentDescriptor>> {
    return await this.executeTyped<OwnedBlockDocumentDescriptor>({
      type: "getOwnedBlockDocumentDescriptor",
      payload: { projectId, ownerBlockId },
    });
  }

  async cutoverCardDocumentToPrimary(
    input: CutoverCardDocumentInput,
  ): Promise<CardMutationEnvelope<OwnedBlockDocumentDescriptor>> {
    return await this.executeTyped<OwnedBlockDocumentDescriptor>({
      type: "cutoverCardDocumentToPrimary",
      payload: input,
    });
  }

  async applyBlockDocumentUpdate(
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>> {
    const envelope = await this.executeTyped<DocumentSyncCommandResult<DocumentSyncApplyAck>>({
      type: "applyBlockDocumentUpdate",
      payload: request,
    });
    return envelope.result;
  }

  async barrier(): Promise<void> {
    if (this.lifecycle === "stopped") {
      return;
    }
    if (this.lifecycle === "draining") {
      await this.shutdownPromise;
      return;
    }
    if (!this.worker) {
      return;
    }

    await this.executeTyped<void>({ type: "writerBarrier" });
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    if (this.lifecycle === "stopped") {
      return Promise.resolve();
    }

    this.lifecycle = "draining";
    if (!this.worker) {
      this.lifecycle = "stopped";
      this.shutdownPromise = Promise.resolve();
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.executeTyped<void>(
      { type: "shutdown" },
      { allowDuringDrain: true },
    ).then(() => undefined).finally(() => {
      this.cancelShutdownDeadline?.();
      this.cancelShutdownDeadline = null;
      this.lifecycle = "stopped";
    });
    this.cancelShutdownDeadline = this.scheduleShutdownDeadline(() => {
      const timeoutMs = this.shutdownTimeoutMs();
      const error = new Error(
        `Card mutation writer did not drain within ${timeoutMs}ms`,
      );
      logger.error("Card mutation writer graceful shutdown timed out", {
        pendingCount: this.pending.size,
        timeoutMs,
      });
      const worker = this.worker;
      this.handleWorkerFailure(error);
      if (worker) {
        void worker.terminate();
      }
    });
    return this.shutdownPromise;
  }

  private scheduleShutdownDeadline(callback: () => void): () => void {
    const timeoutMs = this.shutdownTimeoutMs();
    if (this.options.scheduleShutdownDeadline) {
      return this.options.scheduleShutdownDeadline(callback, timeoutMs);
    }

    const timer = setTimeout(callback, timeoutMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  }

  private shutdownTimeoutMs(): number {
    const configured = this.options.shutdownTimeoutMs;
    if (configured !== undefined && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  }

  private async executeTyped<T>(
    input: CardMutationWorkerRequestInput,
    options?: { readonly allowDuringDrain?: boolean },
  ): Promise<CardMutationEnvelope<T>> {
    const envelope = await this.execute(input, options);
    return {
      ...envelope,
      result: envelope.result as T,
    };
  }

  private async execute(
    input: CardMutationWorkerRequestInput,
    options?: { readonly allowDuringDrain?: boolean },
  ): Promise<CardMutationEnvelope<CardMutationWorkerResult>> {
    if (
      this.lifecycle !== "accepting"
      && !options?.allowDuringDrain
    ) {
      throw new Error("Card mutation writer is shutting down");
    }
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
      try {
        worker.postMessage(request);
      } catch (error) {
        clearTimeout(warnTimer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
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
      this.worker = null;
      if (this.gracefulExitExpected) {
        this.gracefulExitExpected = false;
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
    if (pending.request.type === "shutdown") {
      this.gracefulExitExpected = true;
    }
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
    this.gracefulExitExpected = false;
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
