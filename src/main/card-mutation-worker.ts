import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { closeDatabase, getDb } from "./local-store/database";
import { dbNotifier, type BoardChangeEvent as LocalBoardChangeEvent } from "./local-store/notifier";
import * as cardsStore from "./local-store/cards";
import * as cardOccurrences from "./local-store/card-occurrences";
import * as historyStore from "./local-store/history";
import {
  BlockDocumentCutoverError,
  cutoverCardDocumentToPrimary,
  cutoverEligibleCardDocumentsToPrimary,
  getOwnedBlockDocumentDescriptor,
} from "./local-store/block-document-cutover";
import {
  drainLegacyCardShadowJobs,
  processClaimedLegacyCardShadowJob,
  type LegacyCardShadowDrainResult,
  type LegacyCardShadowProcessingResult,
} from "./local-store/legacy-card-shadow-processor";
import {
  claimNextLegacyCardShadowJobForCard,
  markPendingLegacyCardShadowJobsFailed,
  type LegacyCardShadowJobStatus,
} from "./local-store/legacy-card-shadow-outbox";
import { toDocumentSyncCommandError } from "./local-store/block-document-store";
import {
  BlockDocumentRuntime,
  createSqliteBlockDocumentRuntimeAuthority,
} from "./block-document-runtime";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type {
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
} from "../shared/block-documents";
import type { Card, CardSummary } from "../shared/types";
import type {
  BlockDocumentShadowInitializationResult,
  CardMutationMetrics,
  CardMutationWorkerMessage,
  CardMutationWorkerRequest,
  CardMutationWorkerResponse,
  CardMutationWorkerResult,
} from "./card-mutation-worker-protocol";

const blockDocumentRuntime = new BlockDocumentRuntime(
  createSqliteBlockDocumentRuntimeAuthority(getDb),
);

const STARTUP_SHADOW_DRAIN_LIMIT = 10_000;
const POST_MUTATION_SHADOW_DRAIN_LIMIT = 100;
const POST_MUTATION_TARGET_DRAIN_LIMIT = 10_000;
const POST_MUTATION_FENCE_FAILURE =
  "The mutation shadow fence could not be processed within its bounded drain";

interface ShadowDrainMetrics {
  readonly processed: number;
  readonly applied: number;
  readonly superseded: number;
  readonly failed: number;
  readonly errors: number;
  readonly exhausted: boolean;
}

const EMPTY_SHADOW_DRAIN_METRICS: ShadowDrainMetrics = {
  processed: 0,
  applied: 0,
  superseded: 0,
  failed: 0,
  errors: 0,
  exhausted: true,
};

let legacyShadowProcessorInitialized = false;

interface ShadowMutationJobRow {
  readonly id: string;
  readonly card_id: string;
  readonly source_event_seq: number;
  readonly status: LegacyCardShadowJobStatus;
}

class LegacyShadowMutationFenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyShadowMutationFenceError";
  }
}

function postMessage(message: CardMutationWorkerMessage): void {
  parentPort?.postMessage(message);
}

function postResponse(response: CardMutationWorkerResponse): void {
  postMessage(response);
}

function postLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
): void {
  postMessage({ type: "log", payload: { level, message, data } });
}

const isLegacyAuthorityMutation = (
  request: CardMutationWorkerRequest,
): boolean => {
  switch (request.type) {
    case "createCard":
    case "updateCard":
    case "updateCardDescriptionFromFile":
    case "deleteCard":
    case "moveCard":
    case "moveCards":
    case "moveCardToProject":
    case "importBlockDropAsCards":
    case "applyCardEditorDrop":
    case "completeCardOccurrence":
    case "skipCardOccurrence":
    case "updateCardOccurrence":
    case "undoLatest":
    case "redoLatest":
    case "revertEntry":
    case "restoreToEntry":
      return true;
    case "getCardHistoryVersionPreview":
    case "backfillCardReadModel":
    case "initializeBlockDocumentShadows":
    case "syncBlockDocument":
    case "getBlockDocumentProjectId":
    case "getOwnedBlockDocumentDescriptor":
    case "prepareOwnedBlockDocument":
    case "cutoverCardDocumentToPrimary":
    case "cutoverEligibleCardDocuments":
    case "applyBlockDocumentUpdate":
    case "writerBarrier":
    case "shutdown":
      return false;
  }
};

