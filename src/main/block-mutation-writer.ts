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
  OwnedDocumentDescriptor,
  RelocateBlocks,
  RelocationCommandResult,
  RelocationIntent,
  RelocationResult,
} from "../shared/block-documents";
import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneMutationRequest,
  CanvasSceneSyncRequest,
  CanvasSceneSyncCommandResult,
} from "../shared/block-documents/canvas-scene-sync";
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
  BlockTransferCommandResult,
  BlockTransferRequest,
} from "../shared/block-transfer";
import type {
  CompactEligibleBlockDocumentsInput,
  CompactEligibleBlockDocumentsResult,
} from "./local-store/block-document-compaction";
import type {
  MaintainStoreBlockRetentionInput,
  MaintainStoreBlockRetentionResult,
} from "./local-store/block-retention-maintenance-store";
import type { ProjectDeletionResult } from "./local-store/project-deletion";
import type { RepairDocumentSecondaryProjectionsResult } from "./local-store/block-document-projections";
import type {
  CardOccurrenceActionInput,
  CardOccurrenceCompleteInput,
  CardOccurrenceUpdateInput,
} from "../shared/types";
import type {
  BlockMutationMetrics,
  BlockMutationWorkerEvent,
  BlockMutationWorkerMessage,
  BlockMutationWorkerRequest,
  BlockMutationWorkerResponse,
  BlockMutationWorkerResult,
  CardOccurrenceMutationResult,
} from "./block-mutation-worker-protocol";

const LONG_MUTATION_WARN_MS = 1_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

const logger = getLogger({
  subsystem: "ipc",
  component: "block-mutation-writer",
});

type BlockMutationWorkerRequestInput =
  BlockMutationWorkerRequest extends infer Request
    ? Request extends { id: number }
      ? Omit<Request, "id" | "mutationId" | "queuedAtEpochMs">
      : never
    : never;

export interface BlockMutationEnvelope<T> {
  result: T;
  events: BoardChangeEvent[];
  metrics: BlockMutationMetrics;
}

export interface BlockMutationWorkerLike {
  postMessage(message: BlockMutationWorkerRequest): void;
  on(
    event: "message",
    listener: (message: BlockMutationWorkerMessage) => void,
  ): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
  removeAllListeners(): void;
  terminate(): unknown;
}

export type BlockMutationWriterShutdownDeadline = (
  callback: () => void,
  timeoutMs: number,
) => () => void;

export interface BlockMutationWriterOptions {
  createWorker?: () => BlockMutationWorkerLike;
  publishBoardEvent?: (
    event: BoardChangeEvent,
    metrics: BlockMutationMetrics,
  ) => void;
  publishDatabaseEvent?: (
    event: DatabaseChangeEvent,
    metrics: BlockMutationMetrics,
  ) => void;
  scheduleShutdownDeadline?: BlockMutationWriterShutdownDeadline;
  shutdownTimeoutMs?: number;
}

interface PendingRequest {
  request: BlockMutationWorkerRequest;
  resolve: (response: BlockMutationWorkerResponse) => void;
  reject: (error: Error) => void;
  warnTimer: ReturnType<typeof setTimeout>;
}

export class BlockMutationWriter {
  private worker: Worker | null = null;
  private lifecycle: "accepting" | "draining" | "suspended" | "stopped" =
    "accepting";
  private gracefulExitExpected = false;
  private shutdownPromise: Promise<void> | null = null;
  private maintenanceSuspendPromise: Promise<void> | null = null;
  private cancelShutdownDeadline: (() => void) | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(private readonly options: BlockMutationWriterOptions = {}) {}

  async completeCardOccurrence(
    projectId: string,
    input: CardOccurrenceCompleteInput,
    sessionId?: string,
  ): Promise<BlockMutationEnvelope<CardOccurrenceMutationResult>> {
    return await this.executeTyped<CardOccurrenceMutationResult>({
      type: "completeCardOccurrence",
      payload: { projectId, input, sessionId },
    });
  }

  async skipCardOccurrence(
    projectId: string,
    input: CardOccurrenceActionInput,
    sessionId?: string,
  ): Promise<BlockMutationEnvelope<CardOccurrenceMutationResult>> {
    return await this.executeTyped<CardOccurrenceMutationResult>({
      type: "skipCardOccurrence",
      payload: { projectId, input, sessionId },
    });
  }

