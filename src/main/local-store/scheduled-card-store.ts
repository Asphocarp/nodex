import type Database from "better-sqlite3";
import { getCardStatusLabel } from "../../shared/card-status";
import type {
  CalendarOccurrence,
  Card,
  RecurrenceConfig,
  ReminderConfig,
} from "../../shared/types";
import { assertValidCardInput } from "./card-input-validation";
import { readDatabaseCardSummariesByIds } from "./card-read-store";
import { expandCardOccurrences, type RecurrenceException } from "./recurrence";

export type ScheduledCardReadErrorCode =
  | "scheduled_index_stale"
  | "scheduled_document_missing"
  | "scheduled_materialization_stale"
  | "scheduled_card_projection_missing"
  | "scheduled_value_invalid";

export class ScheduledCardReadError extends Error {
  constructor(
    readonly code: ScheduledCardReadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScheduledCardReadError";
  }
}

interface ScheduledCardRow {
  readonly card_block_id: string;
  readonly project_id: string;
  readonly index_lifecycle: "active" | "archived" | "deleted";
  readonly block_lifecycle: "active" | "archived" | "deleted";
  readonly block_metadata_revision: number;
  readonly source_metadata_revision: number;
  readonly scheduled_start: string;
  readonly scheduled_end: string;
  readonly is_all_day: number;
  readonly recurrence_json: string;
  readonly reminders_json: string;
  readonly schedule_timezone: string | null;
  readonly document_id: string | null;
  readonly document_generation: number | null;
  readonly document_head_seq: number | null;
  readonly document_schema_version: number | null;
  readonly document_readiness: "pending_genesis" | "ready" | "failed" | null;
  readonly document_authority: "legacy_shadow" | "ydoc_primary" | null;
  readonly materialization_generation: number | null;
  readonly materialization_projected_seq: number | null;
  readonly materialization_schema_version: number | null;
  readonly materialized_title: string | null;
  readonly materialized_nfm: string | null;
}

interface DbRecurrenceException {
  readonly card_id: string;
  readonly occurrence_start: string;
  readonly exception_type: "skip" | "override_time";
  readonly override_start: string | null;
  readonly override_end: string | null;
  readonly override_reminders_json: string | null;
}

export interface ScheduledCardQuery {
  readonly projectId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
}

export interface DueReminderSnooze {
  readonly id: number;
  readonly projectId: string;
  readonly cardId: string;
  readonly occurrenceStart: string;
  readonly title: string;
}

interface DueReminderSnoozeRow {
  readonly id: number;
  readonly project_id: string;
  readonly card_id: string;
  readonly occurrence_start: string;
  readonly document_id: string | null;
  readonly document_generation: number | null;
  readonly document_head_seq: number | null;
  readonly document_schema_version: number | null;
  readonly document_readiness: "pending_genesis" | "ready" | "failed" | null;
  readonly document_authority: "legacy_shadow" | "ydoc_primary" | null;
  readonly materialization_generation: number | null;
  readonly materialization_projected_seq: number | null;
  readonly materialization_schema_version: number | null;
  readonly materialized_title: string | null;
}

interface ScheduledCardProjectionSourceRow {
  readonly card_block_id: string;
  readonly project_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly metadata_revision: number;
  readonly membership_id: string | null;
  readonly scheduled_start_json: string | null;
  readonly scheduled_end_json: string | null;
  readonly is_all_day_json: string | null;
  readonly recurrence_json: string | null;
  readonly reminders_json: string | null;
  readonly schedule_timezone_json: string | null;
}

export interface RefreshScheduledCardIndexResult {
  readonly refreshedCardIds: readonly string[];
}

const requireProjectId = (value: string): string => {
  const projectId = value.trim();
  if (projectId) return projectId;
  throw new TypeError("Scheduled Card query requires a non-empty Project ID");
};

const requireDate = (value: Date, label: string): Date => {
  if (!Number.isNaN(value.getTime())) return value;
  throw new TypeError(`${label} must be a valid Date`);
};

const throwReadError = (
  code: ScheduledCardReadErrorCode,
  cardId: string,
  detail: string,
  cause?: unknown,
): never => {
  throw new ScheduledCardReadError(
    code,
    `Scheduled Card ${cardId} ${detail}`,
    cause === undefined ? undefined : { cause },
  );
};

const parseDate = (cardId: string, key: string, value: string): Date => {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return throwReadError(
    "scheduled_value_invalid",
    cardId,
    `has invalid ${key}`,
  );
};

