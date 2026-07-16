import type Database from "better-sqlite3";
import type {
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
} from "../../shared/types";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationRejection,
  persistAuthoritativeOperationReceipt,
  prepareAuthoritativeOperation,
  type AuthoritativeOperationEvidence,
} from "./authoritative-operation-receipts";

export type PageOccurrenceOperationKind = "complete" | "skip" | "update";

export interface PageOccurrenceMutationResult {
  readonly success: boolean;
  readonly operationId: string;
  readonly duplicate: boolean;
  readonly changeLogSeq?: number;
  readonly createdPageId?: string;
  readonly code?:
    | "operation_id_collision"
    | "operation_receipt_corrupt"
    | "page_not_found"
    | "page_not_scheduled"
    | "page_not_recurring"
    | "authorization_denied"
    | "invalid_occurrence_request";
  readonly error?: string;
}

export type PreparedPageOccurrenceOperation =
  | {
      readonly kind: "new";
      readonly operationKind: PageOccurrenceOperationKind;
      readonly operationId: string;
      readonly evidence: AuthoritativeOperationEvidence;
    }
  | {
      readonly kind: "replay";
      readonly operationKind: PageOccurrenceOperationKind;
      readonly operationId: string;
      readonly result: PageOccurrenceMutationResult;
    };

export interface PersistPageOccurrenceOperation {
  readonly prepared: Extract<PreparedPageOccurrenceOperation, { kind: "new" }>;
  readonly pageId: string;
  readonly createdPageId?: string;
  readonly documentIds: readonly string[];
  readonly databaseBlockIds: readonly string[];
  readonly fieldIntents: readonly Readonly<{
    readonly path: string;
    readonly operation: string;
  }>[];
  readonly committedAt: string;
}

export interface PersistPageOccurrenceRejection {
  readonly prepared: Extract<PreparedPageOccurrenceOperation, { kind: "new" }>;
  readonly pageId: string;
  readonly code: Exclude<
    NonNullable<PageOccurrenceMutationResult["code"]>,
    "operation_id_collision" | "operation_receipt_corrupt"
  >;
  readonly error: string;
  readonly rejectedAt: string;
}

const REJECTION_CODES = new Set([
  "page_not_found",
  "page_not_scheduled",
  "page_not_recurring",
  "authorization_denied",
  "invalid_occurrence_request",
]);

const parseStoredResult = (value: unknown): PageOccurrenceMutationResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Stored Page occurrence result is not an object");
  }
  const result = value as Partial<PageOccurrenceMutationResult>;
  if (
    typeof result.success !== "boolean" ||
    result.duplicate !== false ||
    typeof result.operationId !== "string" ||
    (result.createdPageId !== undefined &&
      typeof result.createdPageId !== "string")
  ) {
    throw new TypeError("Stored Page occurrence result is corrupt");
  }
  if (
    (result.success && typeof result.changeLogSeq !== "number") ||
    (!result.success &&
      (result.changeLogSeq !== undefined ||
        typeof result.code !== "string" ||
        !REJECTION_CODES.has(result.code) ||
        typeof result.error !== "string"))
  ) {
    throw new TypeError("Stored Page occurrence outcome is corrupt");
  }
  return result as PageOccurrenceMutationResult;
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
  input: PageOccurrenceUpdateInput,
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

export const preparePageOccurrenceOperation = (
  database: Database.Database,
  input: {
    readonly operationKind: PageOccurrenceOperationKind;
    readonly projectId: string;
    readonly request:
      | PageOccurrenceActionInput
      | PageOccurrenceCompleteInput
      | PageOccurrenceUpdateInput;
    readonly clientSessionId?: string;
  },
): PreparedPageOccurrenceOperation => {
  const operationId = input.request.operationId;
  const logicalRequest = {
    version: 1,
    operation: `page_occurrence_${input.operationKind}`,
    projectId: input.projectId,
    pageId: input.request.pageId,
    occurrenceStart: canonicalDate(input.request.occurrenceStart),
    ...("createdPageId" in input.request
      ? { createdPageId: input.request.createdPageId }
      : {}),
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
      mutationKind: `page_occurrence_${input.operationKind}`,
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

export const persistPageOccurrenceOperation = (
  database: Database.Database,
  input: PersistPageOccurrenceOperation,
): PageOccurrenceMutationResult => {
  const committed = persistAuthoritativeOperationReceipt(database, {
    evidence: input.prepared.evidence,
    targetBlockIds: [
      input.pageId,
      ...(input.createdPageId ? [input.createdPageId] : []),
    ],
    affectedDocumentIds: input.documentIds,
    affectedDatabaseBlockIds: input.databaseBlockIds,
    fieldIntents: input.fieldIntents,
    changePayload: {
      operation: input.prepared.operationKind,
      pageId: input.pageId,
      ...(input.createdPageId ? { createdPageId: input.createdPageId } : {}),
    },
    committedAt: input.committedAt,
    makeResult: (changeLogSeq): PageOccurrenceMutationResult => ({
      success: true,
      operationId: input.prepared.operationId,
      duplicate: false,
      changeLogSeq,
      ...(input.createdPageId ? { createdPageId: input.createdPageId } : {}),
    }),
  });
  return committed.result;
};

export const persistPageOccurrenceRejection = (
  database: Database.Database,
  input: PersistPageOccurrenceRejection,
): PageOccurrenceMutationResult => {
  const result: PageOccurrenceMutationResult = {
    success: false,
    operationId: input.prepared.operationId,
    duplicate: false,
    code: input.code,
    error: input.error,
  };
  return persistAuthoritativeOperationRejection(database, {
    evidence: input.prepared.evidence,
    targetBlockIds: [input.pageId],
    fieldIntents: [
      {
        path: `blocks.${input.pageId}.occurrences`,
        operation: input.prepared.operationKind,
      },
    ],
    rejectedAt: input.rejectedAt,
    result,
  });
};