  async updateCardOccurrence(
    projectId: string,
    input: CardOccurrenceUpdateInput,
    sessionId?: string,
  ): Promise<BlockMutationEnvelope<CardOccurrenceMutationResult>> {
    return await this.executeTyped<CardOccurrenceMutationResult>({
      type: "updateCardOccurrence",
      payload: { projectId, input, sessionId },
    });
  }

  async repairDocumentSecondaryProjections(): Promise<
    BlockMutationEnvelope<RepairDocumentSecondaryProjectionsResult>
  > {
    return await this.executeTyped<RepairDocumentSecondaryProjectionsResult>({
      type: "repairDocumentSecondaryProjections",
    });
  }

  async applyBlockPropertyMutation(
    request: BlockPropertyMutationRequest,
  ): Promise<BlockMutationEnvelope<BlockPropertyMutationCommandResult>> {
    return await this.executeTyped<BlockPropertyMutationCommandResult>({
      type: "applyBlockPropertyMutation",
      payload: request,
    });
  }

  async applyDatabaseMutation(
    request: DatabaseMutationRequest,
  ): Promise<BlockMutationEnvelope<DatabaseMutationCommandResult>> {
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

  async applyBlockTransfer(
    request: BlockTransferRequest,
  ): Promise<BlockMutationEnvelope<BlockTransferCommandResult>> {
    const envelope = await this.executeTyped<BlockTransferCommandResult>({
      type: "applyBlockTransfer",
      payload: request,
    });
    if (
      envelope.result.ok &&
      !envelope.result.value.duplicate &&
      envelope.result.value.affectedDatabaseBlockIds.length > 0
    ) {
      this.publishDatabaseEvent(
        {
          version: DATABASE_CHANGE_EVENT_VERSION,
          projectId: envelope.result.value.projectId,
          storeEpoch: envelope.result.value.storeEpoch,
          operationId: envelope.result.value.operationId,
          sourceKind: "block_transfer",
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
  ): Promise<BlockMutationEnvelope<CardLifecycleMutationCommandResult>> {
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
  ): Promise<BlockMutationEnvelope<CardLifecyclePreflightResult>> {
    return await this.executeTyped<CardLifecyclePreflightResult>({
      type: "readCardLifecyclePreflight",
      payload: { projectId, cardId },
    });
  }

  async compactEligibleBlockDocuments(
    input: CompactEligibleBlockDocumentsInput,
  ): Promise<BlockMutationEnvelope<CompactEligibleBlockDocumentsResult>> {
    return await this.executeTyped<CompactEligibleBlockDocumentsResult>({
      type: "compactEligibleBlockDocuments",
      payload: input,
    });
  }

  async maintainStoreBlockRetention(
    input: MaintainStoreBlockRetentionInput,
  ): Promise<BlockMutationEnvelope<MaintainStoreBlockRetentionResult>> {
    return await this.executeTyped<MaintainStoreBlockRetentionResult>({
      type: "maintainStoreBlockRetention",
      payload: input,
    });
  }

  async deleteProject(
    projectId: string,
  ): Promise<BlockMutationEnvelope<ProjectDeletionResult>> {
    return await this.executeTyped<ProjectDeletionResult>({
      type: "deleteProject",
      payload: { projectId },
    });
  }

  async readDatabaseDescriptor(
    projectId: string,
    databaseBlockId: string,
  ): Promise<
    BlockMutationEnvelope<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>
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
  ): Promise<BlockMutationEnvelope<DatabaseCatalogSnapshotCommandResult>> {
    return await this.executeTyped<DatabaseCatalogSnapshotCommandResult>({
      type: "readDatabaseCatalog",
      payload: { projectId },
    });
  }

  async readDatabaseManagement(
    projectId: string,
  ): Promise<BlockMutationEnvelope<DatabaseManagementSnapshotCommandResult>> {
    return await this.executeTyped<DatabaseManagementSnapshotCommandResult>({
      type: "readDatabaseManagement",
      payload: { projectId },
    });
  }

  async readPrimaryDatabaseDescriptor(
    projectId: string,
  ): Promise<
    BlockMutationEnvelope<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>
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
  ): Promise<BlockMutationEnvelope<PrimaryDatabaseViewSnapshotCommandResult>> {
    return await this.executeTyped<PrimaryDatabaseViewSnapshotCommandResult>({
      type: "readPrimaryDatabaseViewSnapshot",
      payload: { projectId },
    });
  }

  async readDatabaseViewSnapshot(
    projectId: string,
    viewId: string,
  ): Promise<BlockMutationEnvelope<DatabaseViewSnapshotCommandResult>> {
    return await this.executeTyped<DatabaseViewSnapshotCommandResult>({
      type: "readDatabaseViewSnapshot",
      payload: { projectId, viewId },
    });
  }

  async queryDatabaseView(
    projectId: string,
    viewId: string,
  ): Promise<
    BlockMutationEnvelope<DatabaseReadCommandResult<GeneralDatabaseViewQuery>>
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

  async syncCanvasScene(
    request: CanvasSceneSyncRequest,
  ): Promise<CanvasSceneSyncCommandResult> {
    const envelope = await this.executeTyped<CanvasSceneSyncCommandResult>({
      type: "syncCanvasScene",
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

  async getOwnedDocumentDescriptor(
    projectId: string,
    ownerBlockId: string,
  ): Promise<BlockMutationEnvelope<OwnedDocumentDescriptor>> {
    return await this.executeTyped<OwnedDocumentDescriptor>({
      type: "getOwnedDocumentDescriptor",
      payload: { projectId, ownerBlockId },
    });
  }

  async prepareOwnedBlockDocument(
    projectId: string,
    ownerBlockId: string,
  ): Promise<DocumentSyncCommandResult<OwnedDocumentDescriptor>> {
    const envelope = await this.executeTyped<
      DocumentSyncCommandResult<OwnedDocumentDescriptor>
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

  async applyCanvasSceneMutation(
    request: CanvasSceneMutationRequest,
  ): Promise<CanvasSceneMutationCommandResult> {
    const envelope = await this.executeTyped<CanvasSceneMutationCommandResult>({
      type: "applyCanvasSceneMutation",
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
      return Promise.reject(new Error("Block mutation writer is stopped"));
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
        `Block mutation writer did not suspend within ${timeoutMs}ms`,
      );
      logger.error("Block mutation writer maintenance suspend timed out", {
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
      throw new Error("Block mutation writer is not suspended for maintenance");
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
        `Block mutation writer did not drain within ${timeoutMs}ms`,
      );
      logger.error("Block mutation writer graceful shutdown timed out", {
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
    input: BlockMutationWorkerRequestInput,
    options?: { readonly allowDuringDrain?: boolean },
  ): Promise<BlockMutationEnvelope<T>> {
    const envelope = await this.execute(input, options);
    return {
      ...envelope,
      result: envelope.result as T,
    };
  }

  private async execute(
    input: BlockMutationWorkerRequestInput,
    options?: { readonly allowDuringDrain?: boolean },
  ): Promise<BlockMutationEnvelope<BlockMutationWorkerResult>> {
    if (this.lifecycle !== "accepting" && !options?.allowDuringDrain) {
      throw new Error("Block mutation writer is shutting down");
    }
    const worker = this.ensureWorker();
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const request = {
      ...input,
      id,
      mutationId: randomUUID(),
      queuedAtEpochMs: Date.now(),
    } as BlockMutationWorkerRequest;

    const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
    eventLoopDelay.enable();
    const response = await new Promise<BlockMutationWorkerResponse>(
      (resolve, reject) => {
        const warnTimer = setTimeout(() => {
          logger.warn("Block mutation still running", {
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
    this.worker.on("message", (message: BlockMutationWorkerMessage) =>
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
          ? "Block mutation worker exited unexpectedly"
          : `Block mutation worker exited with code ${code}`;
      this.handleWorkerFailure(new Error(message));
    });
    logger.info("Started Block mutation worker");
    return this.worker;
  }

  private handleWorkerMessage(message: BlockMutationWorkerMessage): void {
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

  private handleWorkerEvent(event: BlockMutationWorkerEvent): void {
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
    logger.warn("Block mutation worker failed", { error: error.message });
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

    const workerUrl = new URL("./block-mutation-worker.js", import.meta.url);
    return new Worker(workerUrl, {
      env: {
        ...process.env,
        NODEX_DIR: getLocalStoreDir(),
      },
    });
  }

  private publishBoardEvents(
    events: readonly BoardChangeEvent[],
    metrics: BlockMutationMetrics,
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
    metrics: BlockMutationMetrics,
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

export const blockMutationWriter = new BlockMutationWriter();
