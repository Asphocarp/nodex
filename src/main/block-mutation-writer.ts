import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { getLocalStoreDir } from "./local-store/config";
import { dbNotifier, type ChangeType } from "./local-store/notifier";
import { getLogger } from "./logging/logger";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type {
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentMutationRequest,
  DocumentOperationCommandResult,
  DocumentWriteFenceProof,
  OwnedBlockDocumentDescriptor,
  RelocateBlocks,
  RelocationCommandResult,
  RelocationIntent,
  RelocationResult,
} from "../shared/block-documents";
import type {
  CreateDocumentVersionCheckpoint,
  CreatedDocumentVersionSummary,
  DocumentVersionDetail,
  DocumentVersionSummary,
  GetDocumentVersion,
  ListDocumentVersions,
} from "../shared/block-documents/document-history";
import type { DocumentHistoryCommandResult } from "../shared/block-documents/document-history-transport";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../shared/block-property-mutations";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../shared/database-kernel";
import {
  DATABASE_CHANGE_EVENT_VERSION,
  type DatabaseChangeEvent,
} from "../shared/database-events";
import type {
  DatabaseCatalogSnapshotCommandResult,
  DatabaseManagementSnapshotCommandResult,
  DatabaseReadCommandResult,
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "../shared/database-query";
import type {
  CardLifecycleMutationCommandResult,
  CardLifecycleMutationRequest,
} from "../shared/card-lifecycle";
import type { CardLifecyclePreflightResult } from "../shared/card-lifecycle-runtime";
import type { ListCardHistoryRequest } from "../shared/card-history";
import type { CardHistoryCommandResult } from "../shared/card-history-transport";
import type {
  AdditionalDocumentCommandRequest,
  AdditionalDocumentCommandResult,
} from "../shared/additional-document-commands";
import type {
  CardProjectTransferCommandResult,
  CardProjectTransferIntent,
  CardProjectTransferPreparation,
  CardProjectTransferRequest,
} from "../shared/card-project-transfer";
import type {
  CompactEligibleBlockDocumentsInput,
  CompactEligibleBlockDocumentsResult,
} from "./local-store/block-document-compaction";
import type { RepairDocumentSecondaryProjectionsResult } from "./local-store/block-document-projections";
import type {
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
} from "../shared/types";
import type {
  CardMutationMetrics,
  CardMutationWorkerEvent,
  CardMutationWorkerMessage,
  CardMutationWorkerRequest,
  CardMutationWorkerResponse,
  CardMutationWorkerResult,
  CardOccurrenceMutationResult,
} from "./card-mutation-worker-protocol";

const LONG_MUTATION_WARN_MS = 1_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

const logger = getLogger({
  subsystem: "ipc",
  component: "card-mutation-writer",
});

type CardMutationWorkerRequestInput =
  CardMutationWorkerRequest extends infer Request
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
  on(
    event: "message",
    listener: (message: CardMutationWorkerMessage) => void,
  ): void;
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
  publishBoardEvent?: (
    event: BoardChangeEvent,
    metrics: CardMutationMetrics,
  ) => void;
  publishDatabaseEvent?: (
    event: DatabaseChangeEvent,
    metrics: CardMutationMetrics,
  ) => void;
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
  private lifecycle: "accepting" | "draining" | "suspended" | "stopped" =
    "accepting";
  private gracefulExitExpected = false;
  private shutdownPromise: Promise<void> | null = null;
  private maintenanceSuspendPromise: Promise<void> | null = null;
  private cancelShutdownDeadline: (() => void) | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(private readonly options: CardMutationWriterOptions = {}) {}

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

  async repairDocumentSecondaryProjections(): Promise<
    CardMutationEnvelope<RepairDocumentSecondaryProjectionsResult>
  > {
    return await this.executeTyped<RepairDocumentSecondaryProjectionsResult>({
      type: "repairDocumentSecondaryProjections",
    });
  }

  async applyBlockPropertyMutation(
    request: BlockPropertyMutationRequest,
  ): Promise<CardMutationEnvelope<BlockPropertyMutationCommandResult>> {
    return await this.executeTyped<BlockPropertyMutationCommandResult>({
      type: "applyBlockPropertyMutation",
      payload: request,
    });
  }

  async applyDatabaseMutation(
    request: DatabaseMutationRequest,
  ): Promise<CardMutationEnvelope<DatabaseMutationCommandResult>> {
    const envelope = await this.executeTyped<DatabaseMutationCommandResult>({
      type: "applyDatabaseMutation",
      payload: request,
    });
    if (envelope.result.ok && !envelope.result.value.duplicate) {
      this.publishDatabaseEvent(
        {
          version: DATABASE_CHANGE_EVENT_VERSION,
          projectId: envelope.result.value.projectId,
          storeEpoch: envelope.result.value.storeEpoch,
          operationId: envelope.result.value.operationId,
          sourceKind: "database_mutation",
          affectedDatabaseBlockIds:
            envelope.result.value.affectedDatabaseBlockIds,
          changeLogSeq: envelope.result.value.changeLogSeq,
        },
        envelope.metrics,
      );
    }
    return envelope;
  }

  async applyCardLifecycleMutation(
    request: CardLifecycleMutationRequest,
  ): Promise<CardMutationEnvelope<CardLifecycleMutationCommandResult>> {
    const envelope =
      await this.executeTyped<CardLifecycleMutationCommandResult>({
        type: "applyCardLifecycleMutation",
        payload: request,
      });
    const result = envelope.result;
    if (result.ok && !result.value.duplicate && result.value.databaseBlockId) {
      this.publishDatabaseEvent(
        {
          version: DATABASE_CHANGE_EVENT_VERSION,
          projectId: result.value.projectId,
          storeEpoch: result.value.storeEpoch,
          operationId: result.value.operationId,
          sourceKind: "card_lifecycle",
          affectedDatabaseBlockIds: [result.value.databaseBlockId],
          changeLogSeq: result.value.changeLogSeq,
        },
        envelope.metrics,
      );
    }
    return envelope;
  }

  async readCardLifecyclePreflight(
    projectId: string,
    cardId: string,
  ): Promise<CardMutationEnvelope<CardLifecyclePreflightResult>> {
    return await this.executeTyped<CardLifecyclePreflightResult>({
      type: "readCardLifecyclePreflight",
      payload: { projectId, cardId },
    });
  }

  async compactEligibleBlockDocuments(
    input: CompactEligibleBlockDocumentsInput,
  ): Promise<CardMutationEnvelope<CompactEligibleBlockDocumentsResult>> {
    return await this.executeTyped<CompactEligibleBlockDocumentsResult>({
      type: "compactEligibleBlockDocuments",
      payload: input,
    });
  }

  async readDatabaseDescriptor(
    projectId: string,
    databaseBlockId: string,
  ): Promise<
    CardMutationEnvelope<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>
  > {
    return await this.executeTyped<
      DatabaseReadCommandResult<GeneralDatabaseDescriptor>
    >({
      type: "readDatabaseDescriptor",
      payload: { projectId, databaseBlockId },
    });
  }

  async readDatabaseCatalog(
    projectId: string,
  ): Promise<CardMutationEnvelope<DatabaseCatalogSnapshotCommandResult>> {
    return await this.executeTyped<DatabaseCatalogSnapshotCommandResult>({
      type: "readDatabaseCatalog",
      payload: { projectId },
    });
  }

  async readDatabaseManagement(
    projectId: string,
  ): Promise<CardMutationEnvelope<DatabaseManagementSnapshotCommandResult>> {
    return await this.executeTyped<DatabaseManagementSnapshotCommandResult>({
      type: "readDatabaseManagement",
      payload: { projectId },
    });
  }

  async readPrimaryDatabaseDescriptor(
    projectId: string,
  ): Promise<
    CardMutationEnvelope<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>
  > {
    return await this.executeTyped<
      DatabaseReadCommandResult<GeneralDatabaseDescriptor>
    >({
      type: "readPrimaryDatabaseDescriptor",
      payload: { projectId },
    });
  }

  async readPrimaryDatabaseViewSnapshot(
    projectId: string,
  ): Promise<CardMutationEnvelope<PrimaryDatabaseViewSnapshotCommandResult>> {
    return await this.executeTyped<PrimaryDatabaseViewSnapshotCommandResult>({
      type: "readPrimaryDatabaseViewSnapshot",
      payload: { projectId },
    });
  }

  async readDatabaseViewSnapshot(
    projectId: string,
    viewId: string,
  ): Promise<CardMutationEnvelope<DatabaseViewSnapshotCommandResult>> {
    return await this.executeTyped<DatabaseViewSnapshotCommandResult>({
      type: "readDatabaseViewSnapshot",
      payload: { projectId, viewId },
    });
  }

  async queryDatabaseView(
    projectId: string,
    viewId: string,
  ): Promise<
    CardMutationEnvelope<DatabaseReadCommandResult<GeneralDatabaseViewQuery>>
  > {
    return await this.executeTyped<
      DatabaseReadCommandResult<GeneralDatabaseViewQuery>
    >({
      type: "queryDatabaseView",
      payload: { projectId, viewId },
    });
  }

  async syncBlockDocument(
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> {
    const envelope = await this.executeTyped<
      DocumentSyncCommandResult<DocumentSyncResponse>
    >({
      type: "syncBlockDocument",
      payload: request,
    });
    return envelope.result;
  }

  async getBlockDocumentProjectId(
    documentId: string,
  ): Promise<DocumentSyncCommandResult<string>> {
    const envelope = await this.executeTyped<DocumentSyncCommandResult<string>>(
      {
        type: "getBlockDocumentProjectId",
        payload: { documentId },
      },
    );
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

  async prepareOwnedBlockDocument(
    projectId: string,
    ownerBlockId: string,
  ): Promise<DocumentSyncCommandResult<OwnedBlockDocumentDescriptor>> {
    const envelope = await this.executeTyped<
      DocumentSyncCommandResult<OwnedBlockDocumentDescriptor>
    >({
      type: "prepareOwnedBlockDocument",
      payload: { projectId, ownerBlockId },
    });
    return envelope.result;
  }

  async applyBlockDocumentUpdate(
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>> {
    const envelope = await this.executeTyped<
      DocumentSyncCommandResult<DocumentSyncApplyAck>
    >({
      type: "applyBlockDocumentUpdate",
      payload: request,
    });
    return envelope.result;
  }

  async applyDocumentMutation(
    request: DocumentMutationRequest,
    writeFence?: DocumentWriteFenceProof,
  ): Promise<DocumentOperationCommandResult> {
    const envelope = await this.executeTyped<DocumentOperationCommandResult>({
      type: "applyDocumentMutation",
      payload: {
        request,
        ...(writeFence ? { writeFence } : {}),
      },
    });
    return envelope.result;
  }

  async applyAdditionalDocumentCommand(
    request: AdditionalDocumentCommandRequest,
  ): Promise<AdditionalDocumentCommandResult> {
    const envelope = await this.executeTyped<AdditionalDocumentCommandResult>({
      type: "applyAdditionalDocumentCommand",
      payload: request,
    });
    return envelope.result;
  }

  async createDocumentVersionCheckpoint(
    request: CreateDocumentVersionCheckpoint,
  ): Promise<DocumentHistoryCommandResult<CreatedDocumentVersionSummary>> {
    const envelope = await this.executeTyped<
      DocumentHistoryCommandResult<CreatedDocumentVersionSummary>
    >({
      type: "createDocumentVersionCheckpoint",
      payload: request,
    });
    return envelope.result;
  }

  async listDocumentVersions(
    request: ListDocumentVersions,
  ): Promise<DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>> {
    const envelope = await this.executeTyped<
      DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>
    >({
      type: "listDocumentVersions",
      payload: request,
    });
    return envelope.result;
  }

  async getDocumentVersion(
    request: GetDocumentVersion,
  ): Promise<DocumentHistoryCommandResult<DocumentVersionDetail>> {
    const envelope = await this.executeTyped<
      DocumentHistoryCommandResult<DocumentVersionDetail>
    >({
      type: "getDocumentVersion",
      payload: request,
    });
    return envelope.result;
  }

  async listCardHistory(
    request: ListCardHistoryRequest,
  ): Promise<CardHistoryCommandResult> {
    const envelope = await this.executeTyped<CardHistoryCommandResult>({
      type: "listCardHistory",
      payload: request,
    });
    return envelope.result;
  }

  async relocateBlocks(
    request: RelocateBlocks,
  ): Promise<RelocationCommandResult> {
    const envelope = await this.executeTyped<RelocationCommandResult>({
      type: "relocateBlocks",
      payload: request,
    });
    return envelope.result;
  }

  async prepareRelocationCommand(
    intent: RelocationIntent,
  ): Promise<RelocationCommandResult<RelocateBlocks>> {
    const envelope = await this.executeTyped<
      RelocationCommandResult<RelocateBlocks>
    >({
      type: "prepareRelocationCommand",
      payload: intent,
    });
    return envelope.result;
  }

  async readCommittedRelocation(
    intent: RelocationIntent,
  ): Promise<RelocationCommandResult<RelocationResult | null>> {
    const envelope = await this.executeTyped<
      RelocationCommandResult<RelocationResult | null>
    >({
      type: "readCommittedRelocation",
      payload: intent,
    });
    return envelope.result;
  }

  async prepareCardProjectTransfer(
    intent: CardProjectTransferIntent,
  ): Promise<CardProjectTransferCommandResult<CardProjectTransferPreparation>> {
    const envelope = await this.executeTyped<
      CardProjectTransferCommandResult<CardProjectTransferPreparation>
    >({
      type: "prepareCardProjectTransfer",
      payload: intent,
    });
    return envelope.result;
  }

  async applyCardProjectTransfer(
    request: CardProjectTransferRequest,
  ): Promise<CardProjectTransferCommandResult> {
    const envelope = await this.executeTyped<CardProjectTransferCommandResult>({
      type: "applyCardProjectTransfer",
      payload: request,
    });
    const result = envelope.result;
    if (!result.ok || result.value.duplicate) return result;

    const sourceDatabaseBlockIds = [
      ...new Set(
        request.expectedMemberships.map(
          (membership) => membership.databaseBlockId,
        ),
      ),
    ].sort((left, right) => left.localeCompare(right));
    this.publishDatabaseEvent(
      {
        version: DATABASE_CHANGE_EVENT_VERSION,
        projectId: request.sourceProjectId,
        storeEpoch: result.value.storeEpoch,
        operationId: result.value.operationId,
        sourceKind: "card_project_transfer",
        affectedDatabaseBlockIds: sourceDatabaseBlockIds,
        changeLogSeq: result.value.changeLogSeq,
      },
      envelope.metrics,
    );
    this.publishDatabaseEvent(
      {
        version: DATABASE_CHANGE_EVENT_VERSION,
        projectId: request.targetProjectId,
        storeEpoch: result.value.storeEpoch,
        operationId: result.value.operationId,
        sourceKind: "card_project_transfer",
        affectedDatabaseBlockIds: [request.target.databaseBlockId],
        changeLogSeq: result.value.changeLogSeq,
      },
      envelope.metrics,
    );
    return result;
  }

  async barrier(): Promise<void> {
    if (this.lifecycle === "stopped" || this.lifecycle === "suspended") {
      return;
    }
    if (this.lifecycle === "draining") {
      await (this.shutdownPromise ?? this.maintenanceSuspendPromise);
      return;
    }
    if (!this.worker) {
      return;
    }

    await this.executeTyped<void>({ type: "writerBarrier" });
  }

  /**
   * Drains accepted commands and closes the worker-owned SQLite connection.
   * Unlike shutdown(), this is reversible and intentionally leaves the writer
   * rejecting commands until resumeAfterMaintenance() is called.
   */
  suspendForMaintenance(): Promise<void> {
    if (this.maintenanceSuspendPromise) {
      return this.maintenanceSuspendPromise;
    }
    if (this.lifecycle === "suspended") {
      return Promise.resolve();
    }
    if (this.lifecycle === "stopped" || this.shutdownPromise) {
      return Promise.reject(new Error("Card mutation writer is stopped"));
    }

    this.lifecycle = "draining";
    const worker = this.worker;
    if (!worker) {
      this.lifecycle = "suspended";
      this.maintenanceSuspendPromise = Promise.resolve();
      return this.maintenanceSuspendPromise;
    }

    let cancelDeadline: (() => void) | null = null;
    let workerDetached = false;
    const detachWorker = async (): Promise<void> => {
      if (workerDetached) return;
      workerDetached = true;
      worker.removeAllListeners();
      if (this.worker === worker) this.worker = null;
      await Promise.resolve(worker.terminate());
    };
    const suspend = this.executeTyped<void>(
      { type: "shutdown" },
      { allowDuringDrain: true },
    )
      .then(async () => {
        // The shutdown ACK is emitted only after the worker destroys its Y.Doc
        // cache and closes its SQLite connection. Detach it before a future
        // command is allowed to create the replacement worker.
        await detachWorker();
        this.gracefulExitExpected = false;
        this.lifecycle = "suspended";
      })
      .catch(async (error: unknown) => {
        // A failed suspend must not strand the process in maintenance mode.
        // The failed worker is never reused; the next accepted command starts
        // a clean connection after the coordinator releases its outer gate.
        await detachWorker();
        this.gracefulExitExpected = false;
        this.maintenanceSuspendPromise = null;
        this.lifecycle = "accepting";
        throw error;
      })
      .finally(() => {
        cancelDeadline?.();
      });
    cancelDeadline = this.scheduleShutdownDeadline(() => {
      const timeoutMs = this.shutdownTimeoutMs();
      const error = new Error(
        `Card mutation writer did not suspend within ${timeoutMs}ms`,
      );
      logger.error("Card mutation writer maintenance suspend timed out", {
        pendingCount: this.pending.size,
        timeoutMs,
      });
      this.handleWorkerFailure(error);
      void detachWorker();
    });
    this.maintenanceSuspendPromise = suspend;
    return suspend;
  }

  resumeAfterMaintenance(): void {
    if (this.lifecycle === "stopped") return;
    if (this.lifecycle !== "suspended") {
      throw new Error("Card mutation writer is not suspended for maintenance");
    }
    this.maintenanceSuspendPromise = null;
    this.lifecycle = "accepting";
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    if (this.lifecycle === "stopped") {
      return Promise.resolve();
    }
    if (this.lifecycle === "suspended") {
      this.lifecycle = "stopped";
      this.shutdownPromise = Promise.resolve();
      return this.shutdownPromise;
    }
    if (this.maintenanceSuspendPromise) {
      this.shutdownPromise = this.maintenanceSuspendPromise
        .catch(() => undefined)
        .then(() => {
          this.lifecycle = "stopped";
        });
      return this.shutdownPromise;
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
    )
      .then(() => undefined)
      .finally(() => {
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
    if (
      configured !== undefined &&
      Number.isFinite(configured) &&
      configured > 0
    ) {
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
    if (this.lifecycle !== "accepting" && !options?.allowDuringDrain) {
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
    const response = await new Promise<CardMutationWorkerResponse>(
      (resolve, reject) => {
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
      },
    ).finally(() => {
      eventLoopDelay.disable();
    });

    if (!response.ok) {
      throw new Error(response.error);
    }

    response.metrics.mainEventLoopLagMaxMs = Math.round(
      eventLoopDelay.max / 1_000_000,
    );
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
    this.worker.on("message", (message: CardMutationWorkerMessage) =>
      this.handleWorkerMessage(message),
    );
    this.worker.on("error", (error) => {
      this.handleWorkerFailure(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    this.worker.on("exit", (code) => {
      this.worker = null;
      if (this.gracefulExitExpected) {
        this.gracefulExitExpected = false;
        return;
      }
      const message =
        code === 0
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

  private publishBoardEvents(
    events: readonly BoardChangeEvent[],
    metrics: CardMutationMetrics,
  ): void {
    for (const event of events) {
      try {
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
      } catch (error) {
        // The worker ACK represents an already committed SQLite transaction.
        // A best-effort read-model notification must never turn that durable
        // success into an apparent failure or suppress Y.Doc fanout.
        logger.warn("Failed to publish committed board event", {
          error: error instanceof Error ? error.message : String(error),
          mutationId: event.mutationId ?? metrics.mutationId,
          projectId: event.projectId,
          cardId: event.cardId,
        });
      }
    }
  }

  private publishDatabaseEvent(
    event: DatabaseChangeEvent,
    metrics: CardMutationMetrics,
  ): void {
    try {
      if (this.options.publishDatabaseEvent) {
        this.options.publishDatabaseEvent(event, metrics);
        return;
      }
      dbNotifier.notifyDatabaseChanged(event);
    } catch (error) {
      logger.warn("Failed to publish committed Database event", {
        error: error instanceof Error ? error.message : String(error),
        mutationId: metrics.mutationId,
        operationId: event.operationId,
        projectId: event.projectId,
      });
    }
  }
}

export const cardMutationWriter = new CardMutationWriter();