const parseJson = (cardId: string, key: string, value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    return throwReadError(
      "scheduled_value_invalid",
      cardId,
      `has invalid ${key} JSON`,
      error,
    );
  }
};

const requireProjectionJson = (
  cardId: string,
  key: string,
  value: string | null,
): unknown => {
  if (value !== null) return parseJson(cardId, key, value);
  return throwReadError(
    "scheduled_value_invalid",
    cardId,
    `is missing relational ${key}`,
  );
};

const requireNullableProjectionString = (
  cardId: string,
  key: string,
  value: string | null,
): string | null => {
  const parsed = requireProjectionJson(cardId, key, value);
  if (parsed === null || typeof parsed === "string") return parsed;
  return throwReadError(
    "scheduled_value_invalid",
    cardId,
    `has a non-string relational ${key}`,
  );
};

const requireProjectionBoolean = (
  cardId: string,
  key: string,
  value: string | null,
): boolean => {
  const parsed = requireProjectionJson(cardId, key, value);
  if (typeof parsed === "boolean") return parsed;
  return throwReadError(
    "scheduled_value_invalid",
    cardId,
    `has a non-boolean relational ${key}`,
  );
};

const parseRecurrence = (
  cardId: string,
  value: string,
): RecurrenceConfig | undefined => {
  const parsed = parseJson(cardId, "recurrence", value);
  if (parsed === null) return undefined;
  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as RecurrenceConfig;
  }
  return throwReadError(
    "scheduled_value_invalid",
    cardId,
    "has a non-object recurrence value",
  );
};

const parseReminders = (cardId: string, value: string): ReminderConfig[] => {
  const parsed = parseJson(cardId, "reminders", value);
  if (
    Array.isArray(parsed) &&
    parsed.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { readonly offsetMinutes?: unknown }).offsetMinutes ===
          "number",
    )
  ) {
    return parsed as ReminderConfig[];
  }
  return throwReadError(
    "scheduled_value_invalid",
    cardId,
    "has a non-array reminders value",
  );
};

const assertCurrentDocument = (
  row: ScheduledCardRow | DueReminderSnoozeRow,
  cardId: string,
): { readonly title: string; readonly nfm: string | null } => {
  if (!row.document_id) {
    return throwReadError(
      "scheduled_document_missing",
      cardId,
      "has no owned Document",
    );
  }

  const isCurrent =
    row.document_readiness === "ready" &&
    row.document_authority === "ydoc_primary" &&
    row.document_generation !== null &&
    row.document_head_seq !== null &&
    row.document_schema_version !== null &&
    row.materialization_generation === row.document_generation &&
    row.materialization_projected_seq === row.document_head_seq &&
    row.materialization_schema_version === row.document_schema_version &&
    typeof row.materialized_title === "string";
  if (!isCurrent) {
    return throwReadError(
      "scheduled_materialization_stale",
      cardId,
      "does not have a materialization for its current Document head",
    );
  }

  return {
    title: row.materialized_title as string,
    nfm: "materialized_nfm" in row ? row.materialized_nfm : null,
  };
};

const readScheduledRows = (
  database: Database.Database,
  query: ScheduledCardQuery,
): ScheduledCardRow[] => {
  const projectId = requireProjectId(query.projectId);
  const windowStart = requireDate(query.windowStart, "windowStart");
  const windowEnd = requireDate(query.windowEnd, "windowEnd");
  if (windowEnd <= windowStart) return [];

  return database
    .prepare(
      `
      SELECT
        schedule.card_block_id,
        schedule.project_id,
        schedule.lifecycle AS index_lifecycle,
        card.lifecycle AS block_lifecycle,
        card.metadata_revision AS block_metadata_revision,
        schedule.source_metadata_revision,
        schedule.scheduled_start,
        schedule.scheduled_end,
        schedule.is_all_day,
        schedule.recurrence_json,
        schedule.reminders_json,
        schedule.schedule_timezone,
        document.id AS document_id,
        document.generation AS document_generation,
        document.head_seq AS document_head_seq,
        document.schema_version AS document_schema_version,
        document.readiness AS document_readiness,
        document.authority AS document_authority,
        materialization.generation AS materialization_generation,
        materialization.projected_seq AS materialization_projected_seq,
        materialization.schema_version AS materialization_schema_version,
        materialization.title AS materialized_title,
        materialization.nfm AS materialized_nfm
      FROM scheduled_card_index schedule
      INNER JOIN blocks card
        ON card.id = schedule.card_block_id
        AND card.project_id = schedule.project_id
        AND card.type = 'card'
      LEFT JOIN block_documents ownership
        ON ownership.block_id = card.id
        AND ownership.project_id = card.project_id
      LEFT JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
      WHERE schedule.project_id = ?
        AND card.lifecycle <> 'deleted'
        AND schedule.scheduled_start IS NOT NULL
        AND schedule.scheduled_end IS NOT NULL
        AND schedule.scheduled_start < ?
        AND (
          schedule.recurrence_json <> 'null'
          OR schedule.scheduled_end > ?
        )
      ORDER BY schedule.scheduled_start, schedule.card_block_id
    `,
    )
    .all(
      projectId,
      windowEnd.toISOString(),
      windowStart.toISOString(),
    ) as ScheduledCardRow[];
};