const summarizeShadowDrain = (
  drain: LegacyCardShadowDrainResult,
): ShadowDrainMetrics => ({
  processed: drain.results.length,
  applied: drain.results.filter((result) => result.outcome === "applied").length,
  superseded: drain.results.filter(
    (result) => result.outcome === "superseded",
  ).length,
  failed: drain.results.filter((result) => result.outcome === "failed").length,
  errors: 0,
  exhausted: drain.exhausted,
});

const mergeShadowDrainMetrics = (
  left: ShadowDrainMetrics,
  right: ShadowDrainMetrics,
): ShadowDrainMetrics => ({
  processed: left.processed + right.processed,
  applied: left.applied + right.applied,
  superseded: left.superseded + right.superseded,
  failed: left.failed + right.failed,
  errors: left.errors + right.errors,
  exhausted: left.exhausted && right.exhausted,
});

const invalidateChangedShadowDocuments = (
  drain: LegacyCardShadowDrainResult,
): void => {
  const changedCardIds = Array.from(new Set(
    drain.results
      .filter((result) => result.documentChanged)
      .map((result) => result.cardId),
  ));
  if (changedCardIds.length === 0) return;

  const readDocumentId = getDb().prepare(`
    SELECT document_id
    FROM block_documents
    WHERE block_id = ?
  `);
  for (const cardId of changedCardIds) {
    const row = readDocumentId.get(cardId) as
      | { readonly document_id: string }
      | undefined;
    if (!row) continue;
    blockDocumentRuntime.invalidate(row.document_id);
  }
};

type ShadowDrainPhase = "startup" | "pre_cutover" | "post_mutation";

const logShadowDrain = (
  phase: ShadowDrainPhase,
  drain: LegacyCardShadowDrainResult,
): void => {
  for (const result of drain.results) {
    if (result.outcome !== "failed") continue;
    postLog("error", "Legacy Card shadow job reached terminal failure", {
      phase,
      jobId: result.jobId,
      cardId: result.cardId,
      sourceEventSeq: result.sourceEventSeq,
      error: result.error,
      cutoverBlocked: true,
    });
  }

  const metrics = summarizeShadowDrain(drain);
  if (!drain.exhausted) {
    postLog("warn", "Legacy Card shadow drain reached its bounded limit", {
      phase,
      processed: metrics.processed,
      applied: metrics.applied,
      superseded: metrics.superseded,
      failed: metrics.failed,
      cutoverBlocked: true,
    });
    return;
  }
  if (metrics.processed === 0) return;
  postLog("debug", "Legacy Card shadow drain completed", {
    phase,
    processed: metrics.processed,
    applied: metrics.applied,
    superseded: metrics.superseded,
    failed: metrics.failed,
  });
};

/**
 * Shadow translation is downstream of a committed legacy mutation. A failed
 * projection must block cutover, but must never turn the already-committed
 * Card operation into a false failure at the caller boundary.
 */
const safelyDrainLegacyCardShadowJobs = (
  phase: ShadowDrainPhase,
  maxJobs: number,
): ShadowDrainMetrics => {
  try {
    const drain = drainLegacyCardShadowJobs(getDb(), { maxJobs });
    try {
      invalidateChangedShadowDocuments(drain);
    } catch (error) {
      // A committed shadow update must never leave an older cached Y.Doc
      // reachable, even if descriptor lookup itself becomes unavailable.
      blockDocumentRuntime.destroy();
      throw error;
    }
    logShadowDrain(phase, drain);
    return summarizeShadowDrain(drain);
  } catch (error) {
    postLog("error", "Legacy Card shadow drain could not run", {
      phase,
      error: toErrorMessage(error),
      cutoverBlocked: true,
    });
    return {
      ...EMPTY_SHADOW_DRAIN_METRICS,
      errors: 1,
      exhausted: false,
    };
  }
};

const initializeLegacyShadowProcessor = (): ShadowDrainMetrics => {
  if (legacyShadowProcessorInitialized) return EMPTY_SHADOW_DRAIN_METRICS;
  const metrics = safelyDrainLegacyCardShadowJobs(
    "startup",
    STARTUP_SHADOW_DRAIN_LIMIT,
  );
  if (metrics.errors === 0 && metrics.exhausted) {
    legacyShadowProcessorInitialized = true;
  }
  return metrics;
};

