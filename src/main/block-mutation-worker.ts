import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { closeDatabase, getDb } from "./local-store/database";
import {
  dbNotifier,
  type BoardChangeEvent as LocalBoardChangeEvent,
} from "./local-store/notifier";
import * as cardsStore from "./local-store/cards";
import * as cardOccurrences from "./local-store/card-occurrences";
import { getOwnedDocumentDescriptor } from "./local-store/block-document-cutover";
import { prepareEditableOwnedBlockDocument } from "./local-store/owned-block-document-preparation";
import {
  applyCanvasSceneMutation,
  syncCanvasScene,
  toCanvasSceneCommandError,
} from "./local-store/canvas-scene-store";
import { toDocumentSyncCommandError } from "./local-store/block-document-store";
import {
  BlockRelocationStoreError,
  prepareRelocationCommand,
  readCommittedRelocation,
  relocateBlocksAtomically,
} from "./local-store/block-relocations";
import {
  applyCardProjectTransfer,
  CardProjectTransferCompilationError,
  compileCardProjectTransferIntent,
  readCardProjectTransferOutcomeByIntent,
} from "./local-store/card-project-transfer";
import { repairDocumentSecondaryProjections } from "./local-store/block-document-projections";
import { applyBlockPropertyMutation } from "./local-store/block-property-mutations";
import {
  applyBlockTransfer,
  prepareBlockTransfer,
  readCommittedBlockTransfer,
} from "./local-store/block-transfers";
import {
  applyDatabaseMutation,
  queryDatabaseViewSnapshot,
  readDatabaseCatalogSnapshot,
  readDatabaseManagementSnapshot,
  readDatabaseViewSnapshot,
  readDatabaseDescriptorSnapshot,
  readPrimaryDatabaseDescriptorSnapshot,
  readPrimaryDatabaseViewSnapshot,
} from "./local-store/database-kernel";
import {
  applyCardLifecycleMutation,
  readCardLifecyclePreflightSnapshot,
} from "./local-store/card-block-lifecycle";
import { compactEligibleBlockDocuments } from "./local-store/block-document-compaction";
import { maintainStoreBlockRetention } from "./local-store/block-retention-maintenance-store";
import { deleteProjectBlockFirst } from "./local-store/project-deletion";
import { applyAdditionalDocumentCommand } from "./local-store/additional-document-command-kernel";
import {
  applyDocumentOperationBatch,
  replaceDocumentFromNfm,
  restoreDocumentVersion,
} from "./local-store/block-document-operations";
import {
  createDocumentVersionSummaryCheckpoint,
  DocumentVersionStoreError,
  getDocumentVersionDetail,
  listDocumentVersions,
} from "./local-store/document-versions";
import {
  CardHistoryStoreError,
  listCardHistory,
} from "./local-store/card-history";
import { readAuthoritativeCardSummaryById } from "./local-store/card-read-store";
import {
  BlockDocumentRuntime,
  createSqliteBlockDocumentRuntimeAuthority,
} from "./block-document-runtime";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type {
  DocumentSyncCommandResult,
  RelocationCommandError,
  RelocationCommandResult,
  RelocationResult,
} from "../shared/block-documents";
import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneSyncCommandResult,
} from "../shared/block-documents/canvas-scene-sync";
import {
  parseCardProjectTransferIntent,
  type CardProjectTransferCommandError,
  type CardProjectTransferCommandResult,
  type CardProjectTransferIntent,
  type CardProjectTransferPreparation,
} from "../shared/card-project-transfer";
import type {
  DocumentHistoryCommandError,
  DocumentHistoryCommandResult,
} from "../shared/block-documents/document-history-transport";
import type {
  CardHistoryCommandError,
  CardHistoryCommandResult,
} from "../shared/card-history-transport";
import type { Card, CardSummary } from "../shared/types";
import type {
  BlockMutationMetrics,
  BlockMutationWorkerMessage,
  BlockMutationWorkerRequest,
  BlockMutationWorkerResponse,
  BlockMutationWorkerResult,
} from "./block-mutation-worker-protocol";

const blockDocumentRuntime = new BlockDocumentRuntime(
  createSqliteBlockDocumentRuntimeAuthority(getDb),
);


function postMessage(message: BlockMutationWorkerMessage): void {
  parentPort?.postMessage(message);
}

