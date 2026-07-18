import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { closeDatabase, getDb } from "./local-store/database";
import {
  dbNotifier,
  type BoardChangeEvent as LocalBoardChangeEvent,
} from "./local-store/notifier";
import * as pagesStore from "./local-store/database-pages";
import {
  readPageTargetChangedEvent,
  readPageTargetContentChangedEvent,
} from "./local-store/page-targets";
import * as pageOccurrences from "./local-store/page-occurrences";
import {
  getLibraryOwnedDocumentAccess,
  getLibraryOwnedDocumentDescriptor,
  getOwnedDocumentDescriptor,
} from "./local-store/block-document-cutover";
import { prepareEditableOwnedBlockDocument } from "./local-store/owned-block-document-preparation";
import {
  authorizeDocumentAccessInDatabase,
  authorizeLibraryDocumentAccessInDatabase,
} from "./local-store/document-access";
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
import { repairDocumentSecondaryProjections } from "./local-store/block-document-projections";
import {
  applyLibrarySourceBlockPropertyMutationV2,
  applySourceBlockPropertyMutationV2,
} from "./local-store/block-property-mutations-v2-store";
import { rebuildBlockPropertyMutationProjections } from "./local-store/block-property-mutation-projections";
import {
  applyBlockTransfer,
  prepareBlockTransfer,
  readCommittedBlockTransfer,
} from "./local-store/block-transfers";
import {
  applyDatabaseModuleV2,
  readDatabaseModuleV2,
  readLibraryDatabaseModuleV2,
  applyLibraryDatabaseModuleV2,
} from "./local-store/database-module-v2-runtime";
import {
  applyLibraryModuleInDatabase,
  readLibraryModuleInDatabase,
} from "./local-store/library-module-runtime";
import {
  readLibraryPageDetailInDatabase,
  readPageDetailInDatabase,
} from "./local-store/page-detail";
import {
  applyPageLifecycleMutationV2,
  readPageLifecyclePreflightSnapshotV2,
} from "./local-store/page-lifecycle-v2-store";
import { compactEligibleBlockDocuments } from "./local-store/block-document-compaction";
import { maintainStoreBlockRetention } from "./local-store/block-retention-maintenance-store";
import { deleteProjectBlockFirst } from "./local-store/project-deletion";
import {
  assertNodexAgentResourceAuthorizationInDatabase,
  persistNodexAgentProjectResourceGrantsInDatabase,
} from "./local-store/project-resource-grants";
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
  checkpointActiveDocumentRevisionIfDue,
  maintainDocumentRevisionHistory,
  prepareDocumentRevisionForUpdate,
} from "./local-store/document-revision-maintenance-store";
import {
  PageHistoryStoreError,
  listPageHistory,
} from "./local-store/page-history";
import { readDatabasePageSummaryById } from "./local-store/page-read-store";
import {
  BlockDocumentRuntime,
  createSqliteBlockDocumentRuntimeAuthority,
} from "./block-document-runtime";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type { PageTargetChangedEvent } from "../shared/page-target-events";
import type {
  DocumentSyncCommandResult,
  RelocationCommandError,
  RelocationCommandResult,
  RelocationResult,
} from "../shared/block-documents";
import { toLibraryOwnedDocumentDescriptor } from "../shared/block-documents";
import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneSyncCommandResult,
} from "../shared/block-documents/canvas-scene-sync";
import type {
  DocumentHistoryCommandError,
  DocumentHistoryCommandResult,
} from "../shared/block-documents/document-history-transport";
import type {
  PageHistoryCommandError,
  PageHistoryCommandResult,
} from "../shared/page-history-transport";
import {
  toLibraryBlockPropertyMutationCommandResultV2,
  type BlockPropertyMutationCommandResultV2,
} from "../shared/block-property-mutations-v2";
import type { DatabasePage, DatabasePageSummary } from "../shared/types";
import type {
  BlockMutationMetrics,
  BlockMutationWorkerMessage,
  BlockMutationWorkerRequest,
  BlockMutationWorkerResponse,
  BlockMutationWorkerResult,
} from "./block-mutation-worker-protocol";
import { readNodexAgentV3Tool } from "./agent-tools/read-v3";
import {
  completeNodexAgentPageUpdate,
  prepareNodexAgentPageUpdate,
} from "./agent-tools/page-update-v3";
import {
  executeNodexAgentCreatePages,
  prepareNodexAgentCreatePages,
} from "./agent-tools/create-service";
import {
  executeNodexAgentDuplicatePage,
  executeNodexAgentMovePages,
  prepareNodexAgentDuplicatePage,
  prepareNodexAgentMovePages,
} from "./agent-tools/transfer-service";

