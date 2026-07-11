import type Database from "better-sqlite3";
import type {
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
} from "../../shared/types";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationRejection,
  persistAuthoritativeOperationReceipt,
  prepareAuthoritativeOperation,
  type AuthoritativeOperationEvidence,
} from "./authoritative-operation-receipts";

export type CardOccurrenceOperationKind = "complete" | "skip" | "update";

export interface CardOccurrenceMutationResult {
  readonly success: boolean;
  readonly operationId: string;
  readonly duplicate: boolean;
  readonly changeLogSeq?: number;
  readonly createdCardId?: string;
  readonly code?:
    | "operation_id_collision"
    | "operation_receipt_corrupt"
    | "card_not_found"
    | "card_not_scheduled"
    | "card_not_recurring"
    | "invalid_occurrence_request";
  readonly error?: string;
}

export type PreparedCardOccurrenceOperation =
  | {
      readonly kind: "new";
      readonly operationKind: CardOccurrenceOperationKind;
      readonly operationId: string;
      readonly evidence: AuthoritativeOperationEvidence;
    }
  | {
      readonly kind: "replay";
      readonly operationKind: CardOccurrenceOperationKind;
      readonly operationId: string;
      readonly result: CardOccurrenceMutationResult;
    };

export interface PersistCardOccurrenceOperation {
  readonly prepared: Extract<PreparedCardOccurrenceOperation, { kind: "new" }>;
  readonly cardId: string;
  readonly createdCardId?: string;
  readonly documentIds: readonly string[];
  readonly databaseBlockIds: readonly string[];
  readonly fieldIntents: readonly Readonly<{
    readonly path: string;
    readonly operation: string;
  }>[];
  readonly committedAt: string;
}

export interface PersistCardOccurrenceRejection {
  readonly prepared: Extract<PreparedCardOccurrenceOperation, { kind: "new" }>;
  readonly cardId: string;
  readonly code: Exclude<
    NonNullable<CardOccurrenceMutationResult["code"]>,
    "operation_id_collision" | "operation_receipt_corrupt"
  >;
  readonly error: string;
  readonly rejectedAt: string;
}

const REJECTION_CODES = new Set([
  "card_not_found",
  "card_not_scheduled",
  "card_not_recurring",
  "invalid_occurrence_request",
]);

const parseStoredResult = (value: unknown): CardOccurrenceMutationResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Stored Card occurrence result is not an object");
  }
  const result = value as Partial<CardOccurrenceMutationResult>;
  if (
    typeof result.success !== "boolean" ||
    result.duplicate !== false ||
    typeof result.operationId !== "string" ||
    (result.createdCardId !== undefined &&
      typeof result.createdCardId !== "string")
  ) {
    throw new TypeError("Stored Card occurrence result is corrupt");
  }
  if (
    (result.success && typeof result.changeLogSeq !== "number") ||
    (!result.success &&
      (result.changeLogSeq !== undefined ||
        typeof result.code !== "string" ||
        !REJECTION_CODES.has(result.code) ||
        typeof result.error !== "string"))
  ) {
    throw new TypeError("Stored Card occurrence outcome is corrupt");
  }
  return result as CardOccurrenceMutationResult;
};

const canonicalDate = (value: unknown): unknown => {
  if (!(value instanceof Date)) return value;
  if (!Number.isFinite(value.getTime())) return { invalidDate: true };
  return value.toISOString();
};

const canonicalUpdateValue = (value: unknown): unknown => {
  if (value === undefined) return { undefined: true };
  return canonicalDate(value);
};

const canonicalUpdates = (
  input: CardOccurrenceUpdateInput,
): Readonly<Record<string, unknown>> => {
  const candidate = input.updates as unknown;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return { invalidUpdates: candidate };
  }
  const updates = candidate as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [
      key,
      canonicalUpdateValue(value),
    ]),
  );
};

export const prepareCardOccurrenceOperation = (
  database: Database.Database,
  input: {
    readonly operationKind: CardOccurrenceOperationKind;
    readonly projectId: string;
    readonly request: CardOccurrenceActionInput | CardOccurrenceUpdateInput;
    readonly clientSessionId?: string;
  },
): PreparedCardOccurrenceOperation => {
  const operationId = input.request.operationId;
  const logicalRequest = {
    version: 1,
    operation: `card_occurrence_${input.operationKind}`,
    projectId: input.projectId,
    cardId: input.request.cardId,
    occurrenceStart: canonicalDate(input.request.occurrenceStart),
    ...(input.operationKind === "update" && "scope" in input.request
      ? {
          scope: input.request.scope,
          updates: canonicalUpdates(input.request),
        }
      : {}),
  };
  const prepared = prepareAuthoritativeOperation(
    database,
    {
      operationId,
      projectId: input.projectId,
      mutationKind: `card_occurrence_${input.operationKind}`,
      logicalRequest,
      // Source is attribution, not logical intent. Exact retries through a
      // different transport retain this first-seen actor in the ledger.
      actor: { source: input.request.source },
      clientSessionId: input.clientSessionId,
    },
    parseStoredResult,
  );
  if (prepared.kind === "replay") {
    if (
      prepared.result.operationId !== operationId ||
      (prepared.outcome === "committed" &&
        (!prepared.result.success ||
          prepared.result.changeLogSeq !== prepared.changeLogSeq)) ||
      (prepared.outcome === "rejected" && prepared.result.success)
    ) {
      throw new AuthoritativeOperationReceiptError(
        "operation_receipt_corrupt",
        `Operation ${operationId} stored a divergent result identity`,
      );
    }
    return {
      kind: "replay",
      operationKind: input.operationKind,
      operationId,
      result: { ...prepared.result, duplicate: true },
    };
  }
  return {
    kind: "new",
    operationKind: input.operationKind,
    operationId,
    evidence: prepared.evidence,
  };
};

export const persistCardOccurrenceOperation = (
  database: Database.Database,
  input: PersistCardOccurrenceOperation,
): CardOccurrenceMutationResult => {
  const committed = persistAuthoritativeOperationReceipt(database, {
    evidence: input.prepared.evidence,
    targetBlockIds: [
      input.cardId,
      ...(input.createdCardId ? [input.createdCardId] : []),
    ],
    affectedDocumentIds: input.documentIds,
    affectedDatabaseBlockIds: input.databaseBlockIds,
    fieldIntents: input.fieldIntents,
    changePayload: {
      operation: input.prepared.operationKind,
      cardId: input.cardId,
      ...(input.createdCardId ? { createdCardId: input.createdCardId } : {}),
    },
    committedAt: input.committedAt,
    makeResult: (changeLogSeq): CardOccurrenceMutationResult => ({
      success: true,
      operationId: input.prepared.operationId,
      duplicate: false,
      changeLogSeq,
      ...(input.createdCardId ? { createdCardId: input.createdCardId } : {}),
    }),
  });
  return committed.result;
};

export const persistCardOccurrenceRejection = (
  database: Database.Database,
  input: PersistCardOccurrenceRejection,
): CardOccurrenceMutationResult => {
  const result: CardOccurrenceMutationResult = {
    success: false,
    operationId: input.prepared.operationId,
    duplicate: false,
    code: input.code,
    error: input.error,
  };
  return persistAuthoritativeOperationRejection(database, {
    evidence: input.prepared.evidence,
    targetBlockIds: [input.cardId],
    fieldIntents: [
      {
        path: `cards.${input.cardId}.occurrences`,
        operation: input.prepared.operationKind,
      },
    ],
    rejectedAt: input.rejectedAt,
    result,
  });
};