function postResponse(response: BlockMutationWorkerResponse): void {
  postMessage(response);
}

function postLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
): void {
  postMessage({ type: "log", payload: { level, message, data } });
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

function runDocumentCommand<T>(
  operation: () => T,
): DocumentSyncCommandResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toDocumentSyncCommandError(error) };
  }
}

const runCanvasSceneSyncCommand = (
  operation: () => CanvasSceneSyncCommandResult,
): CanvasSceneSyncCommandResult => {
  try {
    return operation();
  } catch (error) {
    return { ok: false, error: toCanvasSceneCommandError(error) };
  }
};

const runCanvasSceneMutationCommand = (
  mutationId: string,
  operation: () => CanvasSceneMutationCommandResult,
): CanvasSceneMutationCommandResult => {
  try {
    return operation();
  } catch (error) {
    return {
      ok: false,
      error: toCanvasSceneCommandError(error, mutationId),
    };
  }
};

const toDocumentHistoryCommandError = (
  error: unknown,
): DocumentHistoryCommandError => {
  if (!(error instanceof DocumentVersionStoreError)) {
    return {
      code: "unknown",
      message: toErrorMessage(error),
      retryable: false,
    };
  }
  const code = (() => {
    switch (error.code) {
      case "invalid_document_version_request":
        return "invalid_document_history_request" as const;
      case "store_epoch_mismatch":
      case "document_not_found":
      case "document_not_ready":
      case "project_scope_mismatch":
      case "document_generation_conflict":
      case "document_head_conflict":
      case "document_version_not_found":
      case "document_version_schema_mismatch":
        return error.code;
      case "document_version_collision":
      case "document_version_corrupt":
        return "document_history_corrupt" as const;
    }
  })();
  return {
    code,
    message: error.message,
    retryable: error.code === "document_not_ready",
    ...(error.expectedGeneration === undefined
      ? {}
      : { expectedGeneration: error.expectedGeneration }),
    ...(error.actualGeneration === undefined
      ? {}
      : { actualGeneration: error.actualGeneration }),
    ...(error.expectedHeadSeq === undefined
      ? {}
      : { expectedHeadSeq: error.expectedHeadSeq }),
    ...(error.actualHeadSeq === undefined
      ? {}
      : { actualHeadSeq: error.actualHeadSeq }),
  };
};

const runDocumentHistoryCommand = <T>(
  operation: () => T,
): DocumentHistoryCommandResult<T> => {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toDocumentHistoryCommandError(error) };
  }
};

const toCardHistoryCommandError = (
  error: unknown,
): CardHistoryCommandError => {
  if (error instanceof CardHistoryStoreError) {
    return {
      code: error.code,
      message: error.message,
      retryable: false,
    };
  }
  return {
    code: "unknown",
    message: "Canonical Card history is unavailable",
    retryable: true,
  };
};

const runCardHistoryCommand = (
  operation: () => import("../shared/card-history").CardHistoryPage,
): CardHistoryCommandResult => {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toCardHistoryCommandError(error) };
  }
};

const relocationErrorRetryable = (
  error: RelocationCommandError["code"],
): boolean =>
  error === "relocation_lease_timeout" || error === "document_not_ready";

const relocationErrorRequiresReload = (
  error: RelocationCommandError["code"],
): boolean => {
  switch (error) {
    case "store_epoch_mismatch":
    case "source_document_not_found":
    case "target_document_not_found":
    case "document_generation_mismatch":
    case "source_head_mismatch":
    case "target_head_changed":
    case "block_not_found":
    case "block_location_mismatch":
    case "block_location_revision_mismatch":
    case "block_relocated":
    case "recovery_required":
    case "document_state_corrupt":
      return true;
    case "invalid_relocation_request":
    case "relocation_id_collision":
    case "relocation_lease_timeout":
    case "document_not_ready":
    case "invalid_relocation_roots":
    case "invalid_relocation_target":
    case "relocation_cycle":
    case "unknown":
      return false;
  }
};

const toRelocationCommandError = (error: unknown): RelocationCommandError => {
  const code =
    error instanceof BlockRelocationStoreError ? error.code : "unknown";
  return {
    code,
    message: toErrorMessage(error),
    retryable: relocationErrorRetryable(code),
    reloadRequired: relocationErrorRequiresReload(code),
    ...(error instanceof BlockRelocationStoreError && error.relocationId
      ? { relocationId: error.relocationId }
      : {}),
  };
};