const validateScheduledRow = (row: ScheduledCardRow): void => {
  if (
    row.index_lifecycle !== row.block_lifecycle ||
    row.source_metadata_revision !== row.block_metadata_revision
  ) {
    return throwReadError(
      "scheduled_index_stale",
      row.card_block_id,
      "has a stale lifecycle or metadata revision in scheduled_card_index",
    );
  }
  const content = assertCurrentDocument(row, row.card_block_id);
  if (content.nfm !== null) return;
  return throwReadError(
    "scheduled_materialization_stale",
    row.card_block_id,
    "has no materialized NFM body",
  );
};

const readScheduledProjectionSources = (
  database: Database.Database,
  projectId: string,
  cardIds: readonly string[],
): ScheduledCardProjectionSourceRow[] => {
  if (cardIds.length === 0) return [];
  const placeholders = cardIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
      SELECT
        card.id AS card_block_id,
        card.project_id,
        card.lifecycle,
        card.metadata_revision,
        membership.id AS membership_id,
        scheduled_start.value_json AS scheduled_start_json,
        scheduled_end.value_json AS scheduled_end_json,
        is_all_day.value_json AS is_all_day_json,
        recurrence.value_json AS recurrence_json,
        reminders.value_json AS reminders_json,
        schedule_timezone.value_json AS schedule_timezone_json
      FROM blocks card
      LEFT JOIN database_memberships membership
        ON membership.card_block_id = card.id
        AND membership.project_id = card.project_id
        AND membership.removed_at IS NULL
      LEFT JOIN database_properties scheduled_start_property
        ON scheduled_start_property.database_block_id = membership.database_block_id
        AND scheduled_start_property.project_id = membership.project_id
        AND scheduled_start_property.key = 'scheduled_start'
        AND scheduled_start_property.lifecycle = 'active'
      LEFT JOIN database_property_values scheduled_start
        ON scheduled_start.membership_id = membership.id
        AND scheduled_start.property_id = scheduled_start_property.id
        AND scheduled_start.database_block_id = membership.database_block_id
        AND scheduled_start.project_id = membership.project_id
      LEFT JOIN database_properties scheduled_end_property
        ON scheduled_end_property.database_block_id = membership.database_block_id
        AND scheduled_end_property.project_id = membership.project_id
        AND scheduled_end_property.key = 'scheduled_end'
        AND scheduled_end_property.lifecycle = 'active'
      LEFT JOIN database_property_values scheduled_end
        ON scheduled_end.membership_id = membership.id
        AND scheduled_end.property_id = scheduled_end_property.id
        AND scheduled_end.database_block_id = membership.database_block_id
        AND scheduled_end.project_id = membership.project_id
      LEFT JOIN block_properties is_all_day
        ON is_all_day.block_id = card.id
        AND is_all_day.project_id = card.project_id
        AND is_all_day.property_key = 'schedule.isAllDay'
      LEFT JOIN block_properties recurrence
        ON recurrence.block_id = card.id
        AND recurrence.project_id = card.project_id
        AND recurrence.property_key = 'recurrence.config'
      LEFT JOIN block_properties reminders
        ON reminders.block_id = card.id
        AND reminders.project_id = card.project_id
        AND reminders.property_key = 'reminders.config'
      LEFT JOIN block_properties schedule_timezone
        ON schedule_timezone.block_id = card.id
        AND schedule_timezone.project_id = card.project_id
        AND schedule_timezone.property_key = 'schedule.timezone'
      WHERE card.project_id = ?
        AND card.type = 'card'
        AND card.id IN (${placeholders})
      ORDER BY card.id
    `,
    )
    .all(projectId, ...cardIds) as ScheduledCardProjectionSourceRow[];
};

/**
 * Refresh the scheduler read index from relational authorities.
 *
 * This function deliberately does not open or commit a transaction. Callers
 * must invoke it inside the same writer transaction that advances the Block's
 * metadata revision, so a validation/constraint failure rolls the mutation
 * back instead of publishing a stale schedule coordinate.
 */
export const refreshScheduledCardIndexProjection = (
  database: Database.Database,
  projectIdInput: string,
  cardIdInputs: readonly string[],
  updatedAt: string,
): RefreshScheduledCardIndexResult => {
  const projectId = requireProjectId(projectIdInput);
  const cardIds = Array.from(
    new Set(
      cardIdInputs.map((cardId) => cardId.trim()).filter((cardId) => cardId),
    ),
  );
  if (cardIds.length === 0) return { refreshedCardIds: [] };
  if (!database.inTransaction) {
    throw new Error(
      "refreshScheduledCardIndexProjection requires an active writer transaction",
    );
  }
  if (!updatedAt.trim() || Number.isNaN(new Date(updatedAt).getTime())) {
    throw new TypeError("updatedAt must be a valid timestamp");
  }

  const rows = readScheduledProjectionSources(database, projectId, cardIds);
  const rowsById = new Map(
    rows.map((row) => [row.card_block_id, row] as const),
  );
  for (const cardId of cardIds) {
    if (rowsById.has(cardId)) continue;
    return throwReadError(
      "scheduled_card_projection_missing",
      cardId,
      `does not exist in Project ${projectId}`,
    );
  }

  const upsert = database.prepare(
    `
    INSERT INTO scheduled_card_index (
      card_block_id,
      project_id,
      lifecycle,
      scheduled_start,
      scheduled_end,
      is_all_day,
      recurrence_json,
      reminders_json,
      schedule_timezone,
      source_metadata_revision,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_block_id) DO UPDATE SET
      project_id = excluded.project_id,
      lifecycle = excluded.lifecycle,
      scheduled_start = excluded.scheduled_start,
      scheduled_end = excluded.scheduled_end,
      is_all_day = excluded.is_all_day,
      recurrence_json = excluded.recurrence_json,
      reminders_json = excluded.reminders_json,
      schedule_timezone = excluded.schedule_timezone,
      source_metadata_revision = excluded.source_metadata_revision,
      updated_at = excluded.updated_at
  `,
  );

  for (const cardId of cardIds) {
    const row = rowsById.get(cardId);
    if (!row) continue;
    const scheduledStartText =
      row.membership_id === null || row.scheduled_start_json === null
        ? null
        : requireNullableProjectionString(
            cardId,
            "scheduled_start",
            row.scheduled_start_json,
          );
    const scheduledEndText =
      row.membership_id === null || row.scheduled_end_json === null
        ? null
        : requireNullableProjectionString(
            cardId,
            "scheduled_end",
            row.scheduled_end_json,
          );
    if ((scheduledStartText === null) !== (scheduledEndText === null)) {
      return throwReadError(
        "scheduled_value_invalid",
        cardId,
        "must have both scheduled_start and scheduled_end or neither",
      );
    }
    const scheduledStart =
      scheduledStartText === null
        ? undefined
        : parseDate(cardId, "scheduled_start", scheduledStartText);
    const scheduledEnd =
      scheduledEndText === null
        ? undefined
        : parseDate(cardId, "scheduled_end", scheduledEndText);
    const isAllDay = requireProjectionBoolean(
      cardId,
      "schedule.isAllDay",
      row.is_all_day_json,
    );
    const recurrence = parseRecurrence(
      cardId,
      row.recurrence_json ??
        throwReadError(
          "scheduled_value_invalid",
          cardId,
          "is missing relational recurrence.config",
        ),
    );
    const reminders = parseReminders(
      cardId,
      row.reminders_json ??
        throwReadError(
          "scheduled_value_invalid",
          cardId,
          "is missing relational reminders.config",
        ),
    );
    const scheduleTimezone = requireNullableProjectionString(
      cardId,
      "schedule.timezone",
      row.schedule_timezone_json,
    );
    try {
      assertValidCardInput(
        {
          scheduledStart,
          scheduledEnd,
          isAllDay,
          recurrence,
          reminders,
          scheduleTimezone,
        },
        "update",
      );
    } catch (error) {
      return throwReadError(
        "scheduled_value_invalid",
        cardId,
        "has an invalid relational schedule combination",
        error,
      );
    }

    upsert.run(
      row.card_block_id,
      row.project_id,
      row.lifecycle,
      scheduledStart?.toISOString() ?? null,
      scheduledEnd?.toISOString() ?? null,
      isAllDay ? 1 : 0,
      JSON.stringify(recurrence ?? null),
      JSON.stringify(reminders),
      scheduleTimezone,
      row.metadata_revision,
      updatedAt,
    );
  }

  return { refreshedCardIds: cardIds };
};

/**
 * Read the bounded scheduler/calendar working set from the typed schedule
 * index. Content is taken only from the current owned Document projection;
 * all remaining Card fields come from Block/Database property authorities.
 */
export const readAuthoritativeScheduledCards = (
  database: Database.Database,
  query: ScheduledCardQuery,
): Card[] =>
  database.transaction(() => {
    const rows = readScheduledRows(database, query);
    for (const row of rows) validateScheduledRow(row);
    if (rows.length === 0) return [];

    const summaries = readDatabaseCardSummariesByIds(
      database,
      rows.map((row) => row.card_block_id),
    );
    const summariesById = new Map(
      summaries.map((summary) => [summary.id, summary] as const),
    );

    return rows.map((row) => {
      const summary = summariesById.get(row.card_block_id);
      if (!summary) {
        return throwReadError(
          "scheduled_card_projection_missing",
          row.card_block_id,
          "has no relational Card projection",
        );
      }

      const scheduledStart = parseDate(
        row.card_block_id,
        "scheduled_start",
        row.scheduled_start,
      );
      const scheduledEnd = parseDate(
        row.card_block_id,
        "scheduled_end",
        row.scheduled_end,
      );
      const recurrence = parseRecurrence(
        row.card_block_id,
        row.recurrence_json,
      );
      const reminders = parseReminders(row.card_block_id, row.reminders_json);
      const content = assertCurrentDocument(row, row.card_block_id);
      if (content.nfm === null) {
        return throwReadError(
          "scheduled_materialization_stale",
          row.card_block_id,
          "has no materialized NFM body",
        );
      }

      const {
        descriptionPreview: ignoredPreview,
        descriptionLength: ignoredLength,
        hasDescription: ignoredHasDescription,
        ...cardSummary
      } = summary;
      void ignoredPreview;
      void ignoredLength;
      void ignoredHasDescription;

      const card: Card = {
        ...cardSummary,
        title: content.title,
        description: content.nfm,
        archived: row.block_lifecycle === "archived",
        scheduledStart,
        scheduledEnd,
        isAllDay: row.is_all_day === 1,
        recurrence,
        reminders,
        scheduleTimezone: row.schedule_timezone ?? undefined,
      };
      try {
        assertValidCardInput(
          {
            scheduledStart: card.scheduledStart,
            scheduledEnd: card.scheduledEnd,
            isAllDay: card.isAllDay,
            recurrence: card.recurrence,
            reminders: card.reminders,
            scheduleTimezone: card.scheduleTimezone,
          },
          "update",
        );
      } catch (error) {
        return throwReadError(
          "scheduled_value_invalid",
          row.card_block_id,
          "has invalid scheduled metadata",
          error,
        );
      }
      return card;
    });
  })();

const parseExceptionDate = (
  cardId: string,
  key: string,
  value: string | null,
): Date | undefined => {
  if (value === null) return undefined;
  return parseDate(cardId, key, value);
};

const readRecurrenceExceptions = (
  database: Database.Database,
  projectId: string,
  cardIds: readonly string[],
): ReadonlyMap<string, readonly RecurrenceException[]> => {
  if (cardIds.length === 0) return new Map();
  const placeholders = cardIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT
        card_id,
        occurrence_start,
        exception_type,
        override_start,
        override_end,
        override_reminders_json
      FROM recurrence_exceptions
      WHERE project_id = ? AND card_id IN (${placeholders})
      ORDER BY card_id, occurrence_start
    `,
    )
    .all(projectId, ...cardIds) as DbRecurrenceException[];

  const exceptions = new Map<string, RecurrenceException[]>();
  for (const row of rows) {
    const cardExceptions = exceptions.get(row.card_id) ?? [];
    cardExceptions.push({
      occurrenceStart: parseDate(
        row.card_id,
        "exception occurrence_start",
        row.occurrence_start,
      ),
      exceptionType: row.exception_type,
      overrideStart: parseExceptionDate(
        row.card_id,
        "exception override_start",
        row.override_start,
      ),
      overrideEnd: parseExceptionDate(
        row.card_id,
        "exception override_end",
        row.override_end,
      ),
      overrideReminders:
        row.override_reminders_json === null
          ? undefined
          : parseReminders(row.card_id, row.override_reminders_json),
    });
    exceptions.set(row.card_id, cardExceptions);
  }
  return exceptions;
};

