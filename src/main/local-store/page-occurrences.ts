import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { isUuidV7 } from "../../shared/uuid-v7";
import type {
  PageOccurrence,
  DatabasePage,
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
  RecurrenceConfig,
  ReminderConfig,
} from "../../shared/types";
import { AuthoritativeOperationReceiptError } from "./authoritative-operation-receipts";
import {
  cloneAuthoritativePageInTransaction,
  type AuthoritativePageClonePropertyOverrides,
} from "./authoritative-page-clone";
import {
  persistPageOccurrenceOperation,
  persistPageOccurrenceRejection,
  preparePageOccurrenceOperation,
  type PageOccurrenceMutationResult,
  type PreparedPageOccurrenceOperation,
} from "./page-occurrence-receipts";
import { readDatabasePageById } from "./page-read-store";
import { applyAuthoritativePageSchedulePatchInTransaction } from "./page-schedule-authority";
import { assertValidPageInput } from "./page-input-validation";
import { getDb } from "./database";
import { dbNotifier } from "./notifier";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";
import { requireProjectId } from "./projects";
import {
  nextOccurrenceAfter,
  shiftUntilDateByDays,
  type RecurrenceException,
} from "./recurrence";
import { listAuthoritativePageOccurrences } from "./scheduled-page-store";

interface DbRecurrenceException {
  readonly occurrence_start: string;
  readonly exception_type: "skip" | "override_time";
  readonly override_start: string | null;
  readonly override_end: string | null;
  readonly override_reminders_json: string | null;
}

interface OccurrenceClonePlacement {
  readonly primaryRankKey?: string;
}

interface OccurrenceAuthorityScope {
  readonly documentIds: readonly string[];
  readonly databaseBlockIds: readonly string[];
}

interface OccurrenceCreatedScope {
  readonly pageId: string;
  readonly documentId: string;
  readonly databaseBlockId: string;
}

type OccurrenceReceiptPreparation =
  | { readonly prepared: PreparedPageOccurrenceOperation }
  | { readonly failure: PageOccurrenceMutationResult };

type OccurrenceRejectionCode =
  | "page_not_found"
  | "page_not_scheduled"
  | "page_not_recurring"
  | "authorization_denied"
  | "invalid_occurrence_request";

interface PageOccurrenceTarget {
  readonly page: DatabasePage;
  /** Transitional relational projection coordinate, never access authority. */
  readonly contentProjectId: string;
}

const OCCURRENCE_UPDATE_SCOPES = new Set([
  "this",
  "this-and-future",
  "all",
]);

const OCCURRENCE_UPDATE_KEYS = new Set([
  "scheduledStart",
  "scheduledEnd",
  "isAllDay",
  "recurrence",
  "reminders",
  "scheduleTimezone",
]);

const parseReminders = (value: string): ReminderConfig[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ReminderConfig => (
      typeof item === "object"
      && item !== null
      && typeof (item as { readonly offsetMinutes?: unknown }).offsetMinutes === "number"
    ));
  } catch {
    return [];
  }
};

