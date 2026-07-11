import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createUuidV7FromTimestamp } from "../../shared/card-id";
import type {
  CalendarOccurrence,
  Card,
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
  RecurrenceConfig,
  ReminderConfig,
} from "../../shared/types";
import { AuthoritativeOperationReceiptError } from "./authoritative-operation-receipts";
import {
  cloneAuthoritativeCardInTransaction,
  type AuthoritativeCardClonePropertyOverrides,
} from "./authoritative-card-clone";
import {
  persistCardOccurrenceOperation,
  persistCardOccurrenceRejection,
  prepareCardOccurrenceOperation,
  type CardOccurrenceMutationResult,
  type PreparedCardOccurrenceOperation,
} from "./card-occurrence-receipts";
import { readAuthoritativeCardById } from "./card-read-store";
import { applyAuthoritativeCardSchedulePatchInTransaction } from "./card-schedule-authority";
import { assertValidCardInput } from "./card-input-validation";
import { getDb } from "./database";
import { dbNotifier } from "./notifier";
import { requireProjectId } from "./projects";
import {
  nextOccurrenceAfter,
  shiftUntilDateByDays,
  type RecurrenceException,
} from "./recurrence";
import { listAuthoritativeCalendarOccurrences } from "./scheduled-card-store";

interface DbRecurrenceException {
  readonly occurrence_start: string;
  readonly exception_type: "skip" | "override_time";
  readonly override_start: string | null;
  readonly override_end: string | null;
  readonly override_reminders_json: string | null;
}

interface OccurrenceClonePlacement {
  readonly primaryRankKey: string;
  readonly topLevelRankKey: string;
}

interface OccurrenceAuthorityScope {
  readonly documentIds: readonly string[];
  readonly databaseBlockIds: readonly string[];
}

interface OccurrenceCreatedScope {
  readonly cardId: string;
  readonly documentId: string;
  readonly databaseBlockId: string;
}

type OccurrenceReceiptPreparation =
  | { readonly prepared: PreparedCardOccurrenceOperation }
  | { readonly failure: CardOccurrenceMutationResult };

type OccurrenceRejectionCode =
  | "card_not_found"
  | "card_not_scheduled"
  | "card_not_recurring"
  | "invalid_occurrence_request";

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
  cardId: string,
): RecurrenceException[] => {
  const rows = database.prepare(`
    SELECT occurrence_start,
           exception_type,
           override_start,
           override_end,
           override_reminders_json
    FROM recurrence_exceptions
    WHERE project_id = ? AND card_id = ?
  `).all(projectId, cardId) as DbRecurrenceException[];

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
  cardId: string,
  occurrenceStart: Date,
  nowIso: string,
): void => {
  database.prepare(`
    INSERT INTO recurrence_exceptions (
      project_id, card_id, occurrence_start, exception_type, created
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, card_id, occurrence_start)
    DO UPDATE SET
      exception_type = excluded.exception_type,
      override_start = NULL,
      override_end = NULL,
      override_reminders_json = NULL
  `).run(
    projectId,
    cardId,
    occurrenceStart.toISOString(),
    "skip",
    nowIso,
  );
};

const nextScheduleAfterOccurrence = (
  database: Database.Database,
  projectId: string,
  card: Card,
  occurrenceStart: Date,
): {
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
} | null => {
  if (!card.scheduledStart || !card.scheduledEnd) return null;
  const shouldAdvance = occurrenceStart.getTime() <= card.scheduledStart.getTime();
  if (!shouldAdvance) return null;
  if (!card.recurrence) return { scheduledStart: null, scheduledEnd: null };
  const exceptions = queryRecurrenceExceptions(database, projectId, card.id);
  const next = nextOccurrenceAfter(card, occurrenceStart, { exceptions });
  return {
    scheduledStart: next?.occurrenceStart ?? null,
    scheduledEnd: next?.occurrenceEnd ?? null,
  };
};