const normalizeSearchTokens = (query: string): string[] =>
  query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);

const cardSearchText = (card: Card): string =>
  [
    card.title,
    card.description,
    card.priority ?? "",
    card.estimate ?? "",
    card.assignee ?? "",
    card.agentStatus ?? "",
    card.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase();

export const listAuthoritativeCalendarOccurrences = (
  database: Database.Database,
  query: ScheduledCardQuery & { readonly searchQuery?: string },
): CalendarOccurrence[] =>
  database.transaction(() => {
    const cards = readAuthoritativeScheduledCards(database, query);
    const exceptions = readRecurrenceExceptions(
      database,
      requireProjectId(query.projectId),
      cards.map((card) => card.id),
    );
    const tokens = normalizeSearchTokens(query.searchQuery ?? "");
    const occurrences: CalendarOccurrence[] = [];

    for (const card of cards) {
      if (
        tokens.length > 0 &&
        !tokens.every((token) => cardSearchText(card).includes(token))
      ) {
        continue;
      }

      const expanded = expandCardOccurrences(
        card,
        query.windowStart,
        query.windowEnd,
        { exceptions: [...(exceptions.get(card.id) ?? [])] },
      );
      const firstOccurrenceTimestamp = card.scheduledStart?.getTime() ?? null;
      for (const occurrence of expanded) {
        occurrences.push({
          ...card,
          id: `${card.id}:${occurrence.occurrenceStart.toISOString()}`,
          cardId: card.id,
          statusName: getCardStatusLabel(card.status),
          occurrenceStart: occurrence.occurrenceStart,
          occurrenceEnd: occurrence.occurrenceEnd,
          scheduledStart: occurrence.occurrenceStart,
          scheduledEnd: occurrence.occurrenceEnd,
          reminders: occurrence.reminders,
          isRecurring: Boolean(card.recurrence),
          thisAndFutureEquivalentToAll:
            Boolean(card.recurrence) &&
            firstOccurrenceTimestamp !== null &&
            occurrence.occurrenceStart.getTime() <= firstOccurrenceTimestamp,
        });
      }
    }

    return occurrences.sort(
      (left, right) =>
        left.occurrenceStart.getTime() - right.occurrenceStart.getTime() ||
        left.cardId.localeCompare(right.cardId),
    );
  })();

/** Read due snoozes with title pinned to the current Card Document head. */
export const readDueReminderSnoozes = (
  database: Database.Database,
  now: Date,
): DueReminderSnooze[] => {
  const dueAt = requireDate(now, "now").toISOString();
  const rows = database
    .prepare(
      `
      SELECT
        snooze.id,
        snooze.project_id,
        snooze.card_id,
        snooze.occurrence_start,
        document.id AS document_id,
        document.generation AS document_generation,
        document.head_seq AS document_head_seq,
        document.schema_version AS document_schema_version,
        document.readiness AS document_readiness,
        document.authority AS document_authority,
        materialization.generation AS materialization_generation,
        materialization.projected_seq AS materialization_projected_seq,
        materialization.schema_version AS materialization_schema_version,
        materialization.title AS materialized_title
      FROM reminder_snoozes snooze
      INNER JOIN blocks card
        ON card.id = snooze.card_id
        AND card.project_id = snooze.project_id
        AND card.type = 'card'
        AND card.lifecycle <> 'deleted'
      LEFT JOIN block_documents ownership
        ON ownership.block_id = card.id
        AND ownership.project_id = card.project_id
      LEFT JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
      WHERE snooze.consumed_at IS NULL AND snooze.due_at <= ?
      ORDER BY snooze.due_at, snooze.id
    `,
    )
    .all(dueAt) as DueReminderSnoozeRow[];

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    cardId: row.card_id,
    occurrenceStart: row.occurrence_start,
    title: assertCurrentDocument(row, row.card_id).title,
  }));
};