const dateKeyInTimezone = (date: Date, timezone?: string): string => {
  const resolved = timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

const dateKeyDayDelta = (fromDateKey: string, toDateKey: string): number => {
  const [fromYear, fromMonth, fromDay] = fromDateKey.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDateKey.split("-").map(Number);
  const fromUtc = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toUtc = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.floor((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
};

const shiftRecurringUntilDateWithDraggedDate = (
  recurrence: RecurrenceConfig | undefined,
  occurrenceStart: Date,
  nextStart: Date | undefined,
  timezone?: string,
): RecurrenceConfig | undefined => {
  if (!recurrence || !nextStart) return undefined;
  if (recurrence.endCondition?.type !== "untilDate") return undefined;

  const fromDateKey = dateKeyInTimezone(occurrenceStart, timezone);
  const toDateKey = dateKeyInTimezone(nextStart, timezone);
  const dayDelta = dateKeyDayDelta(fromDateKey, toDateKey);
  if (dayDelta === 0) return undefined;

  return {
    ...recurrence,
    endCondition: {
      type: "untilDate",
      untilDate: shiftUntilDateByDays(recurrence.endCondition.untilDate, dayDelta),
    },
  };
};

const queryRecurrenceExceptions = (
  database: Database.Database,
  projectId: string,
  pageId: string,
): RecurrenceException[] => {
  const rows = database.prepare(`
    SELECT occurrence_start,
           exception_type,
           override_start,
           override_end,
           override_reminders_json
    FROM recurrence_exceptions
    WHERE project_id = ? AND page_id = ?
  `).all(projectId, pageId) as DbRecurrenceException[];

  return rows.map((row) => ({
    occurrenceStart: new Date(row.occurrence_start),
    exceptionType: row.exception_type,
    overrideStart: row.override_start ? new Date(row.override_start) : undefined,
    overrideEnd: row.override_end ? new Date(row.override_end) : undefined,
    overrideReminders: row.override_reminders_json
      ? parseReminders(row.override_reminders_json)
      : undefined,
  }));
};

const upsertSkipRecurrenceException = (
  database: Database.Database,
  projectId: string,
  pageId: string,
  occurrenceStart: Date,
  nowIso: string,
): void => {
  database.prepare(`
    INSERT INTO recurrence_exceptions (
      project_id, page_id, occurrence_start, exception_type, created
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, page_id, occurrence_start)
    DO UPDATE SET
      exception_type = excluded.exception_type,
      override_start = NULL,
      override_end = NULL,
      override_reminders_json = NULL
  `).run(
    projectId,
    pageId,
    occurrenceStart.toISOString(),
    "skip",
    nowIso,
  );
};

const nextScheduleAfterOccurrence = (
  database: Database.Database,
  projectId: string,
  page: DatabasePage,
  occurrenceStart: Date,
): {
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
} | null => {
  if (!page.scheduledStart || !page.scheduledEnd) return null;
  const shouldAdvance = occurrenceStart.getTime() <= page.scheduledStart.getTime();
  if (!shouldAdvance) return null;
  if (!page.recurrence) return { scheduledStart: null, scheduledEnd: null };
  const exceptions = queryRecurrenceExceptions(database, projectId, page.id);
  const next = nextOccurrenceAfter(page, occurrenceStart, { exceptions });
  return {
    scheduledStart: next?.occurrenceStart ?? null,
    scheduledEnd: next?.occurrenceEnd ?? null,
  };
};

const prepareOccurrenceReceipt = (
  database: Database.Database,
  operationKind: "complete" | "skip" | "update",
  projectId: string,
  input:
    | PageOccurrenceActionInput
    | PageOccurrenceCompleteInput
    | PageOccurrenceUpdateInput,
  sessionId?: string,
): OccurrenceReceiptPreparation => {
  try {
    return {
      prepared: preparePageOccurrenceOperation(database, {
        operationKind,
        projectId,
        request: input,
        clientSessionId: sessionId,
      }),
    };
  } catch (error) {
    if (!(error instanceof AuthoritativeOperationReceiptError)) throw error;
    return {
      failure: {
        success: false,
        operationId: input.operationId ?? "invalid-operation",
        duplicate: false,
        code: error.code,
        error: error.message,
      },
    };
  }
};

const validateOccurrenceRequest = (
  operationKind: "complete" | "skip" | "update",
  input:
    | PageOccurrenceActionInput
    | PageOccurrenceCompleteInput
    | PageOccurrenceUpdateInput,
): string | null => {
  if (
    !(input.occurrenceStart instanceof Date) ||
    !Number.isFinite(input.occurrenceStart.getTime())
  ) {
    return "occurrenceStart must be a valid Date";
  }
  if (operationKind === "complete") {
    if (
      !("createdPageId" in input) ||
      typeof input.createdPageId !== "string" ||
      !isUuidV7(input.createdPageId)
    ) {
      return "createdPageId must be a canonical lowercase UUID-v7";
    }
    return null;
  }
  if (operationKind === "skip") return null;
  if (!("scope" in input) || !OCCURRENCE_UPDATE_SCOPES.has(input.scope)) {
    return "scope must be this, this-and-future, or all";
  }
  if (input.scope === "all" && "createdPageId" in input) {
    return "createdPageId must be omitted for scope all";
  }
  if (
    input.scope !== "all" &&
    (!("createdPageId" in input) || !isUuidV7(input.createdPageId))
  ) {
    return "createdPageId must be a canonical lowercase UUID-v7 for this scope";
  }
  if (
    typeof input.updates !== "object" ||
    input.updates === null ||
    Array.isArray(input.updates)
  ) {
    return "updates must be an object";
  }
  const updateKeys = Object.keys(input.updates);
  if (
    updateKeys.length === 0 ||
    updateKeys.every((key) => input.updates[key as keyof typeof input.updates] === undefined)
  ) {
    return "updates must contain a defined schedule field";
  }
  if (updateKeys.some((key) => !OCCURRENCE_UPDATE_KEYS.has(key))) {
    return "updates contains an unsupported schedule field";
  }
  try {
    assertValidPageInput(input.updates, "update");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
};

const rejectOccurrenceOperation = (
  database: Database.Database,
  prepared: Extract<PreparedPageOccurrenceOperation, { kind: "new" }>,
  pageId: string,
  code: OccurrenceRejectionCode,
  error: string,
): PageOccurrenceMutationResult => {
  const rejectedAt = new Date().toISOString();
  return database.transaction(() =>
    persistPageOccurrenceRejection(database, {
      prepared,
      pageId,
      code,
      error,
      rejectedAt,
    }),
  )();
};

const readOccurrenceAuthorityScope = (
  database: Database.Database,
  pageId: string,
): OccurrenceAuthorityScope => {
  const row = database.prepare(`
    SELECT ownership.document_id, membership.database_block_id
    FROM blocks page
    INNER JOIN block_documents ownership
      ON ownership.block_id = page.id
      AND ownership.project_id = page.project_id
    LEFT JOIN database_memberships membership
      ON membership.page_block_id = page.id
      AND membership.project_id = page.project_id
      AND membership.removed_at IS NULL
    WHERE page.id = ? AND page.type = 'page'
  `).get(pageId) as {
    readonly document_id: string;
    readonly database_block_id: string | null;
  } | undefined;
  if (!row) throw new Error(`Page ${pageId} has no authoritative Document`);
  return {
    documentIds: [row.document_id],
    databaseBlockIds: row.database_block_id
      ? [row.database_block_id]
      : [],
  };
};

const occurrenceNestedOperationId = (
  operationKind: string,
  operationId: string,
): string => {
  const digest = createHash("sha256").update(operationId).digest("hex");
  return `page-occurrence-${operationKind}:${digest}`;
};

const persistOccurrenceReceipt = (
  database: Database.Database,
  prepared: Extract<PreparedPageOccurrenceOperation, { kind: "new" }>,
  pageId: string,
  scope: OccurrenceAuthorityScope,
  committedAt: string,
  created?: OccurrenceCreatedScope,
): PageOccurrenceMutationResult =>
  persistPageOccurrenceOperation(database, {
    prepared,
    pageId,
    ...(created ? { createdPageId: created.pageId } : {}),
    documentIds: [
      ...scope.documentIds,
      ...(created ? [created.documentId] : []),
    ],
    databaseBlockIds: [
      ...scope.databaseBlockIds,
      ...(created ? [created.databaseBlockId] : []),
    ],
    fieldIntents: [
      {
        path: `blocks.${pageId}.occurrences`,
        operation: prepared.operationKind,
      },
      ...(created
        ? [{ path: `blocks.${created.pageId}`, operation: "create" }]
        : []),
    ],
    committedAt,
  });

const readOccurrenceClonePlacement = (
  database: Database.Database,
  projectId: string,
  pageId: string,
  newPageId: string,
): OccurrenceClonePlacement => {
  const row = database.prepare(`
    SELECT position.rank_key AS primary_rank_key
    FROM blocks page
    INNER JOIN database_memberships membership
      ON membership.page_block_id = page.id
      AND membership.project_id = page.project_id
      AND membership.removed_at IS NULL
      AND page.location_kind = 'database'
      AND page.containing_database_id = membership.database_block_id
    INNER JOIN database_views view
      ON view.database_block_id = membership.database_block_id
      AND view.project_id = membership.project_id
      AND view.is_primary = 1
      AND view.kind = 'kanban'
      AND view.lifecycle = 'active'
    LEFT JOIN database_view_positions position
      ON position.view_id = view.id
      AND position.block_id = page.id
      AND position.project_id = page.project_id
    WHERE page.id = ? AND page.project_id = ? AND page.type = 'page'
  `).get(pageId, projectId) as {
    readonly primary_rank_key: string | null;
  } | undefined;
  if (!row) throw new Error(`Page ${pageId} has no authoritative membership`);
  if (!row.primary_rank_key) return {};
  return { primaryRankKey: `${row.primary_rank_key}~${newPageId}` };
};

const normalizeOccurrenceTiming = (
  page: DatabasePage,
  occurrenceStart: Date,
  updates: PageOccurrenceUpdateInput["updates"],
): { start: Date; end: Date } => {
  const baseStart = updates.scheduledStart ?? occurrenceStart;
  const baseDurationMs = page.scheduledStart && page.scheduledEnd
    ? Math.max(60_000, page.scheduledEnd.getTime() - page.scheduledStart.getTime())
    : 15 * 60_000;
  const baseEnd = updates.scheduledEnd ?? new Date(baseStart.getTime() + baseDurationMs);
  if (baseEnd > baseStart) return { start: baseStart, end: baseEnd };
  return {
    start: baseStart,
    end: new Date(baseStart.getTime() + baseDurationMs),
  };
};

const readPageOccurrenceTarget = (
  database: Database.Database,
  projectId: string,
  pageId: string,
  requiresSiblingCreation: boolean,
): PageOccurrenceTarget | null => {
  const row = database.prepare(`
    SELECT block.project_id AS contentProjectId,
      page.parent_kind AS parentKind,
      page.parent_id AS parentId
    FROM blocks block
    INNER JOIN pages page ON page.block_id = block.id
    WHERE block.id = ? AND block.type = 'page'
      AND block.lifecycle <> 'deleted'
  `).get(pageId) as
    | {
        readonly contentProjectId: string;
        readonly parentKind: "library" | "page" | "data_source";
        readonly parentId: string;
      }
    | undefined;
  if (!row) return null;

  const pageAuthorization = authorizeProjectResourceInDatabase(database, {
    projectId,
    resource: { kind: "page", pageId },
    action: "write",
  });
  if (!pageAuthorization.allowed) {
    throw new Error(`authorization_denied:${pageAuthorization.reason}`);
  }
  if (requiresSiblingCreation) {
    if (row.parentKind !== "data_source") {
      throw new Error("authorization_denied:scheduled_page_has_no_data_source");
    }
    const createAuthorization = authorizeProjectResourceInDatabase(database, {
      projectId,
      resource: { kind: "data_source", dataSourceId: row.parentId },
      action: "create_child",
    });
    if (!createAuthorization.allowed) {
      throw new Error(`authorization_denied:${createAuthorization.reason}`);
    }
  }

  const page = readDatabasePageById(database, row.contentProjectId, pageId);
  return page ? { page, contentProjectId: row.contentProjectId } : null;
};

const readTargetOrReject = (
  database: Database.Database,
  prepared: Extract<PreparedPageOccurrenceOperation, { kind: "new" }>,
  projectId: string,
  pageId: string,
  requiresSiblingCreation: boolean,
): PageOccurrenceTarget | PageOccurrenceMutationResult => {
  try {
    const target = readPageOccurrenceTarget(
      database,
      projectId,
      pageId,
      requiresSiblingCreation,
    );
    if (target) return target;
    return rejectOccurrenceOperation(
      database,
      prepared,
      pageId,
      "page_not_found",
      "Page not found",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("authorization_denied:")) throw error;
    return rejectOccurrenceOperation(
      database,
      prepared,
      pageId,
      "authorization_denied",
      `Page occurrence mutation denied: ${message.slice("authorization_denied:".length)}`,
    );
  }
};

const isOccurrenceFailure = (
  value: PageOccurrenceTarget | PageOccurrenceMutationResult,
): value is PageOccurrenceMutationResult => "success" in value;

export async function listPageOccurrences(
  projectId: string,
  windowStart: Date,
  windowEnd: Date,
  searchQuery?: string,
): Promise<PageOccurrence[]> {
  return listAuthoritativePageOccurrences(getDb(), {
    projectId: requireProjectId(projectId),
    windowStart,
    windowEnd,
    searchQuery,
  });
}

export async function completePageOccurrence(
  projectId: string,
  input: PageOccurrenceCompleteInput,
  sessionId?: string,
): Promise<PageOccurrenceMutationResult> {
  projectId = requireProjectId(projectId);
  const database = getDb();
  const receipt = prepareOccurrenceReceipt(
    database,
    "complete",
    projectId,
    input,
    sessionId,
  );
  if ("failure" in receipt) return receipt.failure;
  if (receipt.prepared.kind === "replay") return receipt.prepared.result;
  const prepared = receipt.prepared;
  const invalidRequest = validateOccurrenceRequest("complete", input);
  if (invalidRequest) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.pageId,
      "invalid_occurrence_request",
      invalidRequest,
    );
  }
  const resolved = readTargetOrReject(
    database,
    prepared,
    projectId,
    input.pageId,
    true,
  );
  if (isOccurrenceFailure(resolved)) return resolved;
  const { page: target, contentProjectId } = resolved;
  if (!target.scheduledStart || !target.scheduledEnd) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.pageId,
      "page_not_scheduled",
      "Page is not scheduled",
    );
  }

  const durationMs = Math.max(
    60_000,
    target.scheduledEnd.getTime() - target.scheduledStart.getTime(),
  );
  const occurrenceStart = input.occurrenceStart;
  const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
  const shouldAdvance = occurrenceStart.getTime() <= target.scheduledStart.getTime();
  const nowIso = new Date().toISOString();
  const archivePageId = input.createdPageId;
  const sourceScope = readOccurrenceAuthorityScope(database, target.id);
  const cloneOverrides: AuthoritativePageClonePropertyOverrides = {
    database: {
      status: "done",
      scheduled_start: occurrenceStart.toISOString(),
      scheduled_end: occurrenceEnd.toISOString(),
    },
    intrinsic: {
      "schedule.isAllDay": Boolean(target.isAllDay),
      "schedule.timezone": target.scheduleTimezone ?? null,
      "recurrence.config": null,
      "reminders.config": [],
    },
  };

  const result = database.transaction(() => {
    const clone = cloneAuthoritativePageInTransaction(database, {
      projectId: contentProjectId,
      sourcePageId: target.id,
      newPageId: archivePageId,
      lifecycle: "archived",
      status: "done",
      primaryViewRankKey: `~archive:${nowIso}:${archivePageId}`,
      propertyOverrides: cloneOverrides,
      operationId: occurrenceNestedOperationId(
        "complete-clone",
        prepared.operationId,
      ),
      clientSessionId: sessionId,
      actor: { source: input.source, operation: "complete" },
      createdAt: nowIso,
    });

    if (target.recurrence && !shouldAdvance) {
      upsertSkipRecurrenceException(
        database,
        contentProjectId,
        input.pageId,
        occurrenceStart,
        nowIso,
      );
    }

    const nextSchedule = nextScheduleAfterOccurrence(
      database,
      contentProjectId,
      target,
      occurrenceStart,
    );
    if (nextSchedule) {
      applyAuthoritativePageSchedulePatchInTransaction(database, {
        projectId: contentProjectId,
        pageId: target.id,
        operationId: occurrenceNestedOperationId(
          "complete-advance",
          prepared.operationId,
        ),
        clientSessionId: sessionId,
        patch: nextSchedule,
      });
    }
    return persistOccurrenceReceipt(
      database,
      prepared,
      target.id,
      sourceScope,
      nowIso,
      {
        pageId: clone.pageId,
        documentId: clone.documentId,
        databaseBlockId: clone.databaseBlockId,
      },
    );
  })();

  dbNotifier.notifyChange(projectId, "update", target.status, input.pageId);
  dbNotifier.notifyChange(
    projectId,
    "create",
    "done",
    result.createdPageId ?? archivePageId,
  );
  return result;
}