const runRelocationCommand = <T>(
  operation: () => T,
): RelocationCommandResult<T> => {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toRelocationCommandError(error) };
  }
};

const transferCompilationFailure = (
  intent: CardProjectTransferIntent,
  error: unknown,
): CardProjectTransferCommandError => {
  const code =
    error instanceof CardProjectTransferCompilationError
      ? error.code
      : "unknown";
  return {
    code,
    message: toErrorMessage(error),
    retryable:
      code === "block_authority_conflict" ||
      code === "document_authority_conflict" ||
      code === "membership_authority_conflict" ||
      code === "target_database_conflict" ||
      code === "target_view_conflict" ||
      code === "position_anchor_not_found" ||
      code === "position_anchor_group_mismatch" ||
      code === "unknown",
    operationId: intent.operationId,
    cardId: intent.cardId,
  };
};

const prepareCardProjectTransfer = (
  rawIntent: CardProjectTransferIntent,
): CardProjectTransferCommandResult<CardProjectTransferPreparation> => {
  let intent: CardProjectTransferIntent;
  try {
    intent = parseCardProjectTransferIntent(rawIntent);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_card_project_transfer_request",
        message: toErrorMessage(error),
        retryable: false,
      },
    };
  }
  const stored = readCardProjectTransferOutcomeByIntent(getDb(), intent);
  if (stored) {
    if (!stored.ok) return stored;
    return {
      ok: true,
      value: {
        kind: "committed",
        intent,
        receipt: stored.value,
      },
    };
  }
  try {
    return {
      ok: true,
      value: {
        kind: "prepared",
        intent,
        request: compileCardProjectTransferIntent(getDb(), intent),
      },
    };
  } catch (error) {
    return { ok: false, error: transferCompilationFailure(intent, error) };
  }
};

const publishCardProjectTransferBoardEvents = (
  request: import("../shared/card-project-transfer").CardProjectTransferRequest,
): void => {
  const sourceStatus =
    request.expectedMemberships.find(
      (membership) => membership.cardBlockId === request.cardId,
    )?.status ?? request.target.status;
  dbNotifier.notifyChange(
    request.sourceProjectId,
    "delete",
    sourceStatus,
    request.cardId,
    { mutationId: request.operationId },
  );
  const summary = readAuthoritativeCardSummaryById(getDb(), request.cardId);
  if (!summary) {
    postLog("error", "Committed Card Project transfer has no target summary", {
      operationId: request.operationId,
      cardId: request.cardId,
      targetProjectId: request.targetProjectId,
    });
    return;
  }
  dbNotifier.notifyChange(
    request.targetProjectId,
    "create",
    summary.status,
    request.cardId,
    { summary, mutationId: request.operationId },
  );
};

const invalidateRelocatedDocumentCaches = (
  documentIds: readonly string[],
  relocationId: string,
): void => {
  try {
    for (const documentId of new Set(documentIds)) {
      blockDocumentRuntime.invalidate(documentId);
    }
  } catch (error) {
    blockDocumentRuntime.destroy();
    postLog("error", "Committed relocation cache invalidation failed", {
      relocationId,
      error: toErrorMessage(error),
    });
  }
};

const publishRelocationCardSummaries = (result: RelocationResult): void => {
  if (result.duplicate) return;
  const documentIds = [
    result.sourceCommit.documentId,
    ...(result.targetCommit ? [result.targetCommit.documentId] : []),
  ];
  for (const documentId of new Set(documentIds)) {
    try {
      const projection = cardsStore.readCardDocumentBoardProjection(
        getDb(),
        documentId,
      );
      if (!projection) {
        postLog("warn", "Committed relocation has no Card board projection", {
          relocationId: result.relocationId,
          documentId,
        });
        continue;
      }
      dbNotifier.notifyChange(
        projection.projectId,
        "update",
        projection.status,
        projection.cardId,
        { summary: projection.summary },
      );
    } catch (error) {
      postLog("error", "Committed relocation Card summary fanout failed", {
        relocationId: result.relocationId,
        documentId,
        error: toErrorMessage(error),
      });
    }
  }
};

function approximatePayloadBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function shouldReadSummary(event: BoardChangeEvent): boolean {
  if (!event.cardId) return false;
  if (event.changeType === "delete") return false;
  return true;
}