const readShadowMutationJobs = (
  enqueuedSince: string,
): readonly ShadowMutationJobRow[] =>
  getDb().prepare(`
    SELECT id, card_id, source_event_seq, status
    FROM legacy_card_shadow_jobs
    WHERE enqueued_at >= ?
    ORDER BY card_id ASC, source_event_seq ASC
  `).all(enqueuedSince) as readonly ShadowMutationJobRow[];

const readShadowMutationJobsById = (
  jobIds: readonly string[],
): readonly ShadowMutationJobRow[] => {
  if (jobIds.length === 0) return [];
  const placeholders = jobIds.map(() => "?").join(", ");
  return getDb().prepare(`
    SELECT id, card_id, source_event_seq, status
    FROM legacy_card_shadow_jobs
    WHERE id IN (${placeholders})
    ORDER BY card_id ASC, source_event_seq ASC
  `).all(...jobIds) as readonly ShadowMutationJobRow[];
};

const isTerminalShadowJobStatus = (
  status: LegacyCardShadowJobStatus,
): boolean =>
  status === "applied" || status === "superseded" || status === "failed";

const makeForcedFailureResult = (
  row: ShadowMutationJobRow,
): LegacyCardShadowProcessingResult => ({
  jobId: row.id,
  cardId: row.card_id,
  sourceEventSeq: row.source_event_seq,
  outcome: "failed",
  documentHeadSeq: null,
  documentChanged: false,
  error: POST_MUTATION_FENCE_FAILURE,
});

const settleShadowMutationJobs = (
  targetJobs: readonly ShadowMutationJobRow[],
): LegacyCardShadowDrainResult => {
  const targetIds = targetJobs.map((job) => job.id);
  if (targetIds.length === 0) return { exhausted: true, results: [] };

  const throughEventByCard = new Map<string, number>();
  for (const job of targetJobs) {
    throughEventByCard.set(
      job.card_id,
      Math.max(throughEventByCard.get(job.card_id) ?? 0, job.source_event_seq),
    );
  }

  const results: LegacyCardShadowProcessingResult[] = [];
  while (results.length < POST_MUTATION_TARGET_DRAIN_LIMIT) {
    const unsettled = readShadowMutationJobsById(targetIds).filter(
      (job) => !isTerminalShadowJobStatus(job.status),
    );
    if (unsettled.length === 0) {
      return { exhausted: true, results };
    }

    let madeProgress = false;
    for (const [cardId, throughSourceEventSeq] of throughEventByCard) {
      if (results.length >= POST_MUTATION_TARGET_DRAIN_LIMIT) break;
      const job = claimNextLegacyCardShadowJobForCard(
        getDb(),
        cardId,
        throughSourceEventSeq,
      );
      if (!job) continue;
      results.push(processClaimedLegacyCardShadowJob(getDb(), job));
      madeProgress = true;
    }
    if (!madeProgress) break;
  }

  const unsettled = readShadowMutationJobsById(targetIds).filter(
    (job) => !isTerminalShadowJobStatus(job.status),
  );
  const pending = unsettled.filter((job) => job.status === "pending");
  const forcedFailures = markPendingLegacyCardShadowJobsFailed(
    getDb(),
    pending.map((job) => job.id),
    POST_MUTATION_FENCE_FAILURE,
  );
  if (forcedFailures > 0) {
    const forcedIds = new Set(pending.map((job) => job.id));
    results.push(...readShadowMutationJobsById([...forcedIds])
      .filter((job) => job.status === "failed")
      .map(makeForcedFailureResult));
  }

  const stillUnsettled = readShadowMutationJobsById(targetIds).filter(
    (job) => !isTerminalShadowJobStatus(job.status),
  );
  if (stillUnsettled.length > 0) {
    throw new LegacyShadowMutationFenceError(
      `Mutation shadow jobs remained non-terminal: ${stillUnsettled
        .map((job) => `${job.id}:${job.status}`)
        .join(", ")}`,
    );
  }
  return { exhausted: true, results };
};

const settlePostMutationShadowBoundary = (
  targetJobs: readonly ShadowMutationJobRow[],
): ShadowDrainMetrics => {
  const background = safelyDrainLegacyCardShadowJobs(
    "post_mutation",
    POST_MUTATION_SHADOW_DRAIN_LIMIT,
  );
  if (targetJobs.length === 0) return background;

  const targeted = settleShadowMutationJobs(targetJobs);
  try {
    invalidateChangedShadowDocuments(targeted);
  } catch (error) {
    blockDocumentRuntime.destroy();
    throw error;
  }
  logShadowDrain("post_mutation", targeted);
  return mergeShadowDrainMetrics(background, summarizeShadowDrain(targeted));
};

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

