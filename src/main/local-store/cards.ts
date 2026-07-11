import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  assertUuidV7,
  createUuidV7,
  createUuidV7FromTimestamp,
} from "../../shared/card-id";
import {
  type BlockDropImportInput,
  type BlockDropImportResult,
  type Board,
  type BoardSummary,
  type BoardSummaryColumn,
  type CalendarOccurrence,
  type CardEditorDropInput,
  type CardEditorDropResult,
  type Card,
  type CardCreatePlacement,
  type CardCreateInput,
  type CardInput,
  type CardUpdateField,
  type CardSearchInput,
  type CardSearchResult,
  type CardsDetailsInput,
  type CardSummary,
  type CardUpdateResult,
  type CardOccurrenceActionInput,
  type CardOccurrenceUpdateInput,
  type Column,
  type MoveCardInput,
  type MoveCardToProjectInput,
  type MoveCardToProjectResult,
  type MoveCardsInput,
  type RecurrenceConfig,
  type ReminderConfig,
} from "../../shared/types";
import { summarizeCardDescription } from "../../shared/card-summary";
import { extractPlainText } from "../../shared/nfm";
import {
  DEFAULT_CARD_STATUS,
  type CardStatus,
} from "../../shared/card-status";
import { dbNotifier } from "./notifier";
import { COLUMNS } from "./schema";
import {
  requireProjectId,
  resolveProjectId,
} from "./projects";
import { getDb } from "./database";
import * as historyService from "./history";
import * as descriptionRevisionService from "./description-revisions";
import { assertValidCardInput } from "./card-input-validation";
import {
  nextOccurrenceAfter,
  shiftUntilDateByDays,
  type RecurrenceException,
} from "./recurrence";
import {
  readAuthoritativeCardById,
  readAuthoritativeCardColumn,
  readAuthoritativeCardSummariesByIds,
  readAuthoritativeCardSummaryByDocumentId,
  readAuthoritativeCardSummaryById,
  readAuthoritativeCardSummaryColumn,
  readAuthoritativeCardsByIds,
  readAuthoritativeProjectCardSummaries,
  readAuthoritativeProjectCards,
} from "./card-read-store";
import { searchAuthoritativeCards } from "./card-search-store";
import {
  cloneAuthoritativeCardInTransaction,
  type AuthoritativeCardClonePropertyOverrides,
} from "./authoritative-card-clone";
import { applyAuthoritativeCardSchedulePatchInTransaction } from "./card-schedule-authority";
import {
  persistCardOccurrenceOperation,
  persistCardOccurrenceRejection,
  prepareCardOccurrenceOperation,
  type CardOccurrenceMutationResult,
  type PreparedCardOccurrenceOperation,
} from "./card-occurrence-receipts";
import { AuthoritativeOperationReceiptError } from "./authoritative-operation-receipts";
import { listAuthoritativeCalendarOccurrences } from "./scheduled-card-store";

interface DbCard {
  id: string;
  project_id: string;
  status: CardStatus;
  archived: number;
  title: string;
  description: string;
  description_preview: string;
  description_length: number;
  has_description: number;
  description_read_model_revision: number;
  description_revision_id: number | null;
  priority: string | null;
  estimate: string | null;
  tags: string;
  due_date: string | null;
  assignee: string | null;
  agent_blocked: number;
  agent_status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  is_all_day: number;
  recurrence_json: string | null;
  reminders_json: string;
  schedule_timezone: string | null;
  run_in_target: string;
  run_in_local_path: string | null;
  run_in_base_branch: string | null;
  run_in_worktree_path: string | null;
  run_in_environment_path: string | null;
  revision: number;
  created: string;
  order: number;
}

interface CardReadModelRow {
  id: string;
  project_id: string;
  status: CardStatus;
  archived: number;
  title: string;
  description: string;
  priority: string | null;
  estimate: string | null;
  tags: string;
  assignee: string | null;
  agent_status: string | null;
  revision: number;
}

interface DbRecurrenceException {
  id: number;
  project_id: string;
  card_id: string;
  occurrence_start: string;
  exception_type: "skip" | "override_time";
  override_start: string | null;
  override_end: string | null;
  override_reminders_json: string | null;
  created: string;
}

function normalizeCardIdInput(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return assertUuidV7(normalized);
}

function assertCardIdAvailable(database: Database.Database, id: string): void {
  const existing = database.prepare(`
    SELECT 1 FROM cards WHERE id = ?
    UNION ALL
    SELECT 1 FROM blocks WHERE id = ?
    LIMIT 1
  `).get(id, id);
  if (existing) {
    throw new Error(`Card or Block id already exists: ${id}`);
  }
}

/** Resolve columnId from the database when not provided by the caller. */
function resolveColumnId(
  database: Database.Database,
  projectId: string,
  cardId: string,
  columnId?: CardStatus,
): CardStatus | null {
  if (columnId) return columnId;
  const row = database
    .prepare("SELECT status FROM cards WHERE id = ? AND project_id = ? AND archived = 0")
    .get(cardId, projectId) as { status: CardStatus } | undefined;
  return row?.status ?? null;
}

/**
 * Compatibility mapper for legacy mutation/history paths only.
 *
 * Public Card reads must use card-read-store so a Y.Doc-primary Card can never
 * expose stale title/body fields from the compatibility `cards` row.
 */
function rowToCard(row: DbCard): Card {
  const runInTarget = parseRunInTarget(row.run_in_target);
  return {
    id: row.id,
    status: row.status,
    archived: row.archived === 1,
    title: row.title,
    description: row.description,
    priority: row.priority ? row.priority as Card["priority"] : undefined,
    estimate: row.estimate ? row.estimate as Card["estimate"] : undefined,
    tags: parseTags(row.tags),
    dueDate: row.due_date ? new Date(row.due_date) : undefined,
    scheduledStart: row.scheduled_start ? new Date(row.scheduled_start) : undefined,
    scheduledEnd: row.scheduled_end ? new Date(row.scheduled_end) : undefined,
    isAllDay: row.is_all_day === 1,
    recurrence: parseRecurrence(row.recurrence_json),
    reminders: parseReminders(row.reminders_json),
    scheduleTimezone: row.schedule_timezone || undefined,
    assignee: row.assignee || undefined,
    agentBlocked: row.agent_blocked === 1,
    agentStatus: row.agent_status || undefined,
    runInTarget,
    runInLocalPath: row.run_in_local_path || undefined,
    runInBaseBranch: row.run_in_base_branch || undefined,
    runInWorktreePath: row.run_in_worktree_path || undefined,
    runInEnvironmentPath: row.run_in_environment_path || undefined,
    revision: row.revision,
    created: new Date(row.created),
    order: row.order,
  };
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function buildCardSearchText(row: CardReadModelRow, plainDescription: string): string {
  const text = [
    row.title,
    parseTags(row.tags).join(" "),
    row.assignee ?? "",
    row.agent_status ?? "",
    row.status,
    row.id,
    plainDescription,
  ].join("\n").replace(/\s+/g, " ").trim();
  const splitTokenText = text.replace(/[-_/@.:#]+/g, " ");
  return `${text}\n${splitTokenText}`.replace(/\s+/g, " ").trim();
}

export function readCardSummaryById(
  cardId: string,
  database: Database.Database = getDb(),
): CardSummary | null {
  return readAuthoritativeCardSummaryById(database, cardId);
}

/**
 * Read a bounded set of Card summaries in caller order with one SQL query.
 *
 * Database views and reference projections frequently already have an ordered
 * identity list. Keeping the ordering boundary here avoids both N+1 reads and
 * leaking the Card compatibility tables into every relational read model.
 */
export function readCardSummariesByIds(
  cardIds: readonly string[],
  database: Database.Database = getDb(),
): CardSummary[] {
  return readAuthoritativeCardSummariesByIds(database, cardIds);
}

export interface CardDocumentBoardProjection {
  readonly projectId: string;
  readonly cardId: string;
  readonly status: CardStatus;
  readonly summary: CardSummary;
}

/**
 * Read the board projection for a committed Card Y.Doc head.
 *
 * Card metadata still comes from the relational read model during the staged
 * migration, while collaborative title/body fields must come from the
 * materialization committed atomically with the Document head. Keeping this
 * composition read-only avoids turning `cards.title/description` back into a
 * second content authority.
 */
export function readCardDocumentBoardProjection(
  database: Database.Database,
  documentId: string,
): CardDocumentBoardProjection | null {
  return readAuthoritativeCardSummaryByDocumentId(database, documentId);
}

export function syncCardReadModel(
  database: Database.Database,
  cardId: string,
): CardSummary | null {
  const row = database.prepare(`
    SELECT
      id,
      project_id,
      status,
      archived,
      title,
      description,
      priority,
      estimate,
      tags,
      assignee,
      agent_status,
      revision
    FROM cards
    WHERE id = ?
  `).get(cardId) as CardReadModelRow | undefined;

  if (!row) {
    database.prepare("DELETE FROM card_search_units WHERE card_id = ?").run(cardId);
    return null;
  }

  const descriptionSummary = summarizeCardDescription(row.description);
  const plainDescription = extractPlainText(row.description);
  const indexedAt = Date.now();

  database.prepare(`
    UPDATE cards
    SET
      description_preview = ?,
      description_length = ?,
      has_description = ?,
      description_read_model_revision = ?
    WHERE id = ?
  `).run(
    descriptionSummary.descriptionPreview,
    descriptionSummary.descriptionLength,
    descriptionSummary.hasDescription ? 1 : 0,
    row.revision,
    cardId,
  );

  if (row.archived === 1) {
    database.prepare("DELETE FROM card_search_units WHERE card_id = ?").run(cardId);
    return readCardSummaryById(cardId, database);
  }

  const searchText = buildCardSearchText(row, plainDescription);
  if (!searchText) {
    database.prepare("DELETE FROM card_search_units WHERE card_id = ?").run(cardId);
    return readCardSummaryById(cardId, database);
  }

  database.prepare(`
    INSERT INTO card_search_units (
      project_id,
      card_id,
      status,
      text,
      text_hash,
      card_revision,
      indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      project_id = excluded.project_id,
      status = excluded.status,
      text = excluded.text,
      text_hash = excluded.text_hash,
      card_revision = excluded.card_revision,
      indexed_at = excluded.indexed_at
  `).run(
    row.project_id,
    row.id,
    row.status,
    searchText,
    hashText(searchText),
    row.revision,
    indexedAt,
  );

  return readCardSummaryById(cardId, database);
}

export function backfillCardReadModelBatch(limit = 20): {
  updated: number;
  remaining: number;
} {
  const database = getDb();
  const batchLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const rows = database.prepare(`
    SELECT id, project_id, status
    FROM cards
    WHERE description_read_model_revision <> revision
    ORDER BY created DESC
    LIMIT ?
  `).all(batchLimit) as Array<{ id: string; project_id: string; status: CardStatus }>;

  if (rows.length === 0) {
    const remaining = database.prepare(`
      SELECT COUNT(*) AS count
      FROM cards
      WHERE description_read_model_revision <> revision
    `).get() as { count: number };
    return { updated: 0, remaining: remaining.count };
  }

  database.transaction(() => {
    for (const row of rows) {
      syncCardReadModel(database, row.id);
      dbNotifier.notifyChange(row.project_id, "update", row.status, row.id);
    }
  })();

  const remaining = database.prepare(`
    SELECT COUNT(*) AS count
    FROM cards
    WHERE description_read_model_revision <> revision
  `).get() as { count: number };

  return {
    updated: rows.length,
    remaining: remaining.count,
  };
}

function parseRunInTarget(value: string | null | undefined): Card["runInTarget"] {
  if (value === "local_project") return "localProject";
  if (value === "new_worktree") return "newWorktree";
  if (value === "cloud") return "cloud";
  return "localProject";
}

function resolveCardState(
  database: Database.Database,
  projectId: string,
  cardId: string,
  status?: CardStatus,
): { status: CardStatus; archived: boolean } | null {
  if (status) {
    const row = database
      .prepare("SELECT status, archived FROM cards WHERE id = ? AND project_id = ? AND status = ? AND archived = 0")
      .get(cardId, projectId, status) as { status: CardStatus; archived: number } | undefined;
    if (!row) return null;
    return { status: row.status, archived: row.archived === 1 };
  }

  const row = database
    .prepare("SELECT status, archived FROM cards WHERE id = ? AND project_id = ?")
    .get(cardId, projectId) as { status: CardStatus; archived: number } | undefined;
  if (!row) return null;
  return { status: row.status, archived: row.archived === 1 };
}

function toRunInTargetDbValue(value: CardInput["runInTarget"]): string {
  if (value === "newWorktree") return "new_worktree";
  if (value === "cloud") return "cloud";
  return "local_project";
}

function parseRecurrence(value: string | null): RecurrenceConfig | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as RecurrenceConfig;
  } catch {
    return undefined;
  }
}

function parseReminders(value: string): ReminderConfig[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ReminderConfig => (
      typeof item === "object"
      && item !== null
      && typeof (item as { offsetMinutes?: unknown }).offsetMinutes === "number"
    ));
  } catch {
    return [];
  }
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return [];
  }
}