async function readEventSummary(
  event: BoardChangeEvent,
): Promise<CardSummary | undefined> {
  if (!shouldReadSummary(event)) return undefined;
  const cardId = event.cardId;
  if (!cardId) return undefined;
  const summary = cardsStore.readCardSummaryById(cardId);
  return summary ?? undefined;
}

function normalizeEvent(event: LocalBoardChangeEvent): BoardChangeEvent {
  return {
    projectId: event.projectId,
    changeType: event.changeType,
    columnId: event.columnId as Card["status"],
    status: event.status as Card["status"],
    cardId: event.cardId,
    summary: event.summary,
    mutationId: event.mutationId,
    metrics: event.metrics,
  };
}

async function enrichEvents(
  events: readonly LocalBoardChangeEvent[],
  metrics: BlockMutationMetrics,
): Promise<BoardChangeEvent[]> {
  const enriched: BoardChangeEvent[] = [];

  for (const event of events) {
    const normalized = normalizeEvent(event);
    const summary = normalized.summary ?? (await readEventSummary(normalized));
    enriched.push({
      ...normalized,
      summary,
      mutationId: metrics.mutationId,
      metrics: {
        workerDurationMs: metrics.workerDurationMs,
        queueWaitMs: metrics.queueWaitMs,
        transactionMs: metrics.transactionMs,
      },
    });
  }

  return enriched;
}