function runDocumentCommand<T>(operation: () => T): DocumentSyncCommandResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toDocumentSyncCommandError(error) };
  }
}

const cutoverErrorCode = (
  error: BlockDocumentCutoverError,
): DocumentSyncCommandError["code"] => {
  switch (error.code) {
    case "owned_document_not_found":
      return "document_not_found";
    case "document_generation_mismatch":
      return "document_generation_mismatch";
    case "document_head_mismatch":
      return "future_base_head";
    case "shadow_ledger_failed":
    case "content_parity_failed":
    case "projection_parity_failed":
      return "document_state_corrupt";
    case "owner_not_writable":
    case "document_not_ready":
    case "shadow_ledger_not_drained":
    case "foreign_body_reference":
      return "document_not_ready";
  }
};

const toOwnedDocumentPreparationError = (
  error: unknown,
): DocumentSyncCommandError => {
  if (!(error instanceof BlockDocumentCutoverError)) {
    return toDocumentSyncCommandError(error);
  }
  const code = cutoverErrorCode(error);
  return {
    code,
    message: error.message,
    retryable: code === "document_not_ready" || code === "future_base_head",
    resetRequired: code === "document_not_found"
      || code === "document_generation_mismatch"
      || code === "document_state_corrupt",
  };
};

function runOwnedDocumentPreparationCommand<T>(
  operation: () => T,
): DocumentSyncCommandResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toOwnedDocumentPreparationError(error) };
  }
}

function approximatePayloadBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function descriptionBytesForRequest(request: CardMutationWorkerRequest): number | undefined {
  if (request.type === "updateCard" && typeof request.payload.updates.description === "string") {
    return Buffer.byteLength(request.payload.updates.description, "utf8");
  }

  if (request.type === "updateCardDescriptionFromFile") {
    try {
      return fs.statSync(request.payload.descriptionFilePath).size;
    } catch {
      return undefined;
    }
  }

  if (request.type === "importBlockDropAsCards") {
    const descriptions = [
      ...request.payload.input.cards.map((card) => card.description),
      ...request.payload.input.sourceUpdates.map((update) => update.updates.description),
    ].filter((description): description is string => typeof description === "string");
    if (descriptions.length === 0) return undefined;
    return descriptions.reduce((sum, description) => sum + Buffer.byteLength(description, "utf8"), 0);
  }

  if (request.type === "applyCardEditorDrop") {
    const descriptions = request.payload.input.targetUpdates
      .map((update) => update.updates.description)
      .filter((description): description is string => typeof description === "string");
    if (descriptions.length === 0) return undefined;
    return descriptions.reduce((sum, description) => sum + Buffer.byteLength(description, "utf8"), 0);
  }

  return undefined;
}

function readLatestDescriptionRevisionKind(cardId: string): "snapshot" | "delta" | undefined {
  const row = getDb().prepare(`
    SELECT description_revisions.kind
    FROM cards
    LEFT JOIN description_revisions ON description_revisions.id = cards.description_revision_id
    WHERE cards.id = ?
  `).get(cardId) as { kind: "snapshot" | "delta" | null } | undefined;

  return row?.kind ?? undefined;
}

function shouldReadSummary(event: BoardChangeEvent): boolean {
  if (!event.cardId) return false;
  if (event.changeType === "delete") return false;
  return true;
}