interface CardUpdateMutation {
  fields: string[];
  values: (string | number | null)[];
  previousValues: CardHistoryValues;
  newValues: CardHistoryValues;
  changedFields: CardUpdateField[];
  descriptionChanged: boolean;
}

type CardHistoryValues = Omit<Partial<Card>, "priority"> & {
  priority?: Card["priority"] | null;
};

function assertValidMoveFieldPatch(fieldPatch: MoveCardInput["fieldPatch"] | MoveCardsInput["fieldPatch"]): void {
  if (!fieldPatch) return;

  const fieldNames = Object.keys(fieldPatch);
  if (fieldNames.some((fieldName) => fieldName !== "priority" && fieldName !== "estimate")) {
    throw new Error("Invalid move fieldPatch");
  }

  assertValidCardInput(fieldPatch, "update");
}

function buildCardUpdateMutation(
  existing: DbCard,
  updates: Partial<CardInput>,
): CardUpdateMutation {
  const previousValues: CardHistoryValues = {};
  const newValues: CardHistoryValues = {};
  const changedFields: CardUpdateField[] = [];
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  let descriptionChanged = false;

  if (updates.title !== undefined) {
    changedFields.push("title");
    fields.push("title = ?");
    values.push(updates.title);
    previousValues.title = existing.title;
    newValues.title = updates.title;
  }
  if (updates.description !== undefined) {
    changedFields.push("description");
    fields.push("description = ?");
    values.push(updates.description);
    descriptionChanged = true;
  }
  if (updates.priority !== undefined) {
    changedFields.push("priority");
    fields.push("priority = ?");
    values.push(updates.priority ?? null);
    previousValues.priority = existing.priority as Card["priority"] | undefined;
    newValues.priority = updates.priority ?? null;
  }
  if (updates.estimate !== undefined) {
    changedFields.push("estimate");
    fields.push("estimate = ?");
    values.push(updates.estimate || null);
    previousValues.estimate = existing.estimate as Card["estimate"] | undefined;
    newValues.estimate = updates.estimate ?? undefined;
  }
  if (updates.tags !== undefined) {
    changedFields.push("tags");
    fields.push("tags = ?");
    values.push(JSON.stringify(updates.tags));
    previousValues.tags = parseTags(existing.tags);
    newValues.tags = updates.tags;
  }
  if (updates.dueDate !== undefined) {
    changedFields.push("dueDate");
    fields.push("due_date = ?");
    values.push(updates.dueDate?.toISOString().split("T")[0] || null);
    previousValues.dueDate = existing.due_date ? new Date(existing.due_date) : undefined;
    newValues.dueDate = updates.dueDate ?? undefined;
  }
  if (updates.scheduledStart !== undefined) {
    changedFields.push("scheduledStart");
    fields.push("scheduled_start = ?");
    values.push(updates.scheduledStart?.toISOString() ?? null);
    previousValues.scheduledStart = existing.scheduled_start ? new Date(existing.scheduled_start) : undefined;
    newValues.scheduledStart = updates.scheduledStart ?? undefined;
  }
  if (updates.scheduledEnd !== undefined) {
    changedFields.push("scheduledEnd");
    fields.push("scheduled_end = ?");
    values.push(updates.scheduledEnd?.toISOString() ?? null);
    previousValues.scheduledEnd = existing.scheduled_end ? new Date(existing.scheduled_end) : undefined;
    newValues.scheduledEnd = updates.scheduledEnd ?? undefined;
  }
  if (updates.isAllDay !== undefined) {
    changedFields.push("isAllDay");
    fields.push("is_all_day = ?");
    values.push(updates.isAllDay ? 1 : 0);
    previousValues.isAllDay = existing.is_all_day === 1;
    newValues.isAllDay = Boolean(updates.isAllDay);
  }
  if (updates.recurrence !== undefined) {
    changedFields.push("recurrence");
    fields.push("recurrence_json = ?");
    values.push(updates.recurrence ? JSON.stringify(updates.recurrence) : null);
    previousValues.recurrence = parseRecurrence(existing.recurrence_json);
    newValues.recurrence = updates.recurrence ?? undefined;
  }
  if (updates.reminders !== undefined) {
    changedFields.push("reminders");
    fields.push("reminders_json = ?");
    values.push(JSON.stringify(updates.reminders));
    previousValues.reminders = parseReminders(existing.reminders_json);
    newValues.reminders = updates.reminders;
  }
  if (updates.scheduleTimezone !== undefined) {
    changedFields.push("scheduleTimezone");
    fields.push("schedule_timezone = ?");
    values.push(updates.scheduleTimezone?.trim() || null);
    previousValues.scheduleTimezone = existing.schedule_timezone || undefined;
    newValues.scheduleTimezone = updates.scheduleTimezone?.trim() || undefined;
  }
  if (updates.assignee !== undefined) {
    changedFields.push("assignee");
    fields.push("assignee = ?");
    values.push(updates.assignee || null);
    previousValues.assignee = existing.assignee || undefined;
    newValues.assignee = updates.assignee;
  }
  if (updates.agentBlocked !== undefined) {
    changedFields.push("agentBlocked");
    fields.push("agent_blocked = ?");
    values.push(updates.agentBlocked ? 1 : 0);
    previousValues.agentBlocked = existing.agent_blocked === 1;
    newValues.agentBlocked = updates.agentBlocked;
  }
  if (updates.agentStatus !== undefined) {
    changedFields.push("agentStatus");
    fields.push("agent_status = ?");
    values.push(updates.agentStatus || null);
    previousValues.agentStatus = existing.agent_status || undefined;
    newValues.agentStatus = updates.agentStatus;
  }
  if (updates.runInTarget !== undefined) {
    changedFields.push("runInTarget");
    fields.push("run_in_target = ?");
    values.push(toRunInTargetDbValue(updates.runInTarget));
    previousValues.runInTarget = parseRunInTarget(existing.run_in_target);
    newValues.runInTarget = updates.runInTarget;
  }
  if (updates.runInLocalPath !== undefined) {
    changedFields.push("runInLocalPath");
    fields.push("run_in_local_path = ?");
    values.push(updates.runInLocalPath?.trim() || null);
    previousValues.runInLocalPath = existing.run_in_local_path || undefined;
    newValues.runInLocalPath = updates.runInLocalPath?.trim() || undefined;
  }
  if (updates.runInBaseBranch !== undefined) {
    changedFields.push("runInBaseBranch");
    fields.push("run_in_base_branch = ?");
    values.push(updates.runInBaseBranch?.trim() || null);
    previousValues.runInBaseBranch = existing.run_in_base_branch || undefined;
    newValues.runInBaseBranch = updates.runInBaseBranch?.trim() || undefined;
  }
  if (updates.runInWorktreePath !== undefined) {
    changedFields.push("runInWorktreePath");
    fields.push("run_in_worktree_path = ?");
    values.push(updates.runInWorktreePath?.trim() || null);
    previousValues.runInWorktreePath = existing.run_in_worktree_path || undefined;
    newValues.runInWorktreePath = updates.runInWorktreePath?.trim() || undefined;
  }
  if (updates.runInEnvironmentPath !== undefined) {
    changedFields.push("runInEnvironmentPath");
    fields.push("run_in_environment_path = ?");
    values.push(updates.runInEnvironmentPath?.trim() || null);
    previousValues.runInEnvironmentPath = existing.run_in_environment_path || undefined;
    newValues.runInEnvironmentPath = updates.runInEnvironmentPath?.trim() || undefined;
  }

  return { fields, values, previousValues, newValues, changedFields, descriptionChanged };
}