export async function skipPageOccurrence(
  projectId: string,
  input: PageOccurrenceActionInput,
  sessionId?: string,
): Promise<PageOccurrenceMutationResult> {
  projectId = requireProjectId(projectId);
  const database = getDb();
  const receipt = prepareOccurrenceReceipt(
    database,
    "skip",
    projectId,
    input,
    sessionId,
  );
  if ("failure" in receipt) return receipt.failure;
  if (receipt.prepared.kind === "replay") return receipt.prepared.result;
  const prepared = receipt.prepared;
  const invalidRequest = validateOccurrenceRequest("skip", input);
  if (invalidRequest) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.pageId,
      "invalid_occurrence_request",
      invalidRequest,
    );
  }
  const resolved = readTargetOrReject(
    database,
    prepared,
    projectId,
    input.pageId,
    false,
  );
  if (isOccurrenceFailure(resolved)) return resolved;
  const { page: target, contentProjectId } = resolved;
  if (!target.scheduledStart || !target.scheduledEnd) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.pageId,
      "page_not_scheduled",
      "Page is not scheduled",
    );
  }

  const occurrenceStart = input.occurrenceStart;
  const nowIso = new Date().toISOString();
  const sourceScope = readOccurrenceAuthorityScope(database, target.id);

  const result = database.transaction(() => {
    if (target.recurrence) {
      upsertSkipRecurrenceException(
        database,
        contentProjectId,
        input.pageId,
        occurrenceStart,
        nowIso,
      );
    }
    const nextSchedule = nextScheduleAfterOccurrence(
      database,
      contentProjectId,
      target,
      occurrenceStart,
    );
    if (nextSchedule) {
      applyAuthoritativePageSchedulePatchInTransaction(database, {
        projectId: contentProjectId,
        pageId: target.id,
        operationId: occurrenceNestedOperationId(
          "skip-advance",
          prepared.operationId,
        ),
        clientSessionId: sessionId,
        patch: nextSchedule,
      });
    }
    return persistOccurrenceReceipt(
      database,
      prepared,
      target.id,
      sourceScope,
      nowIso,
    );
  })();

  dbNotifier.notifyChange(projectId, "update", target.status, input.pageId);
  return result;
}