async function readEventSummary(event: BoardChangeEvent): Promise<CardSummary | undefined> {
  if (!shouldReadSummary(event)) return undefined;
  const cardId = event.cardId;
  if (!cardId) return undefined;
  const summary = cardsStore.syncCardReadModel(getDb(), cardId)
    ?? cardsStore.readCardSummaryById(cardId);
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
  metrics: CardMutationMetrics,
): Promise<BoardChangeEvent[]> {
  const enriched: BoardChangeEvent[] = [];

  for (const event of events) {
    const normalized = normalizeEvent(event);
    const summary = normalized.summary ?? await readEventSummary(normalized);
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

async function runRequest(request: CardMutationWorkerRequest): Promise<CardMutationWorkerResult> {
  switch (request.type) {
    case "createCard":
      return await cardsStore.createCard(
        request.payload.projectId,
        request.payload.columnId,
        request.payload.input,
        request.payload.sessionId,
        request.payload.placement,
      );
    case "updateCard":
      return await cardsStore.updateCard(
        request.payload.projectId,
        request.payload.columnId,
        request.payload.cardId,
        request.payload.updates,
        request.payload.sessionId,
        request.payload.expectedRevision,
      );
    case "updateCardDescriptionFromFile": {
      const description = await fsp.readFile(request.payload.descriptionFilePath, "utf8");
      return await cardsStore.updateCard(
        request.payload.projectId,
        request.payload.columnId,
        request.payload.cardId,
        { description },
        request.payload.sessionId,
        request.payload.expectedRevision,
      );
    }
    case "deleteCard":
      return await cardsStore.deleteCard(
        request.payload.projectId,
        request.payload.columnId,
        request.payload.cardId,
        request.payload.sessionId,
      );
    case "moveCard":
      return await cardsStore.moveCard(request.payload);
    case "moveCards":
      return await cardsStore.moveCards(request.payload);
    case "moveCardToProject":
      return await cardsStore.moveCardToProject(request.payload);
    case "importBlockDropAsCards":
      return await cardsStore.importBlockDropAsCards(
        request.payload.projectId,
        request.payload.input,
        request.payload.sessionId,
      );
    case "applyCardEditorDrop":
      return await cardsStore.applyCardEditorDrop(
        request.payload.projectId,
        request.payload.input,
        request.payload.sessionId,
      );
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
    case "getCardHistoryVersionPreview":
      return historyStore.getCardHistoryVersionPreview(
        request.payload.projectId,
        request.payload.cardId,
        request.payload.historyId,
      );
    case "undoLatest":
      return historyStore.undoLatest(request.payload.projectId, request.payload.sessionId);
    case "redoLatest":
      return historyStore.redoLatest(request.payload.projectId, request.payload.sessionId);
    case "revertEntry":
      return historyStore.revertEntry(
        request.payload.projectId,
        request.payload.historyId,
        request.payload.sessionId,
      );
    case "restoreToEntry":
      return historyStore.restoreToEntry(
        request.payload.projectId,
        request.payload.cardId,
        request.payload.historyId,
        request.payload.sessionId,
      );
    case "backfillCardReadModel":
      return cardsStore.backfillCardReadModelBatch(request.payload.limit);
    case "initializeBlockDocumentShadows":
      return undefined;
    case "syncBlockDocument":
      return runDocumentCommand(() => blockDocumentRuntime.sync(request.payload));
    case "getBlockDocumentProjectId":
      return runDocumentCommand(() =>
        blockDocumentRuntime.getProjectId(request.payload.documentId),
      );
    case "getOwnedBlockDocumentDescriptor":
      return getOwnedBlockDocumentDescriptor(
        getDb(),
        request.payload.projectId,
        request.payload.ownerBlockId,
      );
    case "prepareOwnedBlockDocument": {
      return runOwnedDocumentPreparationCommand(() => {
        const current = getOwnedBlockDocumentDescriptor(
          getDb(),
          request.payload.projectId,
          request.payload.ownerBlockId,
        );
        if (current.authority === "ydoc_primary") return current;
        const cutover = cutoverEligibleCardDocumentsToPrimary(
          getDb(),
          [request.payload.ownerBlockId],
        );
        for (const documentId of cutover.cutoverDocumentIds) {
          blockDocumentRuntime.invalidate(documentId);
        }
        return getOwnedBlockDocumentDescriptor(
          getDb(),
          request.payload.projectId,
          request.payload.ownerBlockId,
        );
      });
    }
    case "cutoverCardDocumentToPrimary": {
      const descriptor = cutoverCardDocumentToPrimary(getDb(), request.payload);
      blockDocumentRuntime.invalidate(descriptor.documentId);
      return descriptor;
    }
    case "cutoverEligibleCardDocuments": {
      const result = cutoverEligibleCardDocumentsToPrimary(
        getDb(),
        request.payload.ownerBlockIds,
      );
      for (const documentId of result.cutoverDocumentIds) {
        blockDocumentRuntime.invalidate(documentId);
      }
      return result;
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
    case "writerBarrier":
      return undefined;
    case "shutdown":
      blockDocumentRuntime.destroy();
      closeDatabase();
      return undefined;
  }
}

const runRequestAtAuthorityBoundary = async (
  request: CardMutationWorkerRequest,
): Promise<{
  readonly result: CardMutationWorkerResult;
  readonly shadow: ShadowDrainMetrics;
}> => {
  if (request.type === "initializeBlockDocumentShadows") {
    const shadow = initializeLegacyShadowProcessor();
    return {
      result: shadow satisfies BlockDocumentShadowInitializationResult,
      shadow,
    };
  }
  if (request.type === "prepareOwnedBlockDocument") {
    const shadow = initializeLegacyShadowProcessor();
    return {
      result: await runRequest(request),
      shadow,
    };
  }
  if (request.type === "cutoverCardDocumentToPrimary") {
    const startup = initializeLegacyShadowProcessor();
    const preCutover = safelyDrainLegacyCardShadowJobs(
      "pre_cutover",
      STARTUP_SHADOW_DRAIN_LIMIT,
    );
    return {
      result: await runRequest(request),
      shadow: mergeShadowDrainMetrics(startup, preCutover),
    };
  }
  if (!isLegacyAuthorityMutation(request)) {
    return {
      result: await runRequest(request),
      shadow: EMPTY_SHADOW_DRAIN_METRICS,
    };
  }

  const startup = initializeLegacyShadowProcessor();
  const mutationFenceStartedAt = new Date().toISOString();
  const result = await runRequest(request);
  const targetJobs = readShadowMutationJobs(mutationFenceStartedAt);
  const postMutation = settlePostMutationShadowBoundary(targetJobs);
  return {
    result,
    shadow: mergeShadowDrainMetrics(startup, postMutation),
  };
};

async function handleRequest(request: CardMutationWorkerRequest): Promise<void> {
  const workerStartedAtEpochMs = Date.now();
  const workerStartedAt = performance.now();
  const transactionStartedAt = performance.now();
  const capturedEvents: LocalBoardChangeEvent[] = [];
  const onBoardChanged = (event: LocalBoardChangeEvent) => {
    capturedEvents.push(event);
  };

  dbNotifier.on("board-changed", onBoardChanged);
  try {
    const { result, shadow } = await runRequestAtAuthorityBoundary(request);
    dbNotifier.removeListener("board-changed", onBoardChanged);

    const metrics: CardMutationMetrics = {
      mutationId: request.mutationId,
      queueWaitMs: Math.max(0, workerStartedAtEpochMs - request.queuedAtEpochMs),
      workerDurationMs: Math.round(performance.now() - workerStartedAt),
      transactionMs: Math.round(performance.now() - transactionStartedAt),
      descriptionBytes: descriptionBytesForRequest(request),
      summaryBytes: result && typeof result === "object" && "summary" in result
        ? approximatePayloadBytes(result.summary)
        : undefined,
      revisionKind: (
        (request.type === "updateCard" && "description" in request.payload.updates)
        || request.type === "updateCardDescriptionFromFile"
      )
        ? readLatestDescriptionRevisionKind(request.payload.cardId)
        : undefined,
      eventCount: 0,
      shadowJobsProcessed: shadow.processed || undefined,
      shadowJobsApplied: shadow.applied || undefined,
      shadowJobsSuperseded: shadow.superseded || undefined,
      shadowJobsFailed: shadow.failed || undefined,
      shadowDrainErrors: shadow.errors || undefined,
      shadowDrainExhausted: shadow.processed > 0 || shadow.errors > 0
        ? shadow.exhausted
        : undefined,
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
      postLog("info", "Card mutation worker shut down");
    }
  } catch (error) {
    dbNotifier.removeListener("board-changed", onBoardChanged);
    postResponse({
      id: request.id,
      ok: false,
      error: toErrorMessage(error),
      metrics: {
        mutationId: request.mutationId,
        queueWaitMs: Math.max(0, workerStartedAtEpochMs - request.queuedAtEpochMs),
        workerDurationMs: Math.round(performance.now() - workerStartedAt),
        transactionMs: Math.round(performance.now() - transactionStartedAt),
        descriptionBytes: descriptionBytesForRequest(request),
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

parentPort?.on("message", (message: CardMutationWorkerRequest) => {
  requestQueue = requestQueue.then(
    () => handleRequest(message),
    () => handleRequest(message),
  );
});