function applyMoveFieldPatch(args: {
  database: Database.Database;
  cardRow: DbCard;
  projectId: string;
  status: CardStatus;
  fieldPatch?: MoveCardInput["fieldPatch"] | MoveCardsInput["fieldPatch"];
  sessionId?: string;
  groupId?: string;
}): { cardRow: DbCard; didMutate: boolean } {
  if (!args.fieldPatch) {
    return { cardRow: args.cardRow, didMutate: false };
  }

  const mutation = buildCardUpdateMutation(args.cardRow, args.fieldPatch);
  if (mutation.fields.length === 0) {
    return { cardRow: args.cardRow, didMutate: false };
  }

  mutation.values.push(args.cardRow.id);
  args.database.prepare(
    `UPDATE cards SET ${mutation.fields.join(", ")}, revision = revision + 1 WHERE id = ?`
  ).run(...mutation.values);

  historyService.recordUpdate(
    args.cardRow.id,
    args.projectId,
    args.status,
    mutation.previousValues,
    mutation.newValues,
    null,
    null,
    args.sessionId,
    args.groupId,
  );

  const updatedRow = args.database
    .prepare("SELECT * FROM cards WHERE id = ?")
    .get(args.cardRow.id) as DbCard;

  return {
    cardRow: updatedRow,
    didMutate: true,
  };
}

// === Card CRUD ===

export async function readColumn(projectId: string, columnId: CardStatus): Promise<Column> {
  const canonicalProjectId = requireProjectId(projectId);
  const columnMeta = COLUMNS.find((c) => c.id === columnId);
  if (!columnMeta) throw new Error(`Unknown column: ${columnId}`);

  return {
    id: columnId,
    name: columnMeta.name,
    cards: readAuthoritativeCardColumn(getDb(), canonicalProjectId, columnId),
  };
}

export async function readSummaryColumn(projectId: string, columnId: CardStatus): Promise<BoardSummaryColumn> {
  const canonicalProjectId = requireProjectId(projectId);
  const columnMeta = COLUMNS.find((c) => c.id === columnId);
  if (!columnMeta) throw new Error(`Unknown column: ${columnId}`);

  return {
    id: columnId,
    name: columnMeta.name,
    cards: readAuthoritativeCardSummaryColumn(
      getDb(),
      canonicalProjectId,
      columnId,
    ),
  };
}

export async function getBoard(projectId: string): Promise<Board> {
  const canonicalProjectId = requireProjectId(projectId);
  const cards = readAuthoritativeProjectCards(getDb(), canonicalProjectId);
  const columns = COLUMNS.map((column) => ({
    id: column.id,
    name: column.name,
    cards: cards.filter((card) => card.status === column.id),
  }));
  return { columns };
}

export async function getBoardSummary(projectId: string): Promise<BoardSummary> {
  const canonicalProjectId = requireProjectId(projectId);
  const cards = readAuthoritativeProjectCardSummaries(
    getDb(),
    canonicalProjectId,
  );
  const columns = COLUMNS.map((column) => ({
    id: column.id,
    name: column.name,
    cards: cards.filter((card) => card.status === column.id),
  }));
  return { columns };
}

export async function getCardsDetails(projectId: string, input: CardsDetailsInput): Promise<Card[]> {
  const canonicalProjectId = requireProjectId(projectId);
  const uniqueCardIds = Array.from(new Set(input.cardIds.map((cardId) => cardId.trim()).filter(Boolean)));
  if (uniqueCardIds.length === 0) return [];
  return readAuthoritativeCardsByIds(getDb(), canonicalProjectId, uniqueCardIds);
}

export async function searchCards(input: CardSearchInput): Promise<CardSearchResult[]> {
  return searchAuthoritativeCards(getDb(), {
    ...input,
    projectIds: Array.from(new Set(input.projectIds.map(requireProjectId))),
  });
}

