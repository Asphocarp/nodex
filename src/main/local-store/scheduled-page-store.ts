import type Database from "better-sqlite3";
import { getWorkflowStatusLabel } from "../../shared/workflow-status";
import type {
  PageOccurrence,
  DatabasePage,
  RecurrenceConfig,
  ReminderConfig,
} from "../../shared/types";
import { assertValidPageInput } from "./page-input-validation";
import { readDatabasePageSummariesByIds } from "./page-read-store";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";
import { expandPageOccurrences, type RecurrenceException } from "./recurrence";

export type ScheduledPageReadErrorCode =
  | "scheduled_index_stale"
  | "scheduled_document_missing"
  | "scheduled_materialization_stale"
  | "scheduled_page_projection_missing"
  | "scheduled_value_invalid";

export class ScheduledPageReadError extends Error {
  constructor(
    readonly code: ScheduledPageReadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScheduledPageReadError";
  }
}

interface ScheduledPageRow {
  readonly page_block_id: string;
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
  readonly page_id: string;
  readonly occurrence_start: string;
  readonly exception_type: "skip" | "override_time";
  readonly override_start: string | null;
  readonly override_end: string | null;
  readonly override_reminders_json: string | null;
}

export interface ScheduledPageQuery {
  readonly projectId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
}

export interface DueReminderSnooze {
  readonly id: number;
  readonly projectId: string;
  readonly receiptProjectId: string;
  readonly pageId: string;
  readonly occurrenceStart: string;
  readonly title: string;
}

interface DueReminderSnoozeRow {
  readonly id: number;
  readonly project_id: string;
  readonly receipt_project_id: string;
  readonly page_id: string;
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

interface ScheduledPageProjectionSourceRow {
  readonly page_block_id: string;
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

export interface RefreshScheduledPageIndexResult {
  readonly refreshedPageIds: readonly string[];
}

const requireProjectId = (value: string): string => {
  const projectId = value.trim();
  if (projectId) return projectId;
  throw new TypeError("Scheduled Page query requires a non-empty Project ID");
};

const requireDate = (value: Date, label: string): Date => {
  if (!Number.isNaN(value.getTime())) return value;
  throw new TypeError(`${label} must be a valid Date`);
};

const throwReadError = (
  code: ScheduledPageReadErrorCode,
  pageId: string,
  detail: string,
  cause?: unknown,
): never => {
  throw new ScheduledPageReadError(
    code,
    `Scheduled Page ${pageId} ${detail}`,
    cause === undefined ? undefined : { cause },
  );
};

const parseDate = (pageId: string, key: string, value: string): Date => {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return throwReadError(
    "scheduled_value_invalid",
    pageId,
    `has invalid ${key}`,
  );
};

const parseJson = (pageId: string, key: string, value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    return throwReadError(
      "scheduled_value_invalid",
      pageId,
      `has invalid ${key} JSON`,
      error,
    );
  }
};

const requireProjectionJson = (
  pageId: string,
  key: string,
  value: string | null,
): unknown => {
  if (value !== null) return parseJson(pageId, key, value);
  return throwReadError(
    "scheduled_value_invalid",
    pageId,
    `is missing relational ${key}`,
  );
};

const requireNullableProjectionString = (
  pageId: string,
  key: string,
  value: string | null,
): string | null => {
  const parsed = requireProjectionJson(pageId, key, value);
  if (parsed === null || typeof parsed === "string") return parsed;
  return throwReadError(
    "scheduled_value_invalid",
    pageId,
    `has a non-string relational ${key}`,
  );
};

const requireProjectionBoolean = (
  pageId: string,
  key: string,
  value: string | null,
): boolean => {
  const parsed = requireProjectionJson(pageId, key, value);
  if (typeof parsed === "boolean") return parsed;
  return throwReadError(
    "scheduled_value_invalid",
    pageId,
    `has a non-boolean relational ${key}`,
  );
};

const parseRecurrence = (
  pageId: string,
  value: string,
): RecurrenceConfig | undefined => {
  const parsed = parseJson(pageId, "recurrence", value);
  if (parsed === null) return undefined;
  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as RecurrenceConfig;
  }
  return throwReadError(
    "scheduled_value_invalid",
    pageId,
    "has a non-object recurrence value",
  );
};