const blockDocumentRuntime = new BlockDocumentRuntime(
  createSqliteBlockDocumentRuntimeAuthority(getDb, {
    beforeEffectiveUpdate: (database, input, committedAt) => {
      prepareDocumentRevisionForUpdate(database, input, committedAt);
    },
  }),
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

const toPageHistoryCommandError = (
  error: unknown,
): PageHistoryCommandError => {
  if (error instanceof PageHistoryStoreError) {
    return {
      code: error.code,
      message: error.message,
      retryable: false,
    };
  }
  return {
    code: "unknown",
    message: "Canonical Page history is unavailable",
    retryable: true,
  };
};

const runPageHistoryCommand = (
  operation: () => import("../shared/page-history").PageHistoryPage,
): PageHistoryCommandResult => {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toPageHistoryCommandError(error) };
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

const publishPageTargetContentChange = (documentId: string): void => {
  const event = readPageTargetContentChangedEvent(getDb(), documentId);
  if (event) dbNotifier.notifyPageTargetChanged(event);
};

const publishPageTargetChange = (
  targetBlockId: string,
  changeKind: "lifecycle" | "location" | "metadata",
): void => {
  const event = readPageTargetChangedEvent(getDb(), targetBlockId, changeKind);
  if (event) dbNotifier.notifyPageTargetChanged(event);
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

const publishRelocationPageSummaries = (result: RelocationResult): void => {
  if (result.duplicate) return;
  const documentIds = [
    result.sourceCommit.documentId,
    ...(result.targetCommit ? [result.targetCommit.documentId] : []),
  ];
  for (const documentId of new Set(documentIds)) {
    try {
      publishPageTargetContentChange(documentId);
      const projection = pagesStore.readPageDocumentBoardProjection(
        getDb(),
        documentId,
      );
      if (!projection) {
        continue;
      }
      dbNotifier.notifyChange(
        projection.projectId,
        "update",
        projection.status,
        projection.pageId,
        { summary: projection.summary },
      );
    } catch (error) {
      postLog("error", "Committed relocation Page summary fanout failed", {
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
  if (!event.pageId) return false;
  if (event.changeType === "delete") return false;
  return true;
}

async function readEventSummary(
  event: BoardChangeEvent,
): Promise<DatabasePageSummary | undefined> {
  if (!shouldReadSummary(event)) return undefined;
  const pageId = event.pageId;
  if (!pageId) return undefined;
  const summary = pagesStore.readDatabasePageSummaryById(pageId);
  return summary ?? undefined;
}

function normalizeEvent(event: LocalBoardChangeEvent): BoardChangeEvent {
  return {
    projectId: event.projectId,
    changeType: event.changeType,
    columnId: event.columnId as DatabasePage["status"],
    status: event.status as DatabasePage["status"],
    pageId: event.pageId,
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

const publishCommittedBlockPropertyMutation = (
  result: BlockPropertyMutationCommandResultV2,
): void => {
  if (!result.ok || result.value.duplicate) return;
  const { projectId, mutationId } = result.value;

  // Authority and disposable projections are already committed. Fanout is
  // best-effort and emitted only for the first durable receipt.
  for (const pageId of Object.keys(result.value.blockMetadataRevisions)) {
    try {
      publishPageTargetChange(pageId, "metadata");
      const summary = readDatabasePageSummaryById(getDb(), pageId);
      if (!summary) {
        postLog("error", "Committed Page properties have no read model", {
          projectId,
          pageId,
          mutationId,
        });
        continue;
      }
      dbNotifier.notifyChange(projectId, "update", summary.status, pageId, {
        summary,
      });
    } catch (error) {
      postLog("error", "Committed Page property fanout failed", {
        projectId,
        pageId,
        mutationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

async function runRequest(
  request: BlockMutationWorkerRequest,
): Promise<BlockMutationWorkerResult> {
  switch (request.type) {
    case "readNodexAgentV3Tool":
      return readNodexAgentV3Tool(getDb(), request.payload);
    case "persistNodexAgentProjectResourceGrants":
      return persistNodexAgentProjectResourceGrantsInDatabase(
        getDb(),
        request.payload,
      );
    case "prepareNodexAgentPageUpdate":
      return prepareNodexAgentPageUpdate(getDb(), request.payload);
    case "completeNodexAgentPageUpdate":
      return completeNodexAgentPageUpdate(getDb(), request.payload);
    case "prepareNodexAgentCreatePages":
      return prepareNodexAgentCreatePages(getDb(), request.payload);
    case "executeNodexAgentCreatePages": {
      const result = executeNodexAgentCreatePages(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;
      for (const page of result.value.output.data.pages) {
        try {
          publishPageTargetContentChange(`document:${page.pageId}`);
          const summary = readDatabasePageSummaryById(getDb(), page.pageId);
          if (summary) {
            dbNotifier.notifyChange(
              request.payload.projectId,
              "create",
              summary.status,
              page.pageId,
              { summary },
            );
          }
        } catch (error) {
          postLog("error", "Committed Nodex Agent Page batch fanout failed", {
            projectId: request.payload.projectId,
            pageId: page.pageId,
            mutationId: request.payload.mutationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return result;
    }
    case "prepareNodexAgentDuplicatePage":
      return prepareNodexAgentDuplicatePage(getDb(), request.payload);
    case "executeNodexAgentDuplicatePage": {
      const result = executeNodexAgentDuplicatePage(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;
      try {
        const pageId = result.value.output.data.pageId;
        publishPageTargetContentChange(`document:${pageId}`);
        const summary = readDatabasePageSummaryById(getDb(), pageId);
        if (summary) {
          dbNotifier.notifyChange(
            request.payload.projectId,
            "create",
            summary.status,
            pageId,
            { summary },
          );
        }
      } catch (error) {
        postLog("error", "Committed Nodex Agent Page duplicate fanout failed", {
          projectId: request.payload.projectId,
          sourcePageId: request.payload.input.pageId,
          mutationId: request.payload.mutationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return result;
    }
    case "prepareNodexAgentMovePages":
      return prepareNodexAgentMovePages(getDb(), request.payload);
    case "executeNodexAgentMovePages": {
      const result = executeNodexAgentMovePages(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;
      try {
        for (const commit of result.value.documentCommits) {
          blockDocumentRuntime.invalidate(commit.documentId);
          publishPageTargetContentChange(commit.documentId);
        }
        for (const page of result.value.output.data.pages) {
          publishPageTargetChange(page.pageId, "location");
          const summary = readDatabasePageSummaryById(getDb(), page.pageId);
          if (!summary) continue;
          dbNotifier.notifyChange(
            request.payload.projectId,
            "update",
            summary.status,
            page.pageId,
            { summary, mutationId: request.payload.mutationId },
          );
        }
      } catch (error) {
        postLog("error", "Committed Nodex Agent Page move fanout failed", {
          projectId: request.payload.projectId,
          mutationId: request.payload.mutationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return result;
    }
    case "completePageOccurrence":
      return await pageOccurrences.completePageOccurrence(
        request.payload.projectId,
        request.payload.input,
        request.payload.sessionId,
      );
    case "skipPageOccurrence":
      return await pageOccurrences.skipPageOccurrence(
        request.payload.projectId,
        request.payload.input,
        request.payload.sessionId,
      );
    case "updatePageOccurrence":
      return await pageOccurrences.updatePageOccurrence(
        request.payload.projectId,
        request.payload.input,
        request.payload.sessionId,
      );
    case "repairDocumentSecondaryProjections":
      return repairDocumentSecondaryProjections(getDb());
    case "applyBlockPropertyMutation": {
      const result = applySourceBlockPropertyMutationV2(
        getDb(),
        request.payload,
        {
          refreshProjections: (database, input) => {
            rebuildBlockPropertyMutationProjections(
              database,
              input.projectId,
              input.pageIds,
              input.updatedAt,
            );
          },
        },
      );
      publishCommittedBlockPropertyMutation(result);
      return result;
    }
    case "applyLibraryBlockPropertyMutation": {
      const result = applyLibrarySourceBlockPropertyMutationV2(
        getDb(),
        request.payload.request,
        request.payload.actor,
        request.payload.accessActor,
        {
          refreshProjections: (database, input) => {
            rebuildBlockPropertyMutationProjections(
              database,
              input.projectId,
              input.pageIds,
              input.updatedAt,
            );
          },
        },
      );
      publishCommittedBlockPropertyMutation(result);
      return toLibraryBlockPropertyMutationCommandResultV2(result);
    }
    case "applyDatabaseModule": {
      const result = applyDatabaseModuleV2(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;

      for (const pageId of result.value.affectedPageIds) {
        try {
          publishPageTargetChange(pageId, "metadata");
          const summary = readDatabasePageSummaryById(getDb(), pageId);
          if (!summary) continue;
          dbNotifier.notifyChange(
            request.payload.projectId,
            "update",
            summary.status,
            pageId,
            { summary, mutationId: request.payload.operationId },
          );
        } catch (error) {
          postLog("error", "Committed Database Module Page fanout failed", {
            projectId: request.payload.projectId,
            pageId,
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
        publishPageTargetContentChange(commit.documentId);
      }
      for (const blockId of result.value.resultRootBlockIds) {
        publishPageTargetChange(blockId, "location");
      }
      return result;
    }
    case "prepareBlockTransfer":
      return prepareBlockTransfer(getDb(), request.payload);
    case "readCommittedBlockTransfer":
      return readCommittedBlockTransfer(getDb(), request.payload);
    case "applyPageLifecycleMutation": {
      let previousSummary: DatabasePageSummary | null = null;
      if (request.payload.operation.kind === "delete_page") {
        try {
          previousSummary = readDatabasePageSummaryById(
            getDb(),
            request.payload.operation.pageId,
          );
        } catch (error) {
          postLog("warn", "Page lifecycle pre-commit summary read failed", {
            projectId: request.payload.projectId,
            pageId: request.payload.operation.pageId,
            operationId: request.payload.operationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const result = applyPageLifecycleMutationV2(getDb(), request.payload);
      if (!result.ok || result.value.duplicate) return result;

      try {
        publishPageTargetChange(result.value.pageId, "lifecycle");
        if (result.value.operationKind === "delete_page") {
          if (previousSummary) {
            dbNotifier.notifyChange(
              request.payload.projectId,
              "delete",
              previousSummary.status,
              result.value.pageId,
              { mutationId: request.payload.operationId },
            );
          }
          return result;
        }

        const summary = readDatabasePageSummaryById(
          getDb(),
          result.value.pageId,
        );
        if (!summary) return result;
        dbNotifier.notifyChange(
          request.payload.projectId,
          result.value.operationKind === "create_page" ? "create" : "update",
          summary.status,
          result.value.pageId,
          { summary, mutationId: request.payload.operationId },
        );
      } catch (error) {
        postLog("error", "Committed Page lifecycle fanout failed", {
          projectId: request.payload.projectId,
          pageId: result.value.pageId,
          operationId: request.payload.operationId,
          operationKind: result.value.operationKind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return result;
    }
    case "readPageLifecyclePreflight":
      return readPageLifecyclePreflightSnapshotV2(
        getDb(),
        request.payload.projectId,
        request.payload.pageId,
      );
    case "compactEligibleBlockDocuments":
      return compactEligibleBlockDocuments(getDb(), request.payload);
    case "maintainStoreBlockRetention":
      return maintainStoreBlockRetention(getDb(), request.payload);
    case "maintainDocumentRevisionHistory":
      return maintainDocumentRevisionHistory(getDb(), request.payload);
    case "deleteProject":
      return deleteProjectBlockFirst(getDb(), request.payload.projectId);
    case "readDatabaseModule":
      return readDatabaseModuleV2(getDb(), request.payload);
    case "readLibraryDatabaseModule":
      return readLibraryDatabaseModuleV2(
        getDb(),
        request.payload.request,
        request.payload.actor,
      );
    case "applyLibraryDatabaseModule":
      return applyLibraryDatabaseModuleV2(
        getDb(),
        request.payload.request,
        request.payload.actor,
        request.payload.accessActor,
      );
    case "readLibraryModule":
      return readLibraryModuleInDatabase(getDb(), request.payload);
    case "applyLibraryModule":
      return applyLibraryModuleInDatabase(getDb(), request.payload);
    case "readPageDetail":
      return readPageDetailInDatabase(
        getDb(),
        request.payload.projectId,
        request.payload.pageId,
      );
    case "readLibraryPageDetail":
      return readLibraryPageDetailInDatabase(
        getDb(),
        request.payload.pageId,
        request.payload.actor,
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
    case "authorizeDocumentAccess":
      return authorizeDocumentAccessInDatabase(getDb(), request.payload);
    case "authorizeLibraryDocumentAccess":
      return authorizeLibraryDocumentAccessInDatabase(getDb(), request.payload);
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
    case "prepareLibraryOwnedBlockDocument": {
      return runDocumentCommand(() => {
        const access = getLibraryOwnedDocumentAccess(
          getDb(),
          request.payload.ownerBlockId,
          "write",
        );
        if (access.descriptor.sync.kind === "canvas_scene") {
          return toLibraryOwnedDocumentDescriptor(access.descriptor);
        }
        const prepared = prepareEditableOwnedBlockDocument(
          getDb(),
          access.storageProjectId,
          request.payload.ownerBlockId,
        );
        if (prepared.repairedEmptyRoot) {
          blockDocumentRuntime.invalidate(prepared.descriptor.documentId);
        }
        return toLibraryOwnedDocumentDescriptor(
          getLibraryOwnedDocumentDescriptor(
            getDb(),
            request.payload.ownerBlockId,
          ),
        );
      });
    }
    case "applyBlockDocumentUpdate": {
      const result = runDocumentCommand(() =>
        blockDocumentRuntime.applyUpdate(request.payload),
      );
      if (!result.ok || result.value.duplicate) return result;

      try {
        checkpointActiveDocumentRevisionIfDue(getDb(), {
          documentId: request.payload.documentId,
          storeEpoch: request.payload.storeEpoch,
        });
      } catch (error) {
        postLog("warn", "Active Document revision checkpoint deferred", {
          documentId: request.payload.documentId,
          updateId: request.payload.updateId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // applyUpdate only returns after its SQLite transaction commits. Publish
      // the DatabasePage summary from that same committed materialization so every
      // window/browser updates without making the legacy Page projection authoritative
      // again. A post-commit projection read must never turn a durable ACK into
      // a retryable failure: a retry is a duplicate and intentionally emits no
      // second semantic event.
      try {
        publishPageTargetContentChange(request.payload.documentId);
        const projection = pagesStore.readPageDocumentBoardProjection(
          getDb(),
          request.payload.documentId,
        );
        if (!projection) {
          return result;
        }

        dbNotifier.notifyChange(
          projection.projectId,
          "update",
          projection.status,
          projection.pageId,
          { summary: projection.summary },
        );
      } catch (error) {
        postLog("error", "Committed Page Document summary fanout failed", {
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
      const executionAuthority = request.payload.executionAuthority;
      const options = {
        ...(request.payload.writeFence
          ? { writeFence: request.payload.writeFence }
          : {}),
        ...(executionAuthority
          ? {
              beforeMutationApply: () => {
                assertNodexAgentResourceAuthorizationInDatabase(getDb(), {
                  authority: executionAuthority.authority,
                  resource: executionAuthority.resource,
                  action: "write",
                  ...(executionAuthority.resourceAccess
                    ? { resourceAccess: executionAuthority.resourceAccess }
                    : {}),
                  callId: executionAuthority.callId,
                });
              },
            }
          : {}),
      };
      const result = "operations" in mutation
        ? applyDocumentOperationBatch(getDb(), mutation, options)
        : "nfm" in mutation
          ? replaceDocumentFromNfm(getDb(), mutation, options)
          : restoreDocumentVersion(getDb(), mutation, options);
      if (!result.ok) return result;
      if (result.value.duplicate) return result;

      blockDocumentRuntime.invalidate(mutation.documentId);

      try {
        publishPageTargetContentChange(mutation.documentId);
        const projection = pagesStore.readPageDocumentBoardProjection(
          getDb(),
          mutation.documentId,
        );
        if (!projection) {
          return result;
        }
        dbNotifier.notifyChange(
          projection.projectId,
          "update",
          projection.status,
          projection.pageId,
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
          publishPageTargetContentChange(head.documentId);
          const projection = pagesStore.readPageDocumentBoardProjection(
            getDb(),
            head.documentId,
          );
          if (!projection) continue;
          dbNotifier.notifyChange(
            projection.projectId,
            "update",
            projection.status,
            projection.pageId,
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
    case "listPageHistory":
      return runPageHistoryCommand(() =>
        listPageHistory(getDb(), request.payload),
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
      publishRelocationPageSummaries(result.value);
      if (!result.value.duplicate) {
        for (const blockId of result.value.rootBlockIds) {
          publishPageTargetChange(blockId, "location");
        }
      }
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
  const capturedTargetEvents: PageTargetChangedEvent[] = [];
  const onBoardChanged = (event: LocalBoardChangeEvent) => {
    capturedEvents.push(event);
  };
  const onPageTargetChanged = (event: PageTargetChangedEvent) => {
    capturedTargetEvents.push(event);
  };

  dbNotifier.on("board-changed", onBoardChanged);
  dbNotifier.on("page-target-changed", onPageTargetChanged);
  try {
    const result = await runRequest(request);
    dbNotifier.removeListener("board-changed", onBoardChanged);
    dbNotifier.removeListener("page-target-changed", onPageTargetChanged);

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
    metrics.eventCount = events.length + capturedTargetEvents.length;

    postResponse({
      id: request.id,
      ok: true,
      result,
      events,
      targetEvents: capturedTargetEvents,
      metrics,
    });

    if (request.type === "shutdown") {
      postLog("info", "Block mutation worker shut down");
    }
  } catch (error) {
    dbNotifier.removeListener("board-changed", onBoardChanged);
    dbNotifier.removeListener("page-target-changed", onPageTargetChanged);
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
        eventCount: capturedEvents.length + capturedTargetEvents.length,
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