export async function updatePageOccurrence(
  projectId: string,
  input: PageOccurrenceUpdateInput,
  sessionId?: string,
): Promise<PageOccurrenceMutationResult> {
  projectId = requireProjectId(projectId);
  const database = getDb();
  const receipt = prepareOccurrenceReceipt(
    database,
    "update",
    projectId,
    input,
    sessionId,
  );
  if ("failure" in receipt) return receipt.failure;
  if (receipt.prepared.kind === "replay") return receipt.prepared.result;
  const prepared = receipt.prepared;
  const invalidRequest = validateOccurrenceRequest("update", input);
  if (invalidRequest) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.pageId,
      "invalid_occurrence_request",
      invalidRequest,
    );
  }
  const resolved = readTargetOrReject(
    database,
    prepared,
    projectId,
    input.pageId,
    false,
  );
  if (isOccurrenceFailure(resolved)) return resolved;
  const { page: target, contentProjectId } = resolved;
  if (target.recurrence && input.scope !== "all") {
    const structural = readTargetOrReject(
      database,
      prepared,
      projectId,
      input.pageId,
      true,
    );
    if (isOccurrenceFailure(structural)) return structural;
  }
  const nowIso = new Date().toISOString();
  const sourceScope = readOccurrenceAuthorityScope(database, target.id);
  const dragShiftRecurrence = shiftRecurringUntilDateWithDraggedDate(
    target.recurrence,
    input.occurrenceStart,
    input.updates.scheduledStart,
    input.updates.scheduleTimezone ?? target.scheduleTimezone,
  );

  if (input.scope === "all") {
    const result = database.transaction(() => {
      applyAuthoritativePageSchedulePatchInTransaction(database, {
        projectId: contentProjectId,
        pageId: target.id,
        operationId: occurrenceNestedOperationId("update-all", prepared.operationId),
        clientSessionId: sessionId,
        patch: {
          scheduledStart: input.updates.scheduledStart,
          scheduledEnd: input.updates.scheduledEnd,
          isAllDay: input.updates.isAllDay,
          recurrence: input.updates.recurrence === undefined
            ? dragShiftRecurrence
            : (input.updates.recurrence ?? null),
          reminders: input.updates.reminders,
          scheduleTimezone: input.updates.scheduleTimezone,
        },
      });
      return persistOccurrenceReceipt(
        database,
        prepared,
        target.id,
        sourceScope,
        nowIso,
      );
    })();
    dbNotifier.notifyChange(projectId, "update", target.status, target.id);
    return result;
  }

  if (input.scope === "this") {
    if (!target.recurrence) {
      const result = database.transaction(() => {
        applyAuthoritativePageSchedulePatchInTransaction(database, {
          projectId: contentProjectId,
          pageId: target.id,
          operationId: occurrenceNestedOperationId(
            "update-one-time",
            prepared.operationId,
          ),
          clientSessionId: sessionId,
          patch: {
            scheduledStart: input.updates.scheduledStart,
            scheduledEnd: input.updates.scheduledEnd,
            isAllDay: input.updates.isAllDay,
            reminders: input.updates.reminders,
            scheduleTimezone: input.updates.scheduleTimezone,
          },
        });
        return persistOccurrenceReceipt(
          database,
          prepared,
          target.id,
          sourceScope,
          nowIso,
        );
      })();
      dbNotifier.notifyChange(projectId, "update", target.status, target.id);
      return result;
    }

    const timing = normalizeOccurrenceTiming(
      target,
      input.occurrenceStart,
      input.updates,
    );
    const detachedPageId = input.createdPageId;
    const detachedReminders = input.updates.reminders ?? target.reminders ?? [];
    const detachedTimezone = input.updates.scheduleTimezone === undefined
      ? target.scheduleTimezone
      : (input.updates.scheduleTimezone ?? undefined);
    const placement = readOccurrenceClonePlacement(
      database,
      contentProjectId,
      target.id,
      detachedPageId,
    );

    const result = database.transaction(() => {
      const clone = cloneAuthoritativePageInTransaction(database, {
        projectId: contentProjectId,
        sourcePageId: target.id,
        newPageId: detachedPageId,
        lifecycle: "active",
        status: target.status,
        ...(placement.primaryRankKey
          ? { primaryViewRankKey: placement.primaryRankKey }
          : {}),
        propertyOverrides: {
          database: {
            status: target.status,
            scheduled_start: timing.start.toISOString(),
            scheduled_end: timing.end.toISOString(),
          },
          intrinsic: {
            "schedule.isAllDay": input.updates.isAllDay ?? Boolean(target.isAllDay),
            "schedule.timezone": detachedTimezone ?? null,
            "recurrence.config": null,
            "reminders.config": detachedReminders,
          },
        },
        operationId: occurrenceNestedOperationId(
          "detach-clone",
          prepared.operationId,
        ),
        clientSessionId: sessionId,
        actor: { source: input.source, operation: "update-this" },
        createdAt: nowIso,
      });

      upsertSkipRecurrenceException(
        database,
        contentProjectId,
        input.pageId,
        input.occurrenceStart,
        nowIso,
      );
      return persistOccurrenceReceipt(
        database,
        prepared,
        target.id,
        sourceScope,
        nowIso,
        {
          pageId: clone.pageId,
          documentId: clone.documentId,
          databaseBlockId: clone.databaseBlockId,
        },
      );
    })();

    dbNotifier.notifyChange(projectId, "update", target.status, input.pageId);
    dbNotifier.notifyChange(projectId, "create", target.status, detachedPageId);
    return result;
  }

  if (!target.recurrence) {
    const result = database.transaction(() => {
      applyAuthoritativePageSchedulePatchInTransaction(database, {
        projectId: contentProjectId,
        pageId: target.id,
        operationId: occurrenceNestedOperationId(
          "update-nonrecurring",
          prepared.operationId,
        ),
        clientSessionId: sessionId,
        patch: {
          scheduledStart: input.updates.scheduledStart,
          scheduledEnd: input.updates.scheduledEnd,
          isAllDay: input.updates.isAllDay,
          reminders: input.updates.reminders,
          scheduleTimezone: input.updates.scheduleTimezone,
        },
      });
      return persistOccurrenceReceipt(
        database,
        prepared,
        target.id,
        sourceScope,
        nowIso,
      );
    })();
    dbNotifier.notifyChange(projectId, "update", target.status, target.id);
    return result;
  }

  const oldScheduledStart = target.scheduledStart;
  const isEquivalentToAll = oldScheduledStart !== undefined &&
    input.occurrenceStart.getTime() <= oldScheduledStart.getTime();
  if (isEquivalentToAll) {
    const result = database.transaction(() => {
      applyAuthoritativePageSchedulePatchInTransaction(database, {
        projectId: contentProjectId,
        pageId: target.id,
        operationId: occurrenceNestedOperationId(
          "update-equivalent-all",
          prepared.operationId,
        ),
        clientSessionId: sessionId,
        patch: {
          scheduledStart: input.updates.scheduledStart,
          scheduledEnd: input.updates.scheduledEnd,
          isAllDay: input.updates.isAllDay,
          recurrence: input.updates.recurrence === undefined
            ? dragShiftRecurrence
            : (input.updates.recurrence ?? null),
          reminders: input.updates.reminders,
          scheduleTimezone: input.updates.scheduleTimezone,
        },
      });
      return persistOccurrenceReceipt(
        database,
        prepared,
        target.id,
        sourceScope,
        nowIso,
      );
    })();
    dbNotifier.notifyChange(projectId, "update", target.status, target.id);
    return result;
  }

  const timezone = target.scheduleTimezone ?? input.updates.scheduleTimezone ?? undefined;
  const occurrenceDateKey = dateKeyInTimezone(input.occurrenceStart, timezone);
  const endedRecurrence: RecurrenceConfig = {
    ...target.recurrence,
    endCondition: {
      type: "untilDate",
      untilDate: shiftUntilDateByDays(occurrenceDateKey, -1),
    },
  };
  const splitTiming = normalizeOccurrenceTiming(
    target,
    input.occurrenceStart,
    input.updates,
  );
  const nextPageId = input.createdPageId;
  const nextReminders = input.updates.reminders ?? target.reminders ?? [];
  const nextTimezone = input.updates.scheduleTimezone === undefined
    ? target.scheduleTimezone
    : (input.updates.scheduleTimezone ?? undefined);
  const shiftedFutureRecurrence = shiftRecurringUntilDateWithDraggedDate(
    target.recurrence,
    input.occurrenceStart,
    splitTiming.start,
    nextTimezone,
  );
  const nextRecurrence = input.updates.recurrence === undefined
    ? (shiftedFutureRecurrence ?? target.recurrence)
    : (input.updates.recurrence ?? undefined);
  const placement = readOccurrenceClonePlacement(
    database,
    contentProjectId,
    target.id,
    nextPageId,
  );

  const result = database.transaction(() => {
    const clone = cloneAuthoritativePageInTransaction(database, {
      projectId: contentProjectId,
      sourcePageId: target.id,
      newPageId: nextPageId,
      lifecycle: "active",
      status: target.status,
      ...(placement.primaryRankKey
        ? { primaryViewRankKey: placement.primaryRankKey }
        : {}),
      propertyOverrides: {
        database: {
          status: target.status,
          scheduled_start: splitTiming.start.toISOString(),
          scheduled_end: splitTiming.end.toISOString(),
        },
        intrinsic: {
          "schedule.isAllDay": input.updates.isAllDay ?? Boolean(target.isAllDay),
          "schedule.timezone": nextTimezone ?? null,
          "recurrence.config": nextRecurrence ?? null,
          "reminders.config": nextReminders,
        },
      },
      operationId: occurrenceNestedOperationId(
        "split-clone",
        prepared.operationId,
      ),
      clientSessionId: sessionId,
      actor: { source: input.source, operation: "update-this-and-future" },
      createdAt: nowIso,
    });
    applyAuthoritativePageSchedulePatchInTransaction(database, {
      projectId: contentProjectId,
      pageId: target.id,
      operationId: occurrenceNestedOperationId(
        "split-source",
        prepared.operationId,
      ),
      clientSessionId: sessionId,
      patch: { recurrence: endedRecurrence },
    });
    return persistOccurrenceReceipt(
      database,
      prepared,
      target.id,
      sourceScope,
      nowIso,
      {
        pageId: clone.pageId,
        documentId: clone.documentId,
        databaseBlockId: clone.databaseBlockId,
      },
    );
  })();

  dbNotifier.notifyChange(projectId, "update", target.status, input.pageId);
  dbNotifier.notifyChange(projectId, "create", target.status, nextPageId);
  return result;
}