const parseReminders = (pageId: string, value: string): ReminderConfig[] => {
  const parsed = parseJson(pageId, "reminders", value);
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
    pageId,
    "has a non-array reminders value",
  );
};

const assertCurrentDocument = (
  row: ScheduledPageRow | DueReminderSnoozeRow,
  pageId: string,
): { readonly title: string; readonly nfm: string | null } => {
  if (!row.document_id) {
    return throwReadError(
      "scheduled_document_missing",
      pageId,
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
      pageId,
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
  query: ScheduledPageQuery,
): ScheduledPageRow[] => {
  const projectId = requireProjectId(query.projectId);
  const windowStart = requireDate(query.windowStart, "windowStart");
  const windowEnd = requireDate(query.windowEnd, "windowEnd");
  if (windowEnd <= windowStart) return [];

  const project = database.prepare(`
    SELECT library_id AS libraryId FROM projects WHERE id = ?
  `).get(projectId) as { readonly libraryId: string } | undefined;
  if (!project) return [];

  const rows = database
    .prepare(
      `
      SELECT
        schedule.page_block_id,
        schedule.project_id,
        schedule.lifecycle AS index_lifecycle,
        block.lifecycle AS block_lifecycle,
        block.metadata_revision AS block_metadata_revision,
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
      FROM scheduled_page_index schedule
      INNER JOIN blocks block
        ON block.id = schedule.page_block_id
        AND block.project_id = schedule.project_id
        AND block.type = 'page'
      INNER JOIN pages page ON page.block_id = block.id
      LEFT JOIN block_documents ownership
        ON ownership.block_id = block.id
        AND ownership.project_id = block.project_id
      LEFT JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
      WHERE page.library_id = ?
        AND block.lifecycle <> 'deleted'
        AND schedule.scheduled_start IS NOT NULL
        AND schedule.scheduled_end IS NOT NULL
        AND schedule.scheduled_start < ?
        AND (
          schedule.recurrence_json <> 'null'
          OR schedule.scheduled_end > ?
        )
      ORDER BY schedule.scheduled_start, schedule.page_block_id
    `,
    )
    .all(
      project.libraryId,
      windowEnd.toISOString(),
      windowStart.toISOString(),
    ) as ScheduledPageRow[];
  return rows.filter((row) =>
    authorizeProjectResourceInDatabase(database, {
      projectId,
      resource: { kind: "page", pageId: row.page_block_id },
      action: "read",
    }).allowed,
  );
};

const validateScheduledRow = (row: ScheduledPageRow): void => {
  if (
    row.index_lifecycle !== row.block_lifecycle ||
    row.source_metadata_revision !== row.block_metadata_revision
  ) {
    return throwReadError(
      "scheduled_index_stale",
      row.page_block_id,
      "has a stale lifecycle or metadata revision in scheduled_page_index",
    );
  }
  const content = assertCurrentDocument(row, row.page_block_id);
  if (content.nfm !== null) return;
  return throwReadError(
    "scheduled_materialization_stale",
    row.page_block_id,
    "has no materialized NFM body",
  );
};

const readScheduledProjectionSources = (
  database: Database.Database,
  projectId: string,
  pageIds: readonly string[],
): ScheduledPageProjectionSourceRow[] => {
  if (pageIds.length === 0) return [];
  const placeholders = pageIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
      SELECT
        page.id AS page_block_id,
        page.project_id,
        page.lifecycle,
        page.metadata_revision,
        membership.id AS membership_id,
        scheduled_start.value_json AS scheduled_start_json,
        scheduled_end.value_json AS scheduled_end_json,
        is_all_day.value_json AS is_all_day_json,
        recurrence.value_json AS recurrence_json,
        reminders.value_json AS reminders_json,
        schedule_timezone.value_json AS schedule_timezone_json
      FROM blocks page
      LEFT JOIN database_memberships membership
        ON membership.page_block_id = page.id
        AND membership.project_id = page.project_id
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
        ON is_all_day.block_id = page.id
        AND is_all_day.project_id = page.project_id
        AND is_all_day.property_key = 'schedule.isAllDay'
      LEFT JOIN block_properties recurrence
        ON recurrence.block_id = page.id
        AND recurrence.project_id = page.project_id
        AND recurrence.property_key = 'recurrence.config'
      LEFT JOIN block_properties reminders
        ON reminders.block_id = page.id
        AND reminders.project_id = page.project_id
        AND reminders.property_key = 'reminders.config'
      LEFT JOIN block_properties schedule_timezone
        ON schedule_timezone.block_id = page.id
        AND schedule_timezone.project_id = page.project_id
        AND schedule_timezone.property_key = 'schedule.timezone'
      WHERE page.project_id = ?
        AND page.type = 'page'
        AND page.id IN (${placeholders})
      ORDER BY page.id
    `,
    )
    .all(projectId, ...pageIds) as ScheduledPageProjectionSourceRow[];
};

/**
 * Refresh the scheduler read index from relational authorities.
 *
 * This function deliberately does not open or commit a transaction. Callers
 * must invoke it inside the same writer transaction that advances the Block's
 * metadata revision, so a validation/constraint failure rolls the mutation
 * back instead of publishing a stale schedule coordinate.
 */
export const refreshScheduledPageIndexProjection = (
  database: Database.Database,
  projectIdInput: string,
  pageIdInputs: readonly string[],
  updatedAt: string,
): RefreshScheduledPageIndexResult => {
  const projectId = requireProjectId(projectIdInput);
  const pageIds = Array.from(
    new Set(
      pageIdInputs.map((pageId) => pageId.trim()).filter((pageId) => pageId),
    ),
  );
  if (pageIds.length === 0) return { refreshedPageIds: [] };
  if (!database.inTransaction) {
    throw new Error(
      "refreshScheduledPageIndexProjection requires an active writer transaction",
    );
  }
  if (!updatedAt.trim() || Number.isNaN(new Date(updatedAt).getTime())) {
    throw new TypeError("updatedAt must be a valid timestamp");
  }

  const rows = readScheduledProjectionSources(database, projectId, pageIds);
  const rowsById = new Map(
    rows.map((row) => [row.page_block_id, row] as const),
  );
  for (const pageId of pageIds) {
    if (rowsById.has(pageId)) continue;
    return throwReadError(
      "scheduled_page_projection_missing",
      pageId,
      `does not exist in Project ${projectId}`,
    );
  }

  const upsert = database.prepare(
    `
    INSERT INTO scheduled_page_index (
      page_block_id,
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
    ON CONFLICT(page_block_id) DO UPDATE SET
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

  for (const pageId of pageIds) {
    const row = rowsById.get(pageId);
    if (!row) continue;
    const scheduledStartText =
      row.membership_id === null || row.scheduled_start_json === null
        ? null
        : requireNullableProjectionString(
            pageId,
            "scheduled_start",
            row.scheduled_start_json,
          );
    const scheduledEndText =
      row.membership_id === null || row.scheduled_end_json === null
        ? null
        : requireNullableProjectionString(
            pageId,
            "scheduled_end",
            row.scheduled_end_json,
          );
    if ((scheduledStartText === null) !== (scheduledEndText === null)) {
      return throwReadError(
        "scheduled_value_invalid",
        pageId,
        "must have both scheduled_start and scheduled_end or neither",
      );
    }
    const scheduledStart =
      scheduledStartText === null
        ? undefined
        : parseDate(pageId, "scheduled_start", scheduledStartText);
    const scheduledEnd =
      scheduledEndText === null
        ? undefined
        : parseDate(pageId, "scheduled_end", scheduledEndText);
    const isAllDay = requireProjectionBoolean(
      pageId,
      "schedule.isAllDay",
      row.is_all_day_json,
    );
    const recurrence = parseRecurrence(
      pageId,
      row.recurrence_json ??
        throwReadError(
          "scheduled_value_invalid",
          pageId,
          "is missing relational recurrence.config",
        ),
    );
    const reminders = parseReminders(
      pageId,
      row.reminders_json ??
        throwReadError(
          "scheduled_value_invalid",
          pageId,
          "is missing relational reminders.config",
        ),
    );
    const scheduleTimezone = requireNullableProjectionString(
      pageId,
      "schedule.timezone",
      row.schedule_timezone_json,
    );
    try {
      assertValidPageInput(
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
        pageId,
        "has an invalid relational schedule combination",
        error,
      );
    }

    upsert.run(
      row.page_block_id,
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

  return { refreshedPageIds: pageIds };
};

/**
 * Read the bounded scheduler/calendar working set from the typed schedule
 * index. Content is taken only from the current owned Document projection;
 * all remaining Page fields come from Block/Data Source property authorities.
 */
export const readAuthoritativeScheduledPages = (
  database: Database.Database,
  query: ScheduledPageQuery,
): DatabasePage[] =>
  database.transaction(() => {
    const rows = readScheduledRows(database, query);
    for (const row of rows) validateScheduledRow(row);
    if (rows.length === 0) return [];

    const summaries = readDatabasePageSummariesByIds(
      database,
      rows.map((row) => row.page_block_id),
    );
    const summariesById = new Map(
      summaries.map((summary) => [summary.id, summary] as const),
    );

    return rows.map((row) => {
      const summary = summariesById.get(row.page_block_id);
      if (!summary) {
        return throwReadError(
          "scheduled_page_projection_missing",
          row.page_block_id,
          "has no relational Page projection",
        );
      }

      const scheduledStart = parseDate(
        row.page_block_id,
        "scheduled_start",
        row.scheduled_start,
      );
      const scheduledEnd = parseDate(
        row.page_block_id,
        "scheduled_end",
        row.scheduled_end,
      );
      const recurrence = parseRecurrence(
        row.page_block_id,
        row.recurrence_json,
      );
      const reminders = parseReminders(row.page_block_id, row.reminders_json);
      const content = assertCurrentDocument(row, row.page_block_id);
      if (content.nfm === null) {
        return throwReadError(
          "scheduled_materialization_stale",
          row.page_block_id,
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

      const page: DatabasePage = {
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
        assertValidPageInput(
          {
            scheduledStart: page.scheduledStart,
            scheduledEnd: page.scheduledEnd,
            isAllDay: page.isAllDay,
            recurrence: page.recurrence,
            reminders: page.reminders,
            scheduleTimezone: page.scheduleTimezone,
          },
          "update",
        );
      } catch (error) {
        return throwReadError(
          "scheduled_value_invalid",
          row.page_block_id,
          "has invalid scheduled metadata",
          error,
        );
      }
      return page;
    });
  })();

const parseExceptionDate = (
  pageId: string,
  key: string,
  value: string | null,
): Date | undefined => {
  if (value === null) return undefined;
  return parseDate(pageId, key, value);
};

const readRecurrenceExceptions = (
  database: Database.Database,
  pageIds: readonly string[],
): ReadonlyMap<string, readonly RecurrenceException[]> => {
  if (pageIds.length === 0) return new Map();
  const placeholders = pageIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT
        page_id,
        occurrence_start,
        exception_type,
        override_start,
        override_end,
        override_reminders_json
      FROM recurrence_exceptions
      WHERE page_id IN (${placeholders})
      ORDER BY page_id, occurrence_start
    `,
    )
    .all(...pageIds) as DbRecurrenceException[];

  const exceptions = new Map<string, RecurrenceException[]>();
  for (const row of rows) {
    const cardExceptions = exceptions.get(row.page_id) ?? [];
    cardExceptions.push({
      occurrenceStart: parseDate(
        row.page_id,
        "exception occurrence_start",
        row.occurrence_start,
      ),
      exceptionType: row.exception_type,
      overrideStart: parseExceptionDate(
        row.page_id,
        "exception override_start",
        row.override_start,
      ),
      overrideEnd: parseExceptionDate(
        row.page_id,
        "exception override_end",
        row.override_end,
      ),
      overrideReminders:
        row.override_reminders_json === null
          ? undefined
          : parseReminders(row.page_id, row.override_reminders_json),
    });
    exceptions.set(row.page_id, cardExceptions);
  }
  return exceptions;
};

const normalizeSearchTokens = (query: string): string[] =>
  query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);

const pageSearchText = (page: DatabasePage): string =>
  [
    page.title,
    page.description,
    page.priority ?? "",
    page.estimate ?? "",
    page.assignee ?? "",
    page.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase();

export const listAuthoritativePageOccurrences = (
  database: Database.Database,
  query: ScheduledPageQuery & { readonly searchQuery?: string },
): PageOccurrence[] =>
  database.transaction(() => {
    const pages = readAuthoritativeScheduledPages(database, query);
    const exceptions = readRecurrenceExceptions(
      database,
      pages.map((page) => page.id),
    );
    const tokens = normalizeSearchTokens(query.searchQuery ?? "");
    const occurrences: PageOccurrence[] = [];

    for (const page of pages) {
      if (
        tokens.length > 0 &&
        !tokens.every((token) => pageSearchText(page).includes(token))
      ) {
        continue;
      }

      const expanded = expandPageOccurrences(
        page,
        query.windowStart,
        query.windowEnd,
        { exceptions: [...(exceptions.get(page.id) ?? [])] },
      );
      const firstOccurrenceTimestamp = page.scheduledStart?.getTime() ?? null;
      for (const occurrence of expanded) {
        occurrences.push({
          ...page,
          id: `${page.id}:${occurrence.occurrenceStart.toISOString()}`,
          pageId: page.id,
          statusName: getWorkflowStatusLabel(page.status),
          occurrenceStart: occurrence.occurrenceStart,
          occurrenceEnd: occurrence.occurrenceEnd,
          scheduledStart: occurrence.occurrenceStart,
          scheduledEnd: occurrence.occurrenceEnd,
          reminders: occurrence.reminders,
          isRecurring: Boolean(page.recurrence),
          thisAndFutureEquivalentToAll:
            Boolean(page.recurrence) &&
            firstOccurrenceTimestamp !== null &&
            occurrence.occurrenceStart.getTime() <= firstOccurrenceTimestamp,
        });
      }
    }

    return occurrences.sort(
      (left, right) =>
        left.occurrenceStart.getTime() - right.occurrenceStart.getTime() ||
        left.pageId.localeCompare(right.pageId),
    );
  })();

/** Read due snoozes with title pinned to the current Page Document head. */
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
        page.project_id AS receipt_project_id,
        snooze.page_id,
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
      INNER JOIN projects actor_project
        ON actor_project.id = snooze.project_id
        AND actor_project.lifecycle = 'active'
      INNER JOIN blocks page
        ON page.id = snooze.page_id
        AND page.type = 'page'
        AND page.lifecycle <> 'deleted'
      LEFT JOIN block_documents ownership
        ON ownership.block_id = page.id
        AND ownership.project_id = page.project_id
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

  return rows.filter((row) =>
    authorizeProjectResourceInDatabase(database, {
      projectId: row.project_id,
      resource: { kind: "page", pageId: row.page_id },
      action: "read",
    }).allowed,
  ).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    receiptProjectId: row.receipt_project_id,
    pageId: row.page_id,
    occurrenceStart: row.occurrence_start,
    title: assertCurrentDocument(row, row.page_id).title,
  }));
};