async function runRequest(
  request: BlockMutationWorkerRequest,
): Promise<BlockMutationWorkerResult> {
  switch (request.type) {
    case "completeCardOccurrence":
      return await cardOccurrences.completeCardOccurrence(
        request.payload.projectId,
        request.payload.input,
        request.payload.sessionId,
      );
    case "skipCardOccurrence":
      return await cardOccurrences.skipCardOccurrence(
        request.payload.projectId,
        request.payload.input,
        request.payload.sessionId,
      );
    case "updateCardOccurrence":
      return await cardOccurrences.updateCardOccurrence(
        request.payload.projectId,
        request.payload.input,
        request.payload.sessionId,
      );
    case "repairDocumentSecondaryProjections":
      return repairDocumentSecondaryProjections(getDb());
    case "applyBlockPropertyMutation": {
      const result = applyBlockPropertyMutation(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;

      // The store has already committed authority plus every disposable
      // projection before returning. Fanout is intentionally best-effort and
      // happens only for the first durable receipt; exact retries must not
      // create a second semantic board event.
      for (const cardId of Object.keys(result.value.blockMetadataRevisions)) {
        try {
          const summary = readAuthoritativeCardSummaryById(getDb(), cardId);
          if (!summary) {
            postLog("error", "Committed Card properties have no read model", {
              projectId: request.payload.projectId,
              cardId,
              mutationId: request.payload.mutationId,
            });
            continue;
          }
          dbNotifier.notifyChange(
            request.payload.projectId,
            "update",
            summary.status,
            cardId,
            { summary },
          );
        } catch (error) {
          postLog("error", "Committed Card property fanout failed", {
            projectId: request.payload.projectId,
            cardId,
            mutationId: request.payload.mutationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return result;
    }
    case "applyDatabaseMutation": {
      const result = applyDatabaseMutation(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;

      const cardIds = [
        ...new Set(
          request.payload.operations.flatMap((operation) => {
            if (
              operation.kind === "transfer_membership" ||
              operation.kind === "position_card" ||
              operation.kind === "set_value" ||
              operation.kind === "add_remove_value"
            ) {
              return [operation.cardBlockId];
            }
            return [];
          }),
        ),
      ].sort();
      for (const cardId of cardIds) {
        try {
          const summary = readAuthoritativeCardSummaryById(getDb(), cardId);
          if (!summary) {
            postLog("error", "Committed Database mutation has no Card read model", {
              projectId: request.payload.projectId,
              cardId,
              operationId: request.payload.operationId,
            });
            continue;
          }
          dbNotifier.notifyChange(
            request.payload.projectId,
            "update",
            summary.status,
            cardId,
            { summary, mutationId: request.payload.operationId },
          );
        } catch (error) {
          postLog("error", "Committed Database mutation fanout failed", {
            projectId: request.payload.projectId,
            cardId,
            operationId: request.payload.operationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return result;
    }
    case "applyBlockTransfer": {
      const result = applyBlockTransfer(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;
      for (const commit of result.value.documentCommits) {
        blockDocumentRuntime.invalidate(commit.documentId);
      }
      return result;
    }
    case "prepareBlockTransfer":
      return prepareBlockTransfer(getDb(), request.payload);
    case "readCommittedBlockTransfer":
      return readCommittedBlockTransfer(getDb(), request.payload);
    case "applyCardLifecycleMutation": {
      let previousSummary: CardSummary | null = null;
      if (request.payload.operation.kind === "delete_card") {
        try {
          previousSummary = readAuthoritativeCardSummaryById(
            getDb(),
            request.payload.operation.cardId,
          );
        } catch (error) {
          postLog("warn", "Card lifecycle pre-commit summary read failed", {
            projectId: request.payload.projectId,
            cardId: request.payload.operation.cardId,
            operationId: request.payload.operationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const result = applyCardLifecycleMutation(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;

      try {
        if (result.value.operationKind === "delete_card") {
          if (previousSummary) {
            dbNotifier.notifyChange(
              request.payload.projectId,
              "delete",
              previousSummary.status,
              result.value.cardId,
              { mutationId: request.payload.operationId },
            );
          }
          return result;
        }

        const summary = readAuthoritativeCardSummaryById(
          getDb(),
          result.value.cardId,
        );
        if (!summary) return result;
        dbNotifier.notifyChange(
          request.payload.projectId,
          result.value.operationKind === "create_card" ? "create" : "update",
          summary.status,
          result.value.cardId,
          { summary, mutationId: request.payload.operationId },
        );
      } catch (error) {
        postLog("error", "Committed Card lifecycle fanout failed", {
          projectId: request.payload.projectId,
          cardId: result.value.cardId,
          operationId: request.payload.operationId,
          operationKind: result.value.operationKind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return result;
    }
    case "readCardLifecyclePreflight":
      return readCardLifecyclePreflightSnapshot(
        getDb(),
        request.payload.projectId,
        request.payload.cardId,
      );
    case "compactEligibleBlockDocuments":
      return compactEligibleBlockDocuments(getDb(), request.payload);
    case "maintainStoreBlockRetention":
      return maintainStoreBlockRetention(getDb(), request.payload);
    case "deleteProject":
      return deleteProjectBlockFirst(getDb(), request.payload.projectId);
    case "readDatabaseCatalog":
      return readDatabaseCatalogSnapshot(
        getDb(),
        request.payload.projectId,
      );
    case "readDatabaseManagement":
      return readDatabaseManagementSnapshot(
        getDb(),
        request.payload.projectId,
      );
    case "readDatabaseDescriptor":
      return readDatabaseDescriptorSnapshot(
        getDb(),
        request.payload.projectId,
        request.payload.databaseBlockId,
      );
    case "readPrimaryDatabaseDescriptor":
      return readPrimaryDatabaseDescriptorSnapshot(
        getDb(),
        request.payload.projectId,
      );
    case "readPrimaryDatabaseViewSnapshot":
      return readPrimaryDatabaseViewSnapshot(
        getDb(),
        request.payload.projectId,
      );
    case "readDatabaseViewSnapshot":
      return readDatabaseViewSnapshot(
        getDb(),
        request.payload.projectId,
        request.payload.viewId,
      );
    case "queryDatabaseView":
      return queryDatabaseViewSnapshot(
        getDb(),
        request.payload.projectId,
        request.payload.viewId,
      );
    case "syncBlockDocument":
      return runDocumentCommand(() =>
        blockDocumentRuntime.sync(request.payload),
      );
    case "syncCanvasScene":
      return runCanvasSceneSyncCommand(() =>
        syncCanvasScene(getDb(), request.payload),
      );
    case "getBlockDocumentProjectId":
      return runDocumentCommand(() =>
        blockDocumentRuntime.getProjectId(request.payload.documentId),
      );
    case "getOwnedDocumentDescriptor":
      return getOwnedDocumentDescriptor(
        getDb(),
        request.payload.projectId,
        request.payload.ownerBlockId,
      );
    case "prepareOwnedBlockDocument": {
      return runDocumentCommand(() => {
        const descriptor = getOwnedDocumentDescriptor(
          getDb(),
          request.payload.projectId,
          request.payload.ownerBlockId,
        );
        if (descriptor.sync.kind === "canvas_scene") return descriptor;
        const prepared = prepareEditableOwnedBlockDocument(
          getDb(),
          request.payload.projectId,
          request.payload.ownerBlockId,
        );
        if (prepared.repairedEmptyRoot) {
          blockDocumentRuntime.invalidate(prepared.descriptor.documentId);
        }
        return getOwnedDocumentDescriptor(
          getDb(),
          request.payload.projectId,
          request.payload.ownerBlockId,
        );
      });
    }
    case "applyBlockDocumentUpdate": {
      const result = runDocumentCommand(() =>
        blockDocumentRuntime.applyUpdate(request.payload),
      );
      if (!result.ok || result.value.duplicate) return result;

      // applyUpdate only returns after its SQLite transaction commits. Publish
      // the Card summary from that same committed materialization so every
      // window/browser updates without making legacy Card content authoritative
      // again. A post-commit projection read must never turn a durable ACK into
      // a retryable failure: a retry is a duplicate and intentionally emits no
      // second semantic event.
      try {
        const projection = cardsStore.readCardDocumentBoardProjection(
          getDb(),
          request.payload.documentId,
        );
        if (!projection) {
          postLog("error", "Committed Card Document has no board projection", {
            documentId: request.payload.documentId,
            updateId: request.payload.updateId,
            committedSeq: result.value.committedSeq,
          });
          return result;
        }

        dbNotifier.notifyChange(
          projection.projectId,
          "update",
          projection.status,
          projection.cardId,
          { summary: projection.summary },
        );
      } catch (error) {
        postLog("error", "Committed Card Document summary fanout failed", {
          documentId: request.payload.documentId,
          updateId: request.payload.updateId,
          committedSeq: result.value.committedSeq,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return result;
    }
    case "applyCanvasSceneMutation":
      return runCanvasSceneMutationCommand(request.payload.mutationId, () =>
        applyCanvasSceneMutation(getDb(), request.payload),
      );
    case "applyDocumentMutation": {
      const mutation = request.payload.request;
      const options = request.payload.writeFence
        ? { writeFence: request.payload.writeFence }
        : {};
      const result = "operations" in mutation
        ? applyDocumentOperationBatch(getDb(), mutation, options)
        : "nfm" in mutation
          ? replaceDocumentFromNfm(getDb(), mutation, options)
          : restoreDocumentVersion(getDb(), mutation, options);
      if (!result.ok) return result;
      if (result.value.duplicate) return result;

      blockDocumentRuntime.invalidate(mutation.documentId);

      try {
        const projection = cardsStore.readCardDocumentBoardProjection(
          getDb(),
          mutation.documentId,
        );
        if (!projection) {
          postLog("error", "Committed Document mutation has no board projection", {
            documentId: mutation.documentId,
            mutationId: mutation.mutationId,
            headSeq: result.value.headSeq,
          });
          return result;
        }
        dbNotifier.notifyChange(
          projection.projectId,
          "update",
          projection.status,
          projection.cardId,
          { summary: projection.summary },
        );
      } catch (error) {
        postLog("error", "Committed Document mutation summary fanout failed", {
          documentId: mutation.documentId,
          mutationId: mutation.mutationId,
          headSeq: result.value.headSeq,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return result;
    }
    case "applyAdditionalDocumentCommand": {
      const result = applyAdditionalDocumentCommand(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;

      for (const head of result.value.effect.documentHeads) {
        blockDocumentRuntime.invalidate(head.documentId);
        try {
          const projection = cardsStore.readCardDocumentBoardProjection(
            getDb(),
            head.documentId,
          );
          if (!projection) continue;
          dbNotifier.notifyChange(
            projection.projectId,
            "update",
            projection.status,
            projection.cardId,
            {
              summary: projection.summary,
              mutationId: request.payload.operationId,
            },
          );
        } catch (error) {
          postLog("error", "Committed additional Document fanout failed", {
            projectId: request.payload.projectId,
            documentId: head.documentId,
            operationId: request.payload.operationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return result;
    }
    case "createDocumentVersionCheckpoint":
      return runDocumentHistoryCommand(() =>
        createDocumentVersionSummaryCheckpoint(getDb(), request.payload),
      );
    case "listDocumentVersions":
      return runDocumentHistoryCommand(() =>
        listDocumentVersions(getDb(), request.payload),
      );
    case "getDocumentVersion":
      return runDocumentHistoryCommand(() =>
        getDocumentVersionDetail(getDb(), request.payload),
      );
    case "listCardHistory":
      return runCardHistoryCommand(() =>
        listCardHistory(getDb(), request.payload),
      );
    case "relocateBlocks": {
      const result = runRelocationCommand(() =>
        relocateBlocksAtomically(getDb(), request.payload),
      );
      if (!result.ok) return result;

      const documentIds = [
        result.value.sourceCommit.documentId,
        ...(result.value.targetCommit
          ? [result.value.targetCommit.documentId]
          : []),
      ];
      invalidateRelocatedDocumentCaches(documentIds, result.value.relocationId);
      publishRelocationCardSummaries(result.value);
      return result;
    }
    case "prepareRelocationCommand":
      return runRelocationCommand(() =>
        prepareRelocationCommand(getDb(), request.payload),
      );
    case "readCommittedRelocation": {
      const result = runRelocationCommand(() =>
        readCommittedRelocation(getDb(), request.payload),
      );
      if (!result.ok || result.value === null) return result;
      invalidateRelocatedDocumentCaches(
        [
          result.value.sourceCommit.documentId,
          ...(result.value.targetCommit
            ? [result.value.targetCommit.documentId]
            : []),
        ],
        result.value.relocationId,
      );
      return result;
    }
    case "prepareCardProjectTransfer":
      return prepareCardProjectTransfer(request.payload);
    case "applyCardProjectTransfer": {
      const result = applyCardProjectTransfer(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;
      for (const documentId of result.value.movedDocumentIds) {
        blockDocumentRuntime.invalidate(documentId);
      }
      publishCardProjectTransferBoardEvents(request.payload);
      return result;
    }
    case "writerBarrier":
      return undefined;
    case "shutdown":
      blockDocumentRuntime.destroy();
      closeDatabase();
      return undefined;
  }
}

async function handleRequest(
  request: BlockMutationWorkerRequest,
): Promise<void> {
  const workerStartedAtEpochMs = Date.now();
  const workerStartedAt = performance.now();
  const transactionStartedAt = performance.now();
  const capturedEvents: LocalBoardChangeEvent[] = [];
  const onBoardChanged = (event: LocalBoardChangeEvent) => {
    capturedEvents.push(event);
  };

  dbNotifier.on("board-changed", onBoardChanged);
  try {
    const result = await runRequest(request);
    dbNotifier.removeListener("board-changed", onBoardChanged);

    const metrics: BlockMutationMetrics = {
      mutationId: request.mutationId,
      queueWaitMs: Math.max(
        0,
        workerStartedAtEpochMs - request.queuedAtEpochMs,
      ),
      workerDurationMs: Math.round(performance.now() - workerStartedAt),
      transactionMs: Math.round(performance.now() - transactionStartedAt),
      summaryBytes:
        result && typeof result === "object" && "summary" in result
          ? approximatePayloadBytes(result.summary)
          : undefined,
      eventCount: 0,
    };
    const events = await enrichEvents(capturedEvents, metrics);
    metrics.eventCount = events.length;

    postResponse({
      id: request.id,
      ok: true,
      result,
      events,
      metrics,
    });

    if (request.type === "shutdown") {
      postLog("info", "Block mutation worker shut down");
    }
  } catch (error) {
    dbNotifier.removeListener("board-changed", onBoardChanged);
    postResponse({
      id: request.id,
      ok: false,
      error: toErrorMessage(error),
      metrics: {
        mutationId: request.mutationId,
        queueWaitMs: Math.max(
          0,
          workerStartedAtEpochMs - request.queuedAtEpochMs,
        ),
        workerDurationMs: Math.round(performance.now() - workerStartedAt),
        transactionMs: Math.round(performance.now() - transactionStartedAt),
        eventCount: capturedEvents.length,
      },
    });
  } finally {
    if (request.type === "shutdown") {
      parentPort?.close();
    }
  }
}

let requestQueue = Promise.resolve();

parentPort?.on("message", (message: BlockMutationWorkerRequest) => {
  requestQueue = requestQueue.then(
    () => handleRequest(message),
    () => handleRequest(message),
  );
});
