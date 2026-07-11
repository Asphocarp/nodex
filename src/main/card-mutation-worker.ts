import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { closeDatabase, getDb } from "./local-store/database";
import { dbNotifier, type BoardChangeEvent as LocalBoardChangeEvent } from "./local-store/notifier";
import * as cardsStore from "./local-store/cards";
import * as cardOccurrences from "./local-store/card-occurrences";
import * as historyStore from "./local-store/history";
import { toDocumentSyncCommandError } from "./local-store/block-document-store";
import {
  BlockDocumentRuntime,
  createSqliteBlockDocumentRuntimeAuthority,
} from "./block-document-runtime";
import type { BoardChangeEvent } from "../shared/ipc-api";
import type { DocumentSyncCommandResult } from "../shared/block-documents";
import type { Card, CardSummary } from "../shared/types";
import type {
  CardMutationMetrics,
  CardMutationWorkerMessage,
  CardMutationWorkerRequest,
  CardMutationWorkerResponse,
  CardMutationWorkerResult,
} from "./card-mutation-worker-protocol";

const blockDocumentRuntime = new BlockDocumentRuntime(
  createSqliteBlockDocumentRuntimeAuthority(getDb),
);

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
    case "syncBlockDocument":
      return runDocumentCommand(() => blockDocumentRuntime.sync(request.payload));
    case "getBlockDocumentProjectId":
      return runDocumentCommand(() =>
        blockDocumentRuntime.getProjectId(request.payload.documentId),
      );
    case "applyBlockDocumentUpdate":
      return runDocumentCommand(() =>
        blockDocumentRuntime.applyUpdate(request.payload),
      );
    case "writerBarrier":
      return undefined;
    case "shutdown":
      blockDocumentRuntime.destroy();
      closeDatabase();
      return undefined;
  }
}

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
    const result = await runRequest(request);
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