export async function createCard(
  projectId: string,
  columnId: CardStatus,
  input: CardCreateInput,
  sessionId?: string,
  placement: CardCreatePlacement = "bottom",
): Promise<Card> {
  const canonicalProjectId = requireProjectId(projectId);
  assertValidCardInput(input, "create");

  const database = getDb();
  const requestedId = normalizeCardIdInput(input.id);
  const id = requestedId ?? createUuidV7();
  const now = new Date();
  const nowIso = now.toISOString();

  const card = database.transaction(() => {
    if (requestedId) {
      assertCardIdAvailable(database, requestedId);
    }

    const order = (() => {
      if (placement === "top") {
        database
          .prepare(
            `UPDATE cards SET "order" = "order" + 1
             WHERE project_id = ? AND archived = 0 AND status = ?`,
          )
          .run(canonicalProjectId, columnId);
        return 0;
      }

      const maxOrderRow = database
        .prepare('SELECT MAX("order") as maxOrder FROM cards WHERE project_id = ? AND archived = 0 AND status = ?')
        .get(canonicalProjectId, columnId) as { maxOrder: number | null } | undefined;
      return (maxOrderRow?.maxOrder ?? -1) + 1;
    })();
    const descriptionRevisionId = descriptionRevisionService.createInitialDescriptionRevision(
      database,
      id,
      input.description || "",
      nowIso,
    );

    database.prepare(`
      INSERT INTO cards (
        id, project_id, status, archived, title, description, description_revision_id, priority, estimate,
        tags, due_date, scheduled_start, scheduled_end, is_all_day, recurrence_json, reminders_json, schedule_timezone,
        assignee, agent_blocked, agent_status, run_in_target, run_in_local_path, run_in_base_branch, run_in_worktree_path, run_in_environment_path, created, "order"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      canonicalProjectId,
      columnId,
      0,
      input.title,
      input.description || "",
      descriptionRevisionId,
      input.priority ?? null,
      input.estimate || null,
      JSON.stringify(input.tags || []),
      input.dueDate?.toISOString().split("T")[0] || null,
      input.scheduledStart?.toISOString() ?? null,
      input.scheduledEnd?.toISOString() ?? null,
      input.isAllDay ? 1 : 0,
      input.recurrence ? JSON.stringify(input.recurrence) : null,
      JSON.stringify(input.reminders ?? []),
      input.scheduleTimezone?.trim() || null,
      input.assignee || null,
      input.agentBlocked ? 1 : 0,
      input.agentStatus || null,
      toRunInTargetDbValue(input.runInTarget),
      input.runInLocalPath?.trim() || null,
      input.runInBaseBranch?.trim() || null,
      input.runInWorktreePath?.trim() || null,
      input.runInEnvironmentPath?.trim() || null,
      nowIso,
      order
    );

    const result: Card = {
      id,
      status: input.status ?? columnId,
      archived: false,
      title: input.title,
      description: input.description || "",
      priority: input.priority ?? undefined,
      estimate: input.estimate ?? undefined,
      tags: input.tags || [],
      dueDate: input.dueDate ?? undefined,
      scheduledStart: input.scheduledStart ?? undefined,
      scheduledEnd: input.scheduledEnd ?? undefined,
      isAllDay: Boolean(input.isAllDay),
      recurrence: input.recurrence ?? undefined,
      reminders: input.reminders ?? [],
      scheduleTimezone: input.scheduleTimezone ?? undefined,
      assignee: input.assignee,
      agentBlocked: input.agentBlocked ?? false,
      agentStatus: input.agentStatus,
      runInTarget: input.runInTarget ?? "localProject",
      runInLocalPath: input.runInLocalPath?.trim() || undefined,
      runInBaseBranch: input.runInBaseBranch?.trim() || undefined,
      runInWorktreePath: input.runInWorktreePath?.trim() || undefined,
      runInEnvironmentPath: input.runInEnvironmentPath?.trim() || undefined,
      revision: 1,
      created: now,
      order,
    };

    historyService.clearRedoStack(canonicalProjectId, sessionId);
    historyService.recordCreate(
      result,
      canonicalProjectId,
      columnId,
      descriptionRevisionId,
      sessionId,
    );

    syncCardReadModel(database, id);

    return result;
  })();

  dbNotifier.notifyChange(canonicalProjectId, "create", columnId, id);

  return card;
}

export async function updateCard(
  projectId: string,
  columnId: CardStatus | undefined,
  cardId: string,
  updates: Partial<CardInput>,
  sessionId?: string,
  expectedRevision?: number,
): Promise<CardUpdateResult> {
  const canonicalProjectId = requireProjectId(projectId);
  assertValidCardInput(updates, "update");
  const database = getDb();

  const result = database.transaction(() => {
    const resolvedState = resolveCardState(database, canonicalProjectId, cardId, columnId);
    if (!resolvedState || resolvedState.archived) {
      return { status: "not_found" } as const;
    }

    const existing = database
      .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
      .get(cardId, canonicalProjectId, resolvedState.status) as DbCard | undefined;

    if (!existing) {
      return { status: "not_found" } as const;
    }

    if (
      Number.isInteger(expectedRevision)
      && typeof expectedRevision === "number"
      && expectedRevision !== existing.revision
    ) {
      return {
        status: "conflict",
        card: rowToCard(existing),
      } as const;
    }

    const {
      fields,
      values,
      previousValues,
      newValues,
      changedFields,
      descriptionChanged,
    } = buildCardUpdateMutation(existing, updates);

    let didMutate = false;
    if (fields.length > 0) {
      didMutate = true;
      let previousDescriptionRevisionId: number | null = null;
      let newDescriptionRevisionId: number | null = null;
      if (descriptionChanged) {
        previousDescriptionRevisionId = existing.description_revision_id;
        newDescriptionRevisionId = existing.description_revision_id
          ? descriptionRevisionService.createNextDescriptionRevision(
            database,
            cardId,
            existing.description_revision_id,
            updates.description ?? "",
            new Date().toISOString(),
          )
          : descriptionRevisionService.createInitialDescriptionRevision(
            database,
            cardId,
            updates.description ?? "",
            new Date().toISOString(),
          );
        fields.push("description_revision_id = ?");
        values.push(newDescriptionRevisionId);
      }
      values.push(cardId);
      database.prepare(
        `UPDATE cards SET ${fields.join(", ")}, revision = revision + 1 WHERE id = ?`
      ).run(...values);

      historyService.clearRedoStack(canonicalProjectId, sessionId);
      historyService.recordUpdate(
        cardId,
        canonicalProjectId,
        resolvedState.status,
        previousValues,
        newValues,
        previousDescriptionRevisionId,
        newDescriptionRevisionId,
        sessionId,
      );
    }

    const updatedSummary = didMutate
      ? syncCardReadModel(database, cardId)
      : readCardSummaryById(cardId, database);

    if (!updatedSummary) {
      throw new Error(`Updated Card ${cardId} has no authoritative summary`);
    }

    return {
      status: "updated",
      projectId: canonicalProjectId,
      cardId,
      revision: updatedSummary.revision ?? existing.revision + (didMutate ? 1 : 0),
      summary: updatedSummary,
      changedFields,
      didMutate,
    } as const;
  })();

  if (result.status !== "updated") {
    return result;
  }

  if (result.didMutate) {
    dbNotifier.notifyChange(canonicalProjectId, "update", result.summary.status, cardId);
  }

  return {
    status: "updated",
    projectId: result.projectId,
    cardId: result.cardId,
    revision: result.revision,
    summary: result.summary,
    changedFields: result.changedFields,
    didMutate: result.didMutate,
  };
}

export async function deleteCard(
  projectId: string,
  columnId: CardStatus | undefined,
  cardId: string,
  sessionId?: string
): Promise<boolean> {
  const canonicalProjectId = requireProjectId(projectId);
  const database = getDb();

  const result = database.transaction(() => {
    const resolvedState = resolveCardState(database, canonicalProjectId, cardId, columnId);
    if (!resolvedState || resolvedState.archived) return null;

    const cardRow = database
      .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
      .get(cardId, canonicalProjectId, resolvedState.status) as DbCard | undefined;

    if (!cardRow) return null;

    const card = rowToCard(cardRow);

    database.prepare("DELETE FROM cards WHERE id = ?").run(cardId);

    database
      .prepare(
        `UPDATE cards SET "order" = "order" - 1 WHERE project_id = ? AND archived = 0 AND status = ? AND "order" > ?`
      )
      .run(canonicalProjectId, resolvedState.status, cardRow.order);

    historyService.clearRedoStack(canonicalProjectId, sessionId);
    historyService.recordDelete(
      card,
      canonicalProjectId,
      resolvedState.status,
      cardRow.description_revision_id,
      sessionId,
    );

    return resolvedState.status;
  })();

  if (!result) return false;

  dbNotifier.notifyChange(canonicalProjectId, "delete", result, cardId);
  return true;
}

export interface MoveCardInputWithSession extends MoveCardInput {
  projectId: string;
  sessionId?: string;
}

export interface MoveCardsInputWithSession extends MoveCardsInput {
  projectId: string;
  sessionId?: string;
}

export interface MoveCardToProjectInputWithSession extends MoveCardToProjectInput {
  sessionId?: string;
}

function clampOrderIndex(value: number, max: number): number {
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

const columnOrderIndex = new Map(
  COLUMNS.map((column, index) => [column.id, index]),
);

function compareCardsByBoardPosition(left: DbCard, right: DbCard): number {
  const leftIndex = columnOrderIndex.get(left.status) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = columnOrderIndex.get(right.status) ?? Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  if (left.order !== right.order) return left.order - right.order;
  return left.id.localeCompare(right.id);
}

function listOrderedColumnCards(
  database: Database.Database,
  projectId: string,
  columnId: CardStatus,
): DbCard[] {
  return database
    .prepare(
      `SELECT * FROM cards
       WHERE project_id = ? AND archived = 0 AND status = ?
       ORDER BY "order" ASC`,
    )
    .all(projectId, columnId) as DbCard[];
}

function rewriteColumnOrdering(
  database: Database.Database,
  cards: readonly DbCard[],
  columnId: CardStatus,
): void {
  const updateCardPosition = database.prepare(
    'UPDATE cards SET status = ?, archived = 0, "order" = ? WHERE id = ?',
  );

  cards.forEach((card, index) => {
    if (card.status === columnId && card.archived === 0 && card.order === index) return;
    updateCardPosition.run(columnId, index, card.id);
  });
}

function readCardRowsByIds(
  database: Database.Database,
  projectId: string,
  cardIds: readonly string[],
): DbCard[] {
  if (cardIds.length === 0) return [];

  const placeholders = cardIds.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT * FROM cards
       WHERE project_id = ? AND archived = 0 AND id IN (${placeholders})`,
    )
    .all(projectId, ...cardIds) as DbCard[];
}

export async function moveCard(input: MoveCardInputWithSession): Promise<"moved" | "not_found" | "wrong_column"> {
  input = { ...input, projectId: requireProjectId(input.projectId) };
  const database = getDb();
  assertValidMoveFieldPatch(input.fieldPatch);

  const result = database.transaction(() => {
    // Resolve fromStatus — either explicitly provided (atomic claim) or auto-resolved
    let fromStatus: CardStatus;
    let card: DbCard | undefined;

    if (input.fromStatus) {
      // Atomic claim: assert card is still in the expected column
      card = database
        .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
        .get(input.cardId, input.projectId, input.fromStatus) as DbCard | undefined;

      if (!card) {
        // Distinguish: card doesn't exist vs card moved to different column
        const exists = database
          .prepare("SELECT 1 FROM cards WHERE id = ? AND project_id = ?")
          .get(input.cardId, input.projectId);
        return exists ? "wrong_column" : "not_found";
      }

      fromStatus = input.fromStatus;
    } else {
      // Auto-resolve column
      const resolved = resolveColumnId(database, input.projectId, input.cardId);
      if (!resolved) return "not_found";
      fromStatus = resolved;

      card = database
        .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
        .get(input.cardId, input.projectId, fromStatus) as DbCard | undefined;

      if (!card) return "not_found";
    }

    const groupId = input.groupId ?? randomUUID();
    historyService.clearRedoStack(input.projectId, input.sessionId);

    const patchedCard = applyMoveFieldPatch({
      database,
      cardRow: card,
      projectId: input.projectId,
      status: fromStatus,
      fieldPatch: input.fieldPatch,
      sessionId: input.sessionId,
      groupId,
    });
    const currentOrder = patchedCard.cardRow.order;

    // Resolve newOrder: undefined means append to end of target column
    const newOrder = input.newOrder ?? (() => {
      const row = database
        .prepare('SELECT MAX("order") as maxOrder FROM cards WHERE project_id = ? AND archived = 0 AND status = ?')
        .get(input.projectId, input.toStatus) as { maxOrder: number | null } | undefined;
      const max = row?.maxOrder ?? -1;
      // If moving within the same column, the card itself is counted in MAX — end position is max (not max+1)
      if (fromStatus === input.toStatus) return max;
      return max + 1;
    })();

    const didMove = fromStatus !== input.toStatus || newOrder !== currentOrder;
    if (!didMove) {
      return {
        movedFromColumnId: fromStatus,
        didMove: false,
        didPatch: patchedCard.didMutate,
      };
    }

    if (fromStatus === input.toStatus) {
      if (newOrder > currentOrder) {
        database
          .prepare(
            `UPDATE cards SET "order" = "order" - 1
             WHERE project_id = ? AND archived = 0 AND status = ? AND "order" > ? AND "order" <= ?`
          )
          .run(input.projectId, fromStatus, currentOrder, newOrder);
      } else if (newOrder < currentOrder) {
        database
          .prepare(
            `UPDATE cards SET "order" = "order" + 1
             WHERE project_id = ? AND archived = 0 AND status = ? AND "order" >= ? AND "order" < ?`
          )
          .run(input.projectId, fromStatus, newOrder, currentOrder);
      }
      database
        .prepare('UPDATE cards SET "order" = ? WHERE id = ?')
        .run(newOrder, input.cardId);
    } else {
      database
        .prepare(
          `UPDATE cards SET "order" = "order" - 1
           WHERE project_id = ? AND archived = 0 AND status = ? AND "order" > ?`
        )
        .run(input.projectId, fromStatus, currentOrder);

      database
        .prepare(
          `UPDATE cards SET "order" = "order" + 1
           WHERE project_id = ? AND archived = 0 AND status = ? AND "order" >= ?`
        )
        .run(input.projectId, input.toStatus, newOrder);

      database
        .prepare('UPDATE cards SET status = ?, archived = 0, "order" = ? WHERE id = ?')
        .run(input.toStatus, newOrder, input.cardId);
    }

    historyService.recordMove(
      input.cardId,
      input.projectId,
      fromStatus,
      input.toStatus,
      currentOrder,
      newOrder,
      input.sessionId,
      groupId,
    );

    return {
      movedFromColumnId: fromStatus,
      didMove: true,
      didPatch: patchedCard.didMutate,
    };
  })();

  // Error results are strings
  if (typeof result === "string") return result;

  if (result.didMove) {
    dbNotifier.notifyChange(input.projectId, "move", input.toStatus, input.cardId);
    if (result.movedFromColumnId !== input.toStatus) {
      dbNotifier.notifyChange(input.projectId, "move", result.movedFromColumnId, input.cardId);
    }
  } else if (result.didPatch) {
    dbNotifier.notifyChange(input.projectId, "update", result.movedFromColumnId, input.cardId);
  }

  return "moved";
}

export async function moveCards(
  input: MoveCardsInputWithSession,
): Promise<"moved" | "not_found" | "wrong_column"> {
  input = { ...input, projectId: requireProjectId(input.projectId) };
  if (!Array.isArray(input.cardIds) || input.cardIds.length === 0) {
    throw new Error("cardIds must be a non-empty array");
  }

  const uniqueCardIds = Array.from(new Set(input.cardIds));
  if (uniqueCardIds.length !== input.cardIds.length) {
    throw new Error("cardIds must be unique");
  }

  const database = getDb();
  assertValidMoveFieldPatch(input.fieldPatch);

  const result = database.transaction(() => {
    let selectedCards: DbCard[];

    if (input.fromStatus) {
      const sourceCards = listOrderedColumnCards(database, input.projectId, input.fromStatus);
      const sourceCardIdSet = new Set(sourceCards.map((card) => card.id));
      const missingCardId = uniqueCardIds.find((cardId) => !sourceCardIdSet.has(cardId));

      if (missingCardId) {
        const exists = database
          .prepare("SELECT 1 FROM cards WHERE id = ? AND project_id = ?")
          .get(missingCardId, input.projectId);
        return exists ? "wrong_column" : "not_found";
      }

      const selectedCardIdSet = new Set(uniqueCardIds);
      selectedCards = sourceCards.filter((card) => selectedCardIdSet.has(card.id));
    } else {
      const rows = readCardRowsByIds(database, input.projectId, uniqueCardIds);
      if (rows.length !== uniqueCardIds.length) {
        return "not_found";
      }
      selectedCards = [...rows].sort(compareCardsByBoardPosition);
    }

    if (selectedCards.length === 0) {
      return "not_found";
    }

    const selectedCardIdSet = new Set(selectedCards.map((card) => card.id));
    const cardsByColumn = new Map<CardStatus, DbCard[]>();

    for (const columnId of new Set([input.toStatus, ...selectedCards.map((card) => card.status)])) {
      cardsByColumn.set(
        columnId as CardStatus,
        listOrderedColumnCards(database, input.projectId, columnId),
      );
    }

    const targetCards = cardsByColumn.get(input.toStatus) ?? [];
    const remainingTargetCards = targetCards.filter((card) => !selectedCardIdSet.has(card.id));
    const insertIndex = clampOrderIndex(
      input.newOrder ?? remainingTargetCards.length,
      remainingTargetCards.length,
    );

    const groupId = input.groupId ?? randomUUID();
    historyService.clearRedoStack(input.projectId, input.sessionId);

    const patchedSelectedCards = selectedCards.map((card) =>
      applyMoveFieldPatch({
        database,
        cardRow: card,
        projectId: input.projectId,
        status: card.status,
        fieldPatch: input.fieldPatch,
        sessionId: input.sessionId,
        groupId,
      }),
    );
    const nextSelectedCards = patchedSelectedCards.map((entry) => entry.cardRow);
    const patchedCardIds = patchedSelectedCards
      .filter((entry) => entry.didMutate)
      .map((entry) => entry.cardRow.id);

    const reorderedTargetCards = [...remainingTargetCards];
    reorderedTargetCards.splice(insertIndex, 0, ...nextSelectedCards);
    const movedCards = nextSelectedCards.map((card) => ({
      id: card.id,
      fromStatus: card.status,
      fromOrder: card.order,
      toOrder: reorderedTargetCards.findIndex((candidate) => candidate.id === card.id),
    }));
    const didMove = movedCards.some((card) =>
      card.fromStatus !== input.toStatus || card.fromOrder !== card.toOrder
    );

    if (!didMove && patchedCardIds.length === 0) {
      return {
        movedCards: [] as typeof movedCards,
        patchedCardIds: [] as string[],
      };
    }

    if (didMove) {
      for (const [columnId, columnCards] of cardsByColumn) {
        if (columnId === input.toStatus) continue;
        rewriteColumnOrdering(
          database,
          columnCards.filter((card) => !selectedCardIdSet.has(card.id)),
          columnId,
        );
      }
      rewriteColumnOrdering(database, reorderedTargetCards, input.toStatus);
    }

    if (didMove) {
      [...movedCards].reverse().forEach((card) => {
        historyService.recordMove(
          card.id,
          input.projectId,
          card.fromStatus,
          input.toStatus,
          card.fromOrder,
          card.toOrder,
          input.sessionId,
          groupId,
        );
      });
    }

    return {
      movedCards,
      patchedCardIds,
    };
  })();

  if (typeof result === "string") return result;

  if (result.movedCards.length > 0) {
    result.movedCards.forEach((card) => {
      dbNotifier.notifyChange(input.projectId, "move", input.toStatus, card.id);
      if (card.fromStatus !== input.toStatus) {
        dbNotifier.notifyChange(input.projectId, "move", card.fromStatus, card.id);
      }
    });
  } else {
    result.patchedCardIds.forEach((cardId) => {
      const card = database
        .prepare("SELECT status FROM cards WHERE id = ? AND project_id = ?")
        .get(cardId, input.projectId) as { status: CardStatus } | undefined;
      if (!card) return;
      dbNotifier.notifyChange(input.projectId, "update", card.status, cardId);
    });
  }

  return "moved";
}

export async function moveCardToProject(
  input: MoveCardToProjectInputWithSession,
): Promise<MoveCardToProjectResult | "not_found" | "wrong_column" | "target_project_not_found"> {
  const targetProjectId = resolveProjectId(input.targetProjectId);
  if (!targetProjectId) return "target_project_not_found";
  input = {
    ...input,
    sourceProjectId: requireProjectId(input.sourceProjectId),
    targetProjectId,
  };
  if (input.sourceProjectId === input.targetProjectId) {
    throw new Error("Target project must be different from source project");
  }

  const database = getDb();
  const result = database.transaction(() => {
    const targetProject = database
      .prepare("SELECT 1 FROM projects WHERE id = ?")
      .get(input.targetProjectId);
    if (!targetProject) return "target_project_not_found";

    let sourceCard: DbCard | undefined;
    let sourceStatus: CardStatus;

    if (input.sourceStatus) {
      sourceCard = database
        .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
        .get(input.cardId, input.sourceProjectId, input.sourceStatus) as DbCard | undefined;

      if (!sourceCard) {
        const exists = database
          .prepare("SELECT 1 FROM cards WHERE id = ? AND project_id = ?")
          .get(input.cardId, input.sourceProjectId);
        return exists ? "wrong_column" : "not_found";
      }

      sourceStatus = input.sourceStatus;
    } else {
      const resolvedColumnId = resolveColumnId(database, input.sourceProjectId, input.cardId);
      if (!resolvedColumnId) return "not_found";

      sourceCard = database
        .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
        .get(input.cardId, input.sourceProjectId, resolvedColumnId) as DbCard | undefined;
      if (!sourceCard) return "not_found";

      sourceStatus = resolvedColumnId;
    }

    const targetStatus = input.targetStatus ?? sourceStatus;
    const isKnownTargetColumn = COLUMNS.some((column) => column.id === targetStatus);
    if (!isKnownTargetColumn) {
      throw new Error(`Unknown column: ${targetStatus}`);
    }

    const maxOrderRow = database
      .prepare('SELECT MAX("order") as maxOrder FROM cards WHERE project_id = ? AND archived = 0 AND status = ?')
      .get(input.targetProjectId, targetStatus) as { maxOrder: number | null } | undefined;
    const targetOrder = (maxOrderRow?.maxOrder ?? -1) + 1;

    database
      .prepare(
        `UPDATE cards
         SET project_id = ?, status = ?, archived = 0, "order" = ?
         WHERE id = ? AND project_id = ?`,
      )
      .run(
        input.targetProjectId,
        targetStatus,
        targetOrder,
        input.cardId,
        input.sourceProjectId,
      );

    database
      .prepare(
        `UPDATE cards SET "order" = "order" - 1
         WHERE project_id = ? AND archived = 0 AND status = ? AND "order" > ?`,
      )
      .run(input.sourceProjectId, sourceStatus, sourceCard.order);

    [
      "recurrence_exceptions",
      "reminder_receipts",
      "reminder_snoozes",
    ].forEach((tableName) => {
      database
        .prepare(`UPDATE ${tableName} SET project_id = ? WHERE project_id = ? AND card_id = ?`)
        .run(input.targetProjectId, input.sourceProjectId, input.cardId);
    });

    return {
      cardId: input.cardId,
      sourceProjectId: input.sourceProjectId,
      sourceStatus: sourceStatus,
      targetProjectId: input.targetProjectId,
      targetStatus: targetStatus,
    };
  })();

  if (typeof result === "string") return result;

  dbNotifier.notifyChange(result.sourceProjectId, "delete", result.sourceStatus, result.cardId);
  dbNotifier.notifyChange(result.targetProjectId, "create", result.targetStatus, result.cardId);

  return result;
}

interface AppliedSourceUpdate {
  projectId: string;
  columnId: CardStatus;
  cardId: string;
}

export async function importBlockDropAsCards(
  projectId: string,
  input: BlockDropImportInput,
  sessionId?: string,
): Promise<BlockDropImportResult> {
  projectId = requireProjectId(projectId);
  if (!Array.isArray(input.cards)) {
    throw new Error("cards must be an array");
  }

  if (!Array.isArray(input.sourceUpdates)) {
    throw new Error("sourceUpdates must be an array");
  }
  input = {
    ...input,
    sourceUpdates: input.sourceUpdates.map((update) => ({
      ...update,
      projectId: requireProjectId(update.projectId),
    })),
  };
  if (input.cards.length === 0 && input.sourceUpdates.length === 0) {
    throw new Error("At least one card or source update is required");
  }

  if (!Number.isInteger(input.insertIndex ?? 0) || (input.insertIndex ?? 0) < 0) {
    throw new Error("insertIndex must be a non-negative integer");
  }

  const targetColumn = COLUMNS.find((column) => column.id === input.targetStatus);
  if (!targetColumn) {
    throw new Error(`Unknown status: ${input.targetStatus}`);
  }

  for (const card of input.cards) {
    assertValidCardInput(card, "create");
  }
  for (const sourceUpdate of input.sourceUpdates) {
    assertValidCardInput(sourceUpdate.updates, "update");
  }

  const database = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const groupId = input.groupId || randomUUID();
  const touchedProjects = new Set<string>([
    projectId,
    ...input.sourceUpdates.map((update) => update.projectId),
  ]);

  const appliedSourceUpdates: AppliedSourceUpdate[] = [];
  const createdCards: Card[] = [];

  database.transaction(() => {
    for (const touchedProjectId of touchedProjects) {
      historyService.clearRedoStack(touchedProjectId, sessionId);
    }

    for (const sourceUpdate of input.sourceUpdates) {
      const resolvedColumnId = resolveColumnId(
        database,
        sourceUpdate.projectId,
        sourceUpdate.cardId,
        sourceUpdate.status,
      );
      if (!resolvedColumnId) {
        throw new Error(`Card not found: ${sourceUpdate.cardId}`);
      }

      const existing = database
        .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
        .get(
          sourceUpdate.cardId,
          sourceUpdate.projectId,
          resolvedColumnId,
        ) as DbCard | undefined;

      if (!existing) {
        throw new Error(`Card not found: ${sourceUpdate.cardId}`);
      }

      const mutation = buildCardUpdateMutation(existing, sourceUpdate.updates);
      if (mutation.fields.length === 0) continue;

      let previousDescriptionRevisionId: number | null = null;
      let newDescriptionRevisionId: number | null = null;
      if (mutation.descriptionChanged) {
        previousDescriptionRevisionId = existing.description_revision_id;
        newDescriptionRevisionId = existing.description_revision_id
          ? descriptionRevisionService.createNextDescriptionRevision(
            database,
            sourceUpdate.cardId,
            existing.description_revision_id,
            sourceUpdate.updates.description ?? "",
            nowIso,
          )
          : descriptionRevisionService.createInitialDescriptionRevision(
            database,
            sourceUpdate.cardId,
            sourceUpdate.updates.description ?? "",
            nowIso,
          );
        mutation.fields.push("description_revision_id = ?");
        mutation.values.push(newDescriptionRevisionId);
      }

      mutation.values.push(sourceUpdate.cardId);
      database
        .prepare(`UPDATE cards SET ${mutation.fields.join(", ")}, revision = revision + 1 WHERE id = ?`)
        .run(...mutation.values);

      historyService.recordUpdate(
        sourceUpdate.cardId,
        sourceUpdate.projectId,
        resolvedColumnId,
        mutation.previousValues,
        mutation.newValues,
        previousDescriptionRevisionId,
        newDescriptionRevisionId,
        sessionId,
        groupId,
      );

      appliedSourceUpdates.push({
        projectId: sourceUpdate.projectId,
        columnId: resolvedColumnId,
        cardId: sourceUpdate.cardId,
      });
    }

    const maxOrderRow = database
      .prepare('SELECT MAX("order") as maxOrder FROM cards WHERE project_id = ? AND archived = 0 AND status = ?')
      .get(projectId, input.targetStatus) as { maxOrder: number | null } | undefined;
    const maxOrder = maxOrderRow?.maxOrder ?? -1;
    const insertIndex = Math.min(input.insertIndex ?? maxOrder + 1, maxOrder + 1);

    database
      .prepare(
        `UPDATE cards SET "order" = "order" + ?
         WHERE project_id = ? AND archived = 0 AND status = ? AND "order" >= ?`
      )
      .run(input.cards.length, projectId, input.targetStatus, insertIndex);

    for (const [offset, cardInput] of input.cards.entries()) {
      const requestedId = normalizeCardIdInput(cardInput.id);
      const id = requestedId ?? createUuidV7();
      if (requestedId) {
        assertCardIdAvailable(database, requestedId);
      }
      const order = insertIndex + offset;
      const descriptionRevisionId = descriptionRevisionService.createInitialDescriptionRevision(
        database,
        id,
        cardInput.description || "",
        nowIso,
      );

      database.prepare(`
        INSERT INTO cards (
          id, project_id, status, archived, title, description, description_revision_id, priority, estimate,
          tags, due_date, scheduled_start, scheduled_end, is_all_day, recurrence_json, reminders_json, schedule_timezone,
          assignee, agent_blocked, agent_status, run_in_target, run_in_local_path, run_in_base_branch, run_in_worktree_path, run_in_environment_path, created, "order"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        input.targetStatus,
        0,
        cardInput.title,
        cardInput.description || "",
        descriptionRevisionId,
        cardInput.priority ?? null,
        cardInput.estimate || null,
        JSON.stringify(cardInput.tags || []),
        cardInput.dueDate?.toISOString().split("T")[0] || null,
        cardInput.scheduledStart?.toISOString() ?? null,
        cardInput.scheduledEnd?.toISOString() ?? null,
        cardInput.isAllDay ? 1 : 0,
        cardInput.recurrence ? JSON.stringify(cardInput.recurrence) : null,
        JSON.stringify(cardInput.reminders ?? []),
        cardInput.scheduleTimezone?.trim() || null,
        cardInput.assignee || null,
        cardInput.agentBlocked ? 1 : 0,
        cardInput.agentStatus || null,
        toRunInTargetDbValue(cardInput.runInTarget),
        cardInput.runInLocalPath?.trim() || null,
        cardInput.runInBaseBranch?.trim() || null,
        cardInput.runInWorktreePath?.trim() || null,
        cardInput.runInEnvironmentPath?.trim() || null,
        nowIso,
        order,
      );

      const createdCard: Card = {
        id,
        status: cardInput.status ?? input.targetStatus,
        archived: false,
        title: cardInput.title,
        description: cardInput.description || "",
        priority: cardInput.priority ?? undefined,
        estimate: cardInput.estimate ?? undefined,
        tags: cardInput.tags || [],
        dueDate: cardInput.dueDate ?? undefined,
        scheduledStart: cardInput.scheduledStart ?? undefined,
        scheduledEnd: cardInput.scheduledEnd ?? undefined,
        isAllDay: Boolean(cardInput.isAllDay),
        recurrence: cardInput.recurrence ?? undefined,
        reminders: cardInput.reminders ?? [],
        scheduleTimezone: cardInput.scheduleTimezone ?? undefined,
        assignee: cardInput.assignee,
        agentBlocked: cardInput.agentBlocked ?? false,
        agentStatus: cardInput.agentStatus,
        runInTarget: cardInput.runInTarget ?? "localProject",
        runInLocalPath: cardInput.runInLocalPath?.trim() || undefined,
        runInBaseBranch: cardInput.runInBaseBranch?.trim() || undefined,
        runInWorktreePath: cardInput.runInWorktreePath?.trim() || undefined,
        runInEnvironmentPath: cardInput.runInEnvironmentPath?.trim() || undefined,
        revision: 1,
        created: now,
        order,
      };

      historyService.recordCreate(
        createdCard,
        projectId,
        input.targetStatus,
        descriptionRevisionId,
        sessionId,
        groupId,
      );

      createdCards.push(createdCard);
    }
  })();

  for (const update of appliedSourceUpdates) {
    dbNotifier.notifyChange(update.projectId, "update", update.columnId, update.cardId);
  }
  for (const card of createdCards) {
    dbNotifier.notifyChange(projectId, "create", input.targetStatus, card.id);
  }

  return {
    cards: createdCards,
    groupId,
  };
}

interface AppliedTargetDescriptionUpdate {
  columnId: CardStatus;
  cardId: string;
}

export async function applyCardEditorDrop(
  projectId: string,
  input: CardEditorDropInput,
  sessionId?: string,
): Promise<CardEditorDropResult> {
  projectId = requireProjectId(projectId);
  if (input.operation !== "move" && input.operation !== "copy") {
    throw new Error("Editor drop operation must be move or copy");
  }
  const sourceProjectId = typeof input.sourceProjectId === "string"
    && input.sourceProjectId.length > 0
    ? requireProjectId(input.sourceProjectId)
    : projectId;

  if (!Array.isArray(input.sourceCards) || input.sourceCards.length === 0) {
    throw new Error("At least one source card is required");
  }
  const sourceCards = input.sourceCards;
  const uniqueSourceCardIds = Array.from(new Set(sourceCards.map((source) => source.cardId)));
  if (uniqueSourceCardIds.length !== sourceCards.length) {
    throw new Error("source cards must be unique");
  }

  if (!Array.isArray(input.targetUpdates) || input.targetUpdates.length === 0) {
    throw new Error("At least one target update is required");
  }
  input = {
    ...input,
    targetUpdates: input.targetUpdates.map((targetUpdate) => ({
      ...targetUpdate,
      projectId: requireProjectId(targetUpdate.projectId),
    })),
  };

  for (const targetUpdate of input.targetUpdates) {
    if (targetUpdate.projectId !== projectId) {
      throw new Error("Cross-project drops are not supported");
    }
    if (sourceProjectId === projectId && uniqueSourceCardIds.includes(targetUpdate.cardId)) {
      throw new Error("Cannot drop a card into itself");
    }
    assertValidCardInput(targetUpdate.updates, "update");
  }

  const database = getDb();
  const groupId = input.groupId || randomUUID();
  const nowIso = new Date().toISOString();
  const appliedTargetUpdates: AppliedTargetDescriptionUpdate[] = [];
  let sourceRowsForNotification: DbCard[] = [];

  database.transaction(() => {
    const sourceRows = [...sourceCards.map((source) => {
      const resolvedSourceColumnId = resolveColumnId(
        database,
        sourceProjectId,
        source.cardId,
        source.status,
      );
      if (!resolvedSourceColumnId) {
        throw new Error(`Card not found: ${source.cardId}`);
      }
      if (source.status && source.status !== resolvedSourceColumnId) {
        throw new Error("Card is no longer in the expected column");
      }

      const sourceRow = database
        .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
        .get(
          source.cardId,
          sourceProjectId,
          resolvedSourceColumnId,
        ) as DbCard | undefined;
      if (!sourceRow) {
        throw new Error(`Card not found: ${source.cardId}`);
      }

      return sourceRow;
    })].sort(compareCardsByBoardPosition);
    sourceRowsForNotification = sourceRows;

    historyService.clearRedoStack(projectId, sessionId);
    if (input.operation === "move" && sourceProjectId !== projectId) {
      historyService.clearRedoStack(sourceProjectId, sessionId);
    }

    for (const targetUpdate of input.targetUpdates) {
      const resolvedTargetColumnId = resolveColumnId(
        database,
        projectId,
        targetUpdate.cardId,
        targetUpdate.status,
      );
      if (!resolvedTargetColumnId) {
        throw new Error(`Card not found: ${targetUpdate.cardId}`);
      }

      const existingTarget = database
        .prepare("SELECT * FROM cards WHERE id = ? AND project_id = ? AND archived = 0 AND status = ?")
        .get(
          targetUpdate.cardId,
          projectId,
          resolvedTargetColumnId,
        ) as DbCard | undefined;
      if (!existingTarget) {
        throw new Error(`Card not found: ${targetUpdate.cardId}`);
      }

      const mutation = buildCardUpdateMutation(existingTarget, targetUpdate.updates);
      if (mutation.fields.length === 0) continue;

      let previousDescriptionRevisionId: number | null = null;
      let newDescriptionRevisionId: number | null = null;
      if (mutation.descriptionChanged) {
        previousDescriptionRevisionId = existingTarget.description_revision_id;
        newDescriptionRevisionId = existingTarget.description_revision_id
          ? descriptionRevisionService.createNextDescriptionRevision(
            database,
            targetUpdate.cardId,
            existingTarget.description_revision_id,
            targetUpdate.updates.description ?? "",
            nowIso,
          )
          : descriptionRevisionService.createInitialDescriptionRevision(
            database,
            targetUpdate.cardId,
            targetUpdate.updates.description ?? "",
            nowIso,
          );
        mutation.fields.push("description_revision_id = ?");
        mutation.values.push(newDescriptionRevisionId);
      }

      mutation.values.push(targetUpdate.cardId);
      database
        .prepare(`UPDATE cards SET ${mutation.fields.join(", ")} WHERE id = ?`)
        .run(...mutation.values);

      historyService.recordUpdate(
        targetUpdate.cardId,
        projectId,
        resolvedTargetColumnId,
        mutation.previousValues,
        mutation.newValues,
        previousDescriptionRevisionId,
        newDescriptionRevisionId,
        sessionId,
        groupId,
      );

      appliedTargetUpdates.push({
        columnId: resolvedTargetColumnId,
        cardId: targetUpdate.cardId,
      });
    }

    if (input.operation === "move") {
      const deleteCardStmt = database.prepare("DELETE FROM cards WHERE id = ? AND project_id = ?");
      const collapseOrderStmt = database.prepare(
        `UPDATE cards SET "order" = "order" - 1
         WHERE project_id = ? AND archived = 0 AND status = ? AND "order" > ?`,
      );
      const sourceRowsByColumn = new Map<CardStatus, DbCard[]>();
      sourceRows.forEach((row: DbCard) => {
        const rows = sourceRowsByColumn.get(row.status) ?? [];
        rows.push(row);
        sourceRowsByColumn.set(row.status, rows);
      });

      for (const rows of sourceRowsByColumn.values()) {
        [...rows]
          .sort((left: DbCard, right: DbCard) => right.order - left.order)
          .forEach((row: DbCard) => {
            deleteCardStmt.run(row.id, sourceProjectId);
            collapseOrderStmt.run(sourceProjectId, row.status, row.order);
          });
      }

      [...sourceRows].reverse().forEach((row: DbCard) => {
        historyService.recordDelete(
          rowToCard(row),
          sourceProjectId,
          row.status,
          row.description_revision_id,
          sessionId,
          groupId,
        );
      });
    }
  })();

  for (const targetUpdate of appliedTargetUpdates) {
    dbNotifier.notifyChange(projectId, "update", targetUpdate.columnId, targetUpdate.cardId);
  }
  if (input.operation === "move") {
    sourceCards.forEach((source) => {
      const sourceRow = sourceRowsForNotification.find((row) => row.id === source.cardId);
      dbNotifier.notifyChange(
        sourceProjectId,
        "delete",
        source.status ?? sourceRow?.status ?? DEFAULT_CARD_STATUS,
        source.cardId,
      );
    });
  }

  return {
    operation: input.operation,
    sourceProjectId,
    sourceCardIds: sourceCards.map((source) => source.cardId),
    updatedCardIds: [...new Set(appliedTargetUpdates.map((update) => update.cardId))],
    groupId,
  };
}

export async function getCard(
  projectId: string,
  cardId: string,
  columnId?: CardStatus,
): Promise<Card | null> {
  projectId = requireProjectId(projectId);
  const card = readAuthoritativeCardById(getDb(), projectId, cardId);
  if (!card || !columnId) return card;
  return card.status === columnId ? card : null;
}

export function findCardLocationById(
  cardId: string,
): { projectId: string; columnId: CardStatus } | null {
  const database = getDb();
  const row = database
    .prepare("SELECT project_id, status FROM cards WHERE id = ? AND archived = 0")
    .get(cardId) as { project_id: string; status: CardStatus } | undefined;

  if (!row) {
    return null;
  }

  return {
    projectId: row.project_id,
    columnId: row.status,
  };
}

/** Sync card lookup (better-sqlite3 is synchronous). */
export function getCardSync(
  projectId: string,
  cardId: string,
): { title: string } | null {
  projectId = requireProjectId(projectId);
  const database = getDb();
  const row = database
    .prepare("SELECT title FROM cards WHERE id = ? AND project_id = ?")
    .get(cardId, projectId) as { title: string } | undefined;
  return row ?? null;
}

function dateKeyInTimezone(date: Date, timezone?: string): string {
  const resolved = timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dateKeyDayDelta(fromDateKey: string, toDateKey: string): number {
  const [fromYear, fromMonth, fromDay] = fromDateKey.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDateKey.split("-").map(Number);
  const fromUtc = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toUtc = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.floor((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

function shiftRecurringUntilDateWithDraggedDate(
  recurrence: RecurrenceConfig | undefined,
  occurrenceStart: Date,
  nextStart: Date | undefined,
  timezone?: string,
): RecurrenceConfig | undefined {
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
}

function queryRecurrenceExceptions(
  database: Database.Database,
  projectId: string,
  cardId: string,
): RecurrenceException[] {
  const rows = database.prepare(`
    SELECT * FROM recurrence_exceptions
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
}

function upsertSkipRecurrenceException(
  database: Database.Database,
  projectId: string,
  cardId: string,
  occurrenceStart: Date,
  nowIso: string,
): void {
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
}

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

function nextScheduleAfterOccurrence(
  database: Database.Database,
  projectId: string,
  card: Card,
  occurrenceStart: Date,
): {
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
} | null {
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

function prepareOccurrenceReceipt(
  database: Database.Database,
  operationKind: "complete" | "skip" | "update",
  projectId: string,
  input: CardOccurrenceActionInput | CardOccurrenceUpdateInput,
  sessionId?: string,
): OccurrenceReceiptPreparation {
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
}

function validateOccurrenceRequest(
  operationKind: "complete" | "skip" | "update",
  input: CardOccurrenceActionInput | CardOccurrenceUpdateInput,
): string | null {
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
}

function rejectOccurrenceOperation(
  database: Database.Database,
  prepared: Extract<PreparedCardOccurrenceOperation, { kind: "new" }>,
  cardId: string,
  code: OccurrenceRejectionCode,
  error: string,
): CardOccurrenceMutationResult {
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
}

function readOccurrenceAuthorityScope(
  database: Database.Database,
  projectId: string,
  cardId: string,
): OccurrenceAuthorityScope {
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
}

function occurrenceNestedOperationId(
  operationKind: string,
  operationId: string,
): string {
  const digest = createHash("sha256").update(operationId).digest("hex");
  return `card-occurrence-${operationKind}:${digest}`;
}

function deriveOccurrenceCardId(
  operationKind: string,
  operationId: string,
  occurrenceStart: Date,
): string {
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
}

function persistOccurrenceReceipt(
  database: Database.Database,
  prepared: Extract<PreparedCardOccurrenceOperation, { kind: "new" }>,
  cardId: string,
  scope: OccurrenceAuthorityScope,
  committedAt: string,
  created?: OccurrenceCreatedScope,
): CardOccurrenceMutationResult {
  return persistCardOccurrenceOperation(database, {
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
        path: `cards.${cardId}.occurrences`,
        operation: prepared.operationKind,
      },
      ...(created
        ? [{ path: `blocks.${created.cardId}`, operation: "create" }]
        : []),
    ],
    committedAt,
  });
}

function readOccurrenceClonePlacement(
  database: Database.Database,
  projectId: string,
  cardId: string,
  newCardId: string,
): OccurrenceClonePlacement {
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
  const target = await getCard(projectId, input.cardId);
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
  const sourceScope = readOccurrenceAuthorityScope(
    database,
    projectId,
    target.id,
  );
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
        operationId: `occurrence-complete-advance:${randomUUID()}`,
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
  const target = await getCard(projectId, input.cardId);
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
  const sourceScope = readOccurrenceAuthorityScope(
    database,
    projectId,
    target.id,
  );

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
        operationId: `occurrence-skip-advance:${randomUUID()}`,
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

function normalizeOccurrenceTiming(
  card: Card,
  occurrenceStart: Date,
  updates: CardOccurrenceUpdateInput["updates"],
): { start: Date; end: Date } {
  const baseStart = updates.scheduledStart ?? occurrenceStart;
  const baseDurationMs = card.scheduledStart && card.scheduledEnd
    ? Math.max(60_000, card.scheduledEnd.getTime() - card.scheduledStart.getTime())
    : 15 * 60_000;
  const baseEnd = updates.scheduledEnd ?? new Date(baseStart.getTime() + baseDurationMs);
  if (baseEnd > baseStart) {
    return { start: baseStart, end: baseEnd };
  }
  return {
    start: baseStart,
    end: new Date(baseStart.getTime() + baseDurationMs),
  };
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
  const target = await getCard(projectId, input.cardId);
  if (!target) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.cardId,
      "card_not_found",
      "Card not found",
    );
  }
  const card = target;
  const nowIso = new Date().toISOString();
  const sourceScope = readOccurrenceAuthorityScope(
    database,
    projectId,
    target.id,
  );
  const dragShiftRecurrence = shiftRecurringUntilDateWithDraggedDate(
    card.recurrence,
    input.occurrenceStart,
    input.updates.scheduledStart,
    input.updates.scheduleTimezone ?? card.scheduleTimezone,
  );

  if (input.scope === "all") {
    const result = database.transaction(() => {
      applyAuthoritativeCardSchedulePatchInTransaction(database, {
        projectId,
        cardId: target.id,
        operationId: `occurrence-update-all:${randomUUID()}`,
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
    if (!card.recurrence) {
      const result = database.transaction(() => {
        applyAuthoritativeCardSchedulePatchInTransaction(database, {
          projectId,
          cardId: target.id,
          operationId: `occurrence-update-one-time:${randomUUID()}`,
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

    const timing = normalizeOccurrenceTiming(card, input.occurrenceStart, input.updates);
    const detachedCardId = deriveOccurrenceCardId(
      "detach",
      prepared.operationId,
      input.occurrenceStart,
    );
    const detachedReminders = input.updates.reminders ?? card.reminders ?? [];
    const detachedTimezone = input.updates.scheduleTimezone === undefined
      ? card.scheduleTimezone
      : (input.updates.scheduleTimezone ?? undefined);
    const placement = readOccurrenceClonePlacement(
      database,
      projectId,
      target.id,
      detachedCardId,
    );

    const result = database.transaction(() => {
      const clone = cloneAuthoritativeCardInTransaction(
        database,
        {
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
              "schedule.isAllDay": input.updates.isAllDay ?? Boolean(card.isAllDay),
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
        },
      );

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

  if (!card.recurrence) {
    const result = database.transaction(() => {
      applyAuthoritativeCardSchedulePatchInTransaction(database, {
        projectId,
        cardId: target.id,
        operationId: `occurrence-update-nonrecurring:${randomUUID()}`,
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

  // this-and-future: split the series into a new card from occurrence start onward
  const oldCard = card;
  const oldRecurrence = oldCard.recurrence;
  if (!oldRecurrence) {
    return rejectOccurrenceOperation(
      database,
      prepared,
      input.cardId,
      "card_not_recurring",
      "Card is not recurring",
    );
  }

  const oldScheduledStart = oldCard.scheduledStart;
  const isEquivalentToAll = oldScheduledStart !== undefined &&
    input.occurrenceStart.getTime() <= oldScheduledStart.getTime();
  if (isEquivalentToAll) {
    const result = database.transaction(() => {
      applyAuthoritativeCardSchedulePatchInTransaction(database, {
        projectId,
        cardId: target.id,
        operationId: `occurrence-update-equivalent-all:${randomUUID()}`,
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

  const timezone = oldCard.scheduleTimezone ?? input.updates.scheduleTimezone ?? undefined;
  const occurrenceDateKey = dateKeyInTimezone(input.occurrenceStart, timezone);
  const endedRecurrence: RecurrenceConfig = {
    ...oldRecurrence,
    endCondition: {
      type: "untilDate",
      untilDate: shiftUntilDateByDays(occurrenceDateKey, -1),
    },
  };

  const splitTiming = normalizeOccurrenceTiming(oldCard, input.occurrenceStart, input.updates);
  const nextCardId = deriveOccurrenceCardId(
    "split",
    prepared.operationId,
    input.occurrenceStart,
  );
  const nextReminders = input.updates.reminders ?? oldCard.reminders ?? [];
  const nextTimezone = input.updates.scheduleTimezone === undefined
    ? oldCard.scheduleTimezone
    : (input.updates.scheduleTimezone ?? undefined);
  const shiftedFutureRecurrence = shiftRecurringUntilDateWithDraggedDate(
    oldRecurrence,
    input.occurrenceStart,
    splitTiming.start,
    nextTimezone,
  );
  const nextRecurrence = input.updates.recurrence === undefined
    ? (shiftedFutureRecurrence ?? oldRecurrence)
    : (input.updates.recurrence ?? undefined);
  const placement = readOccurrenceClonePlacement(
    database,
    projectId,
    target.id,
    nextCardId,
  );

  const result = database.transaction(() => {
    const clone = cloneAuthoritativeCardInTransaction(
      database,
      {
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
            "schedule.isAllDay": input.updates.isAllDay ?? Boolean(oldCard.isAllDay),
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
      },
    );
    applyAuthoritativeCardSchedulePatchInTransaction(database, {
      projectId,
      cardId: target.id,
      operationId: `occurrence-split-source:${randomUUID()}`,
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

export { COLUMNS };