const prepareOccurrenceReceipt = (
  database: Database.Database,
  operationKind: "complete" | "skip" | "update",
  projectId: string,
  input: CardOccurrenceActionInput | CardOccurrenceUpdateInput,
  sessionId?: string,
): OccurrenceReceiptPreparation => {
  try {
    return {
      prepared: prepareCardOccurrenceOperation(database, {
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
  input: CardOccurrenceActionInput | CardOccurrenceUpdateInput,
): string | null => {
  if (
    !(input.occurrenceStart instanceof Date) ||
    !Number.isFinite(input.occurrenceStart.getTime())
  ) {
    return "occurrenceStart must be a valid Date";
  }
  if (operationKind !== "update") return null;
  if (!("scope" in input) || !OCCURRENCE_UPDATE_SCOPES.has(input.scope)) {
    return "scope must be this, this-and-future, or all";
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
    assertValidCardInput(input.updates, "update");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
};

const rejectOccurrenceOperation = (
  database: Database.Database,
  prepared: Extract<PreparedCardOccurrenceOperation, { kind: "new" }>,
  cardId: string,
  code: OccurrenceRejectionCode,
  error: string,
): CardOccurrenceMutationResult => {
  const rejectedAt = new Date().toISOString();
  return database.transaction(() =>
    persistCardOccurrenceRejection(database, {
      prepared,
      cardId,
      code,
      error,
      rejectedAt,
    }),
  )();
};

const readOccurrenceAuthorityScope = (
  database: Database.Database,
  projectId: string,
  cardId: string,
): OccurrenceAuthorityScope => {
  const row = database.prepare(`
    SELECT ownership.document_id, membership.database_block_id
    FROM blocks card
    INNER JOIN block_documents ownership
      ON ownership.block_id = card.id
      AND ownership.project_id = card.project_id
    LEFT JOIN database_memberships membership
      ON membership.card_block_id = card.id
      AND membership.project_id = card.project_id
      AND membership.removed_at IS NULL
    WHERE card.id = ? AND card.project_id = ? AND card.type = 'card'
  `).get(cardId, projectId) as {
    readonly document_id: string;
    readonly database_block_id: string | null;
  } | undefined;
  if (!row) throw new Error(`Card ${cardId} has no authoritative Document`);
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
  return `card-occurrence-${operationKind}:${digest}`;
};

const deriveOccurrenceCardId = (
  operationKind: string,
  operationId: string,
  occurrenceStart: Date,
): string => {
  const digest = createHash("sha256")
    .update(operationKind)
    .update("\0")
    .update(operationId)
    .digest();
  return createUuidV7FromTimestamp(
    occurrenceStart.getTime(),
    digest.readUInt32BE(0),
    digest,
  );
};

const persistOccurrenceReceipt = (
  database: Database.Database,
  prepared: Extract<PreparedCardOccurrenceOperation, { kind: "new" }>,
  cardId: string,
  scope: OccurrenceAuthorityScope,
  committedAt: string,
  created?: OccurrenceCreatedScope,
): CardOccurrenceMutationResult =>
  persistCardOccurrenceOperation(database, {
    prepared,
    cardId,
    ...(created ? { createdCardId: created.cardId } : {}),
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
        path: `blocks.${cardId}.occurrences`,
        operation: prepared.operationKind,
      },
      ...(created
        ? [{ path: `blocks.${created.cardId}`, operation: "create" }]
        : []),
    ],
    committedAt,
  });

const readOccurrenceClonePlacement = (
  database: Database.Database,
  projectId: string,
  cardId: string,
  newCardId: string,
): OccurrenceClonePlacement => {
  const row = database.prepare(`
    SELECT position.rank_key AS primary_rank_key,
           placement.rank_key AS top_level_rank_key
    FROM blocks card
    INNER JOIN database_memberships membership
      ON membership.card_block_id = card.id
      AND membership.project_id = card.project_id
      AND membership.removed_at IS NULL
    INNER JOIN database_views view
      ON view.database_block_id = membership.database_block_id
      AND view.project_id = membership.project_id
      AND view.is_primary = 1
    INNER JOIN database_view_positions position
      ON position.view_id = view.id
      AND position.block_id = card.id
      AND position.project_id = card.project_id
    INNER JOIN top_level_block_placements placement
      ON placement.block_id = card.id
      AND placement.project_id = card.project_id
    WHERE card.id = ? AND card.project_id = ? AND card.type = 'card'
  `).get(cardId, projectId) as {
    readonly primary_rank_key: string;
    readonly top_level_rank_key: string;
  } | undefined;
  if (!row) throw new Error(`Card ${cardId} has no authoritative placement`);
  return {
    primaryRankKey: `${row.primary_rank_key}~${newCardId}`,
    topLevelRankKey: `${row.top_level_rank_key}~${newCardId}`,
  };
};

const normalizeOccurrenceTiming = (
  card: Card,
  occurrenceStart: Date,
  updates: CardOccurrenceUpdateInput["updates"],
): { start: Date; end: Date } => {
  const baseStart = updates.scheduledStart ?? occurrenceStart;
  const baseDurationMs = card.scheduledStart && card.scheduledEnd
    ? Math.max(60_000, card.scheduledEnd.getTime() - card.scheduledStart.getTime())
    : 15 * 60_000;
  const baseEnd = updates.scheduledEnd ?? new Date(baseStart.getTime() + baseDurationMs);
  if (baseEnd > baseStart) return { start: baseStart, end: baseEnd };
  return {
    start: baseStart,
    end: new Date(baseStart.getTime() + baseDurationMs),
  };
};

const readCard = (
  database: Database.Database,
  projectId: string,
  cardId: string,
): Card | null => readAuthoritativeCardById(database, projectId, cardId);

export async function listCalendarOccurrences(
  projectId: string,
  windowStart: Date,
  windowEnd: Date,
  searchQuery?: string,
): Promise<CalendarOccurrence[]> {
  return listAuthoritativeCalendarOccurrences(getDb(), {
    projectId: requireProjectId(projectId),
    windowStart,
    windowEnd,
    searchQuery,
  });
}

export async function completeCardOccurrence(
  projectId: string,
  input: CardOccurrenceActionInput,
  sessionId?: string,
): Promise<CardOccurrenceMutationResult> {
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
      input.cardId,
      "invalid_occurrence_request",
      invalidRequest,
    );
  }
  const target = readCard(database, projectId, input.cardId);
  if (!target) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.cardId,
      "card_not_found",
      "Card not found",
    );
  }
  if (!target.scheduledStart || !target.scheduledEnd) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.cardId,
      "card_not_scheduled",
      "Card is not scheduled",
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
  const archiveCardId = deriveOccurrenceCardId(
    "complete",
    prepared.operationId,
    occurrenceStart,
  );
  const sourceScope = readOccurrenceAuthorityScope(database, projectId, target.id);
  const cloneOverrides: AuthoritativeCardClonePropertyOverrides = {
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
    const clone = cloneAuthoritativeCardInTransaction(database, {
      projectId,
      sourceCardId: target.id,
      newCardId: archiveCardId,
      lifecycle: "archived",
      status: "done",
      primaryViewRankKey: `~archive:${nowIso}:${archiveCardId}`,
      topLevelRankKey: `~archive:${nowIso}:${archiveCardId}`,
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
        projectId,
        input.cardId,
        occurrenceStart,
        nowIso,
      );
    }

    const nextSchedule = nextScheduleAfterOccurrence(
      database,
      projectId,
      target,
      occurrenceStart,
    );
    if (nextSchedule) {
      applyAuthoritativeCardSchedulePatchInTransaction(database, {
        projectId,
        cardId: target.id,
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
        cardId: clone.cardId,
        documentId: clone.documentId,
        databaseBlockId: clone.databaseBlockId,
      },
    );
  })();

  dbNotifier.notifyChange(projectId, "update", target.status, input.cardId);
  dbNotifier.notifyChange(
    projectId,
    "create",
    "done",
    result.createdCardId ?? archiveCardId,
  );
  return result;
}

