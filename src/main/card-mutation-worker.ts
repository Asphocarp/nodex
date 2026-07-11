import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { closeDatabase, getDb } from "./local-store/database";
import {
  dbNotifier,
  type BoardChangeEvent as LocalBoardChangeEvent,
} from "./local-store/notifier";
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
import {
  migrateLegacyForeignReferences,
  type ForeignReferenceMigrationBatchResult,
} from "./local-store/foreign-reference-migration";
import { toDocumentSyncCommandError } from "./local-store/block-document-store";
import {
  BlockRelocationStoreError,
  prepareRelocationCommand,
  readCommittedRelocation,
  relocateBlocksAtomically,
} from "./local-store/block-relocations";
import { repairDocumentSecondaryProjections } from "./local-store/block-document-projections";
import { applyBlockPropertyMutation } from "./local-store/block-property-mutations";
import { readAuthoritativeCardSummaryById } from "./local-store/card-read-store";
import {
  BlockDocumentRuntime,
  createSqliteBlockDocumentRuntimeAuthority,
} from "./block-document-runtime";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type {
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  RelocationCommandError,
  RelocationCommandResult,
  RelocationResult,
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
const FOREIGN_REFERENCE_BATCH_LIMIT = 50;
const AUTHORITY_BOUNDARY_MIGRATION_LIMIT = 10_000;
const AUTHORITY_BOUNDARY_FIXED_POINT_LIMIT = 100;
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

interface ForeignReferenceMigrationMetrics {
  readonly processedDocuments: number;
  readonly migratedReferences: number;
  readonly failedDocuments: number;
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

const EMPTY_FOREIGN_REFERENCE_MIGRATION_METRICS: ForeignReferenceMigrationMetrics =
  {
    processedDocuments: 0,
    migratedReferences: 0,
    failedDocuments: 0,
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
    case "migrateLegacyForeignReferences":
    case "repairDocumentSecondaryProjections":
    case "applyBlockPropertyMutation":
    case "syncBlockDocument":
    case "getBlockDocumentProjectId":
    case "getOwnedBlockDocumentDescriptor":
    case "prepareOwnedBlockDocument":
    case "cutoverCardDocumentToPrimary":
    case "cutoverEligibleCardDocuments":
    case "applyBlockDocumentUpdate":
    case "relocateBlocks":
    case "prepareRelocationCommand":
    case "readCommittedRelocation":
    case "writerBarrier":
    case "shutdown":
      return false;
  }
};

const summarizeForeignReferenceMigration = (
  result: ForeignReferenceMigrationBatchResult,
): ForeignReferenceMigrationMetrics => ({
  processedDocuments: result.processedDocuments,
  migratedReferences: result.migratedReferences,
  failedDocuments: result.failedDocuments,
  exhausted: result.exhausted,
});

const mergeForeignReferenceMigrationMetrics = (
  left: ForeignReferenceMigrationMetrics,
  right: ForeignReferenceMigrationMetrics,
): ForeignReferenceMigrationMetrics => ({
  processedDocuments: left.processedDocuments + right.processedDocuments,
  migratedReferences: left.migratedReferences + right.migratedReferences,
  failedDocuments: left.failedDocuments + right.failedDocuments,
  // Batches are sequential reads of the same queue. The latest batch says
  // whether the queue is now exhausted; an earlier bounded batch does not
  // permanently poison that final state.
  exhausted: right.exhausted,
});

const invalidateChangedForeignReferenceDocuments = (
  result: ForeignReferenceMigrationBatchResult,
): void => {
  for (const documentId of result.changedDocumentIds) {
    blockDocumentRuntime.invalidate(documentId);
  }
};

type ForeignReferenceMigrationPhase =
  "explicit" | "pre_cutover" | "post_mutation";

const logForeignReferenceMigration = (
  phase: ForeignReferenceMigrationPhase,
  result: ForeignReferenceMigrationBatchResult,
): void => {
  for (const error of result.errors) {
    postLog("error", "Legacy foreign-reference migration failed", {
      phase,
      documentId: error.documentId,
      error: error.message,
      cutoverBlocked: true,
    });
  }
  if (!result.exhausted && result.failedDocuments === 0) {
    postLog("debug", "Legacy foreign-reference migration batch has more work", {
      phase,
      processedDocuments: result.processedDocuments,
      migratedReferences: result.migratedReferences,
    });
  }
};

const runForeignReferenceMigrationBatch = async (
  phase: ForeignReferenceMigrationPhase,
  limit?: number,
): Promise<ForeignReferenceMigrationBatchResult> => {
  // The store only reports a changed Document after its SQLite transaction has
  // committed. Invalidation belongs after that durable boundary so a failed
  // migration cannot evict a valid runtime and expose tentative state.
  const result = await migrateLegacyForeignReferences(getDb(), { limit });
  invalidateChangedForeignReferenceDocuments(result);
  logForeignReferenceMigration(phase, result);
  return result;
};

const safelyDrainForeignReferenceMigrations = async (
  phase: Exclude<ForeignReferenceMigrationPhase, "explicit">,
  maxDocuments: number,
): Promise<ForeignReferenceMigrationMetrics> => {
  let remaining = maxDocuments;
  let aggregate = EMPTY_FOREIGN_REFERENCE_MIGRATION_METRICS;
  while (remaining > 0) {
    let batch: ForeignReferenceMigrationBatchResult;
    try {
      batch = await runForeignReferenceMigrationBatch(
        phase,
        Math.min(FOREIGN_REFERENCE_BATCH_LIMIT, remaining),
      );
    } catch (error) {
      postLog("error", "Legacy foreign-reference migration could not run", {
        phase,
        error: toErrorMessage(error),
        cutoverBlocked: true,
      });
      return {
        ...aggregate,
        failedDocuments: aggregate.failedDocuments + 1,
        exhausted: false,
      };
    }

    const metrics = summarizeForeignReferenceMigration(batch);
    aggregate = mergeForeignReferenceMigrationMetrics(aggregate, metrics);
    if (batch.failedDocuments > 0 || batch.exhausted) return aggregate;
    if (batch.processedDocuments === 0) {
      postLog("error", "Legacy foreign-reference migration made no progress", {
        phase,
        cutoverBlocked: true,
      });
      return {
        ...aggregate,
        failedDocuments: aggregate.failedDocuments + 1,
        exhausted: false,
      };
    }
    remaining -= batch.processedDocuments;
  }

  postLog(
    "warn",
    "Legacy foreign-reference migration reached its bounded limit",
    {
      phase,
      processedDocuments: aggregate.processedDocuments,
      migratedReferences: aggregate.migratedReferences,
      cutoverBlocked: true,
    },
  );
  return { ...aggregate, exhausted: false };
};

const settleForeignReferencesBeforeCutover = async (): Promise<{
  readonly shadow: ShadowDrainMetrics;
  readonly foreignReferences: ForeignReferenceMigrationMetrics;
}> => {
  let shadow = EMPTY_SHADOW_DRAIN_METRICS;
  let foreignReferences = EMPTY_FOREIGN_REFERENCE_MIGRATION_METRICS;
  for (
    let round = 0;
    round < AUTHORITY_BOUNDARY_FIXED_POINT_LIMIT;
    round += 1
  ) {
    const migration = await safelyDrainForeignReferenceMigrations(
      "pre_cutover",
      AUTHORITY_BOUNDARY_MIGRATION_LIMIT,
    );
    foreignReferences = mergeForeignReferenceMigrationMetrics(
      foreignReferences,
      migration,
    );
    const projection = safelyDrainLegacyCardShadowJobs(
      "pre_cutover",
      STARTUP_SHADOW_DRAIN_LIMIT,
    );
    shadow = mergeShadowDrainMetrics(shadow, projection);
    if (migration.failedDocuments > 0 || !migration.exhausted) {
      return { shadow, foreignReferences };
    }
    if (projection.errors > 0 || !projection.exhausted) {
      return {
        shadow,
        foreignReferences: {
          ...foreignReferences,
          failedDocuments: foreignReferences.failedDocuments + 1,
          exhausted: false,
        },
      };
    }
    if (migration.processedDocuments === 0 && projection.processed === 0) {
      return { shadow, foreignReferences };
    }
  }

  postLog(
    "error",
    "Legacy foreign-reference migration did not reach a fixed point",
    {
      phase: "pre_cutover",
      rounds: AUTHORITY_BOUNDARY_FIXED_POINT_LIMIT,
      cutoverBlocked: true,
    },
  );
  return {
    shadow,
    foreignReferences: {
      ...foreignReferences,
      failedDocuments: foreignReferences.failedDocuments + 1,
      exhausted: false,
    },
  };
};

const safelySettleTargetShadowJobs = (
  targetJobs: readonly ShadowMutationJobRow[],
): ShadowDrainMetrics => {
  if (targetJobs.length === 0) return EMPTY_SHADOW_DRAIN_METRICS;
  try {
    const drain = settleShadowMutationJobs(targetJobs);
    try {
      invalidateChangedShadowDocuments(drain);
    } catch (error) {
      blockDocumentRuntime.destroy();
      throw error;
    }
    logShadowDrain("post_mutation", drain);
    return summarizeShadowDrain(drain);
  } catch (error) {
    postLog("error", "Migration shadow fence could not settle", {
      phase: "post_mutation",
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

const settlePostMutationForeignReferences = async (): Promise<{
  readonly shadow: ShadowDrainMetrics;
  readonly foreignReferences: ForeignReferenceMigrationMetrics;
}> => {
  let shadow = EMPTY_SHADOW_DRAIN_METRICS;
  let foreignReferences = EMPTY_FOREIGN_REFERENCE_MIGRATION_METRICS;
  for (
    let round = 0;
    round < AUTHORITY_BOUNDARY_FIXED_POINT_LIMIT;
    round += 1
  ) {
    const migrationFenceStartedAt = new Date().toISOString();
    const migration = await safelyDrainForeignReferenceMigrations(
      "post_mutation",
      AUTHORITY_BOUNDARY_MIGRATION_LIMIT,
    );
    foreignReferences = mergeForeignReferenceMigrationMetrics(
      foreignReferences,
      migration,
    );
    const migrationJobs = readShadowMutationJobs(migrationFenceStartedAt);
    const projection = safelySettleTargetShadowJobs(migrationJobs);
    shadow = mergeShadowDrainMetrics(shadow, projection);
    if (migration.failedDocuments > 0 || !migration.exhausted) {
      return { shadow, foreignReferences };
    }
    if (projection.errors > 0 || !projection.exhausted) {
      return {
        shadow,
        foreignReferences: {
          ...foreignReferences,
          failedDocuments: foreignReferences.failedDocuments + 1,
          exhausted: false,
        },
      };
    }
    if (migration.processedDocuments === 0 && migrationJobs.length === 0) {
      return { shadow, foreignReferences };
    }
  }

  postLog(
    "error",
    "Post-mutation foreign-reference migration did not reach a fixed point",
    {
      rounds: AUTHORITY_BOUNDARY_FIXED_POINT_LIMIT,
      cutoverBlocked: true,
    },
  );
  return {
    shadow,
    foreignReferences: {
      ...foreignReferences,
      failedDocuments: foreignReferences.failedDocuments + 1,
      exhausted: false,
    },
  };
};

const summarizeShadowDrain = (
  drain: LegacyCardShadowDrainResult,
): ShadowDrainMetrics => ({
  processed: drain.results.length,
  applied: drain.results.filter((result) => result.outcome === "applied")
    .length,
  superseded: drain.results.filter((result) => result.outcome === "superseded")
    .length,
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
  const changedCardIds = Array.from(
    new Set(
      drain.results
        .filter((result) => result.documentChanged)
        .map((result) => result.cardId),
    ),
  );
  if (changedCardIds.length === 0) return;

  const readDocumentId = getDb().prepare(`
    SELECT document_id
    FROM block_documents
    WHERE block_id = ?
  `);
  for (const cardId of changedCardIds) {
    const row = readDocumentId.get(cardId) as
      { readonly document_id: string } | undefined;
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
  getDb()
    .prepare(
      `
    SELECT id, card_id, source_event_seq, status
    FROM legacy_card_shadow_jobs
    WHERE enqueued_at >= ?
    ORDER BY card_id ASC, source_event_seq ASC
  `,
    )
    .all(enqueuedSince) as readonly ShadowMutationJobRow[];

const readShadowMutationJobsById = (
  jobIds: readonly string[],
): readonly ShadowMutationJobRow[] => {
  if (jobIds.length === 0) return [];
  const placeholders = jobIds.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `
    SELECT id, card_id, source_event_seq, status
    FROM legacy_card_shadow_jobs
    WHERE id IN (${placeholders})
    ORDER BY card_id ASC, source_event_seq ASC
  `,
    )
    .all(...jobIds) as readonly ShadowMutationJobRow[];
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
    results.push(
      ...readShadowMutationJobsById([...forcedIds])
        .filter((job) => job.status === "failed")
        .map(makeForcedFailureResult),
    );
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

function runDocumentCommand<T>(
  operation: () => T,
): DocumentSyncCommandResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: toDocumentSyncCommandError(error) };
  }
}

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
    resetRequired:
      code === "document_not_found" ||
      code === "document_generation_mismatch" ||
      code === "document_state_corrupt",
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

function descriptionBytesForRequest(
  request: CardMutationWorkerRequest,
): number | undefined {
  if (
    request.type === "updateCard" &&
    typeof request.payload.updates.description === "string"
  ) {
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
      ...request.payload.input.sourceUpdates.map(
        (update) => update.updates.description,
      ),
    ].filter(
      (description): description is string => typeof description === "string",
    );
    if (descriptions.length === 0) return undefined;
    return descriptions.reduce(
      (sum, description) => sum + Buffer.byteLength(description, "utf8"),
      0,
    );
  }

  if (request.type === "applyCardEditorDrop") {
    const descriptions = request.payload.input.targetUpdates
      .map((update) => update.updates.description)
      .filter(
        (description): description is string => typeof description === "string",
      );
    if (descriptions.length === 0) return undefined;
    return descriptions.reduce(
      (sum, description) => sum + Buffer.byteLength(description, "utf8"),
      0,
    );
  }

  return undefined;
}

function readLatestDescriptionRevisionKind(
  cardId: string,
): "snapshot" | "delta" | undefined {
  const row = getDb()
    .prepare(
      `
    SELECT description_revisions.kind
    FROM cards
    LEFT JOIN description_revisions ON description_revisions.id = cards.description_revision_id
    WHERE cards.id = ?
  `,
    )
    .get(cardId) as { kind: "snapshot" | "delta" | null } | undefined;

  return row?.kind ?? undefined;
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
  const summary =
    cardsStore.syncCardReadModel(getDb(), cardId) ??
    cardsStore.readCardSummaryById(cardId);
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
  request: CardMutationWorkerRequest,
): Promise<CardMutationWorkerResult> {
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
      const description = await fsp.readFile(
        request.payload.descriptionFilePath,
        "utf8",
      );
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
      return historyStore.undoLatest(
        request.payload.projectId,
        request.payload.sessionId,
      );
    case "redoLatest":
      return historyStore.redoLatest(
        request.payload.projectId,
        request.payload.sessionId,
      );
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
    case "migrateLegacyForeignReferences":
      return await runForeignReferenceMigrationBatch(
        "explicit",
        request.payload.limit,
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
    case "syncBlockDocument":
      return runDocumentCommand(() =>
        blockDocumentRuntime.sync(request.payload),
      );
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
        const cutover = cutoverEligibleCardDocumentsToPrimary(getDb(), [
          request.payload.ownerBlockId,
        ]);
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
  readonly foreignReferences: ForeignReferenceMigrationMetrics;
}> => {
  if (request.type === "initializeBlockDocumentShadows") {
    const shadow = safelyDrainLegacyCardShadowJobs(
      "startup",
      STARTUP_SHADOW_DRAIN_LIMIT,
    );
    if (shadow.errors === 0 && shadow.exhausted) {
      legacyShadowProcessorInitialized = true;
    }
    return {
      result: shadow satisfies BlockDocumentShadowInitializationResult,
      shadow,
      foreignReferences: EMPTY_FOREIGN_REFERENCE_MIGRATION_METRICS,
    };
  }
  if (request.type === "migrateLegacyForeignReferences") {
    const result = await runForeignReferenceMigrationBatch(
      "explicit",
      request.payload.limit,
    );
    return {
      result,
      shadow: EMPTY_SHADOW_DRAIN_METRICS,
      foreignReferences: summarizeForeignReferenceMigration(result),
    };
  }
  if (request.type === "prepareOwnedBlockDocument") {
    const current = runOwnedDocumentPreparationCommand(() =>
      getOwnedBlockDocumentDescriptor(
        getDb(),
        request.payload.projectId,
        request.payload.ownerBlockId,
      ),
    );
    if (!current.ok || current.value.authority === "ydoc_primary") {
      return {
        result: current,
        shadow: EMPTY_SHADOW_DRAIN_METRICS,
        foreignReferences: EMPTY_FOREIGN_REFERENCE_MIGRATION_METRICS,
      };
    }
  }
  if (
    request.type === "prepareOwnedBlockDocument" ||
    request.type === "cutoverCardDocumentToPrimary" ||
    request.type === "cutoverEligibleCardDocuments"
  ) {
    const startup = initializeLegacyShadowProcessor();
    const preCutover = safelyDrainLegacyCardShadowJobs(
      "pre_cutover",
      STARTUP_SHADOW_DRAIN_LIMIT,
    );
    const settled = await settleForeignReferencesBeforeCutover();
    const foreignReferences = settled.foreignReferences;
    if (!foreignReferences.exhausted || foreignReferences.failedDocuments > 0) {
      if (request.type === "prepareOwnedBlockDocument") {
        return {
          result: {
            ok: false,
            error: {
              code: "document_not_ready",
              message:
                "Legacy foreign-reference migration did not reach a safe cutover boundary",
              retryable: true,
              resetRequired: false,
            },
          },
          shadow: mergeShadowDrainMetrics(
            mergeShadowDrainMetrics(startup, preCutover),
            settled.shadow,
          ),
          foreignReferences,
        };
      }
      throw new BlockDocumentCutoverError(
        "foreign_body_reference",
        "Legacy foreign-reference migration did not reach a safe cutover boundary",
      );
    }
    return {
      result: await runRequest(request),
      shadow: mergeShadowDrainMetrics(
        mergeShadowDrainMetrics(startup, preCutover),
        settled.shadow,
      ),
      foreignReferences,
    };
  }
  if (!isLegacyAuthorityMutation(request)) {
    return {
      result: await runRequest(request),
      shadow: EMPTY_SHADOW_DRAIN_METRICS,
      foreignReferences: EMPTY_FOREIGN_REFERENCE_MIGRATION_METRICS,
    };
  }

  const startup = initializeLegacyShadowProcessor();
  const mutationFenceStartedAt = new Date().toISOString();
  const result = await runRequest(request);
  const targetJobs = readShadowMutationJobs(mutationFenceStartedAt);
  const postMutation = settlePostMutationShadowBoundary(targetJobs);
  const settled = await settlePostMutationForeignReferences();
  const foreignReferences = settled.foreignReferences;
  if (!foreignReferences.exhausted || foreignReferences.failedDocuments > 0) {
    throw new BlockDocumentCutoverError(
      "foreign_body_reference",
      "Legacy mutation committed, but its foreign-reference migration did not reach a durable authority boundary; reload before retrying",
    );
  }
  return {
    result,
    shadow: mergeShadowDrainMetrics(
      mergeShadowDrainMetrics(startup, postMutation),
      settled.shadow,
    ),
    foreignReferences,
  };
};

async function handleRequest(
  request: CardMutationWorkerRequest,
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
    const { result, shadow, foreignReferences } =
      await runRequestAtAuthorityBoundary(request);
    dbNotifier.removeListener("board-changed", onBoardChanged);

    const metrics: CardMutationMetrics = {
      mutationId: request.mutationId,
      queueWaitMs: Math.max(
        0,
        workerStartedAtEpochMs - request.queuedAtEpochMs,
      ),
      workerDurationMs: Math.round(performance.now() - workerStartedAt),
      transactionMs: Math.round(performance.now() - transactionStartedAt),
      descriptionBytes: descriptionBytesForRequest(request),
      summaryBytes:
        result && typeof result === "object" && "summary" in result
          ? approximatePayloadBytes(result.summary)
          : undefined,
      revisionKind:
        (request.type === "updateCard" &&
          "description" in request.payload.updates) ||
        request.type === "updateCardDescriptionFromFile"
          ? readLatestDescriptionRevisionKind(request.payload.cardId)
          : undefined,
      eventCount: 0,
      shadowJobsProcessed: shadow.processed || undefined,
      shadowJobsApplied: shadow.applied || undefined,
      shadowJobsSuperseded: shadow.superseded || undefined,
      shadowJobsFailed: shadow.failed || undefined,
      shadowDrainErrors: shadow.errors || undefined,
      shadowDrainExhausted:
        shadow.processed > 0 || shadow.errors > 0
          ? shadow.exhausted
          : undefined,
      foreignReferenceDocumentsProcessed:
        foreignReferences.processedDocuments || undefined,
      foreignReferencesMigrated:
        foreignReferences.migratedReferences || undefined,
      foreignReferenceMigrationsFailed:
        foreignReferences.failedDocuments || undefined,
      foreignReferenceMigrationExhausted:
        foreignReferences.processedDocuments > 0 ||
        foreignReferences.failedDocuments > 0
          ? foreignReferences.exhausted
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
        queueWaitMs: Math.max(
          0,
          workerStartedAtEpochMs - request.queuedAtEpochMs,
        ),
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