export async function skipCardOccurrence(
  projectId: string,
  input: CardOccurrenceActionInput,
  sessionId?: string,
): Promise<CardOccurrenceMutationResult> {
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
      input.cardId,
      "invalid_occurrence_request",
      invalidRequest,
    );
  }
  const target = readCard(database, projectId, input.cardId);
  if (!target) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.cardId,
      "card_not_found",
      "Card not found",
    );
  }
  if (!target.scheduledStart || !target.scheduledEnd) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.cardId,
      "card_not_scheduled",
      "Card is not scheduled",
    );
  }

  const occurrenceStart = input.occurrenceStart;
  const nowIso = new Date().toISOString();
  const sourceScope = readOccurrenceAuthorityScope(database, projectId, target.id);

  const result = database.transaction(() => {
    if (target.recurrence) {
      upsertSkipRecurrenceException(
        database,
        projectId,
        input.cardId,
        occurrenceStart,
        nowIso,
      );
    }
    const nextSchedule = nextScheduleAfterOccurrence(
      database,
      projectId,
      target,
      occurrenceStart,
    );
    if (nextSchedule) {
      applyAuthoritativeCardSchedulePatchInTransaction(database, {
        projectId,
        cardId: target.id,
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

  dbNotifier.notifyChange(projectId, "update", target.status, input.cardId);
  return result;
}

export async function updateCardOccurrence(
  projectId: string,
  input: CardOccurrenceUpdateInput,
  sessionId?: string,
): Promise<CardOccurrenceMutationResult> {
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
      input.cardId,
      "invalid_occurrence_request",
      invalidRequest,
    );
  }
  const target = readCard(database, projectId, input.cardId);
  if (!target) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.cardId,
      "card_not_found",
      "Card not found",
    );
  }
  const nowIso = new Date().toISOString();
  const sourceScope = readOccurrenceAuthorityScope(database, projectId, target.id);
  const dragShiftRecurrence = shiftRecurringUntilDateWithDraggedDate(
    target.recurrence,
    input.occurrenceStart,
    input.updates.scheduledStart,
    input.updates.scheduleTimezone ?? target.scheduleTimezone,
  );

  if (input.scope === "all") {
    const result = database.transaction(() => {
      applyAuthoritativeCardSchedulePatchInTransaction(database, {
        projectId,
        cardId: target.id,
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
        applyAuthoritativeCardSchedulePatchInTransaction(database, {
          projectId,
          cardId: target.id,
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
    const detachedCardId = deriveOccurrenceCardId(
      "detach",
      prepared.operationId,
      input.occurrenceStart,
    );
    const detachedReminders = input.updates.reminders ?? target.reminders ?? [];
    const detachedTimezone = input.updates.scheduleTimezone === undefined
      ? target.scheduleTimezone
      : (input.updates.scheduleTimezone ?? undefined);
    const placement = readOccurrenceClonePlacement(
      database,
      projectId,
      target.id,
      detachedCardId,
    );

    const result = database.transaction(() => {
      const clone = cloneAuthoritativeCardInTransaction(database, {
        projectId,
        sourceCardId: target.id,
        newCardId: detachedCardId,
        lifecycle: "active",
        status: target.status,
        primaryViewRankKey: placement.primaryRankKey,
        topLevelRankKey: placement.topLevelRankKey,
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
        projectId,
        input.cardId,
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
          cardId: clone.cardId,
          documentId: clone.documentId,
          databaseBlockId: clone.databaseBlockId,
        },
      );
    })();

    dbNotifier.notifyChange(projectId, "update", target.status, input.cardId);
    dbNotifier.notifyChange(projectId, "create", target.status, detachedCardId);
    return result;
  }

  if (!target.recurrence) {
    const result = database.transaction(() => {
      applyAuthoritativeCardSchedulePatchInTransaction(database, {
        projectId,
        cardId: target.id,
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
      applyAuthoritativeCardSchedulePatchInTransaction(database, {
        projectId,
        cardId: target.id,
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
  const nextCardId = deriveOccurrenceCardId(
    "split",
    prepared.operationId,
    input.occurrenceStart,
  );
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
    projectId,
    target.id,
    nextCardId,
  );

  const result = database.transaction(() => {
    const clone = cloneAuthoritativeCardInTransaction(database, {
      projectId,
      sourceCardId: target.id,
      newCardId: nextCardId,
      lifecycle: "active",
      status: target.status,
      primaryViewRankKey: placement.primaryRankKey,
      topLevelRankKey: placement.topLevelRankKey,
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
    applyAuthoritativeCardSchedulePatchInTransaction(database, {
      projectId,
      cardId: target.id,
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
        cardId: clone.cardId,
        documentId: clone.documentId,
        databaseBlockId: clone.databaseBlockId,
      },
    );
  })();

  dbNotifier.notifyChange(projectId, "update", target.status, input.cardId);
  dbNotifier.notifyChange(projectId, "create", target.status, nextCardId);
  return result;
}
