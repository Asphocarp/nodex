import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { assertUuidV7, createUuidV7 } from "../../shared/card-id";
import {
  type Board,
  type BoardSummary,
  type BoardSummaryColumn,
  type Card,
  type CardCreateInput,
  type CardCreatePlacement,
  type CardSearchInput,
  type CardSearchResult,
  type DatabaseRowsDetailsInput,
  type CardSummary,
  type Column,
} from "../../shared/types";
import { type CardStatus } from "../../shared/card-status";
import { applyCardLifecycleMutation } from "./card-block-lifecycle";
import { assertValidCardInput } from "./card-input-validation";
import {
  readDatabaseCardById,
  readDatabaseCardColumn,
  readDatabaseCardSummariesByIds as readDatabaseCardSummariesFromStore,
  readDatabaseCardSummaryByDocumentId,
  readDatabaseCardSummaryById as readDatabaseCardSummaryFromStore,
  readDatabaseCardSummaryColumn,
  readDatabaseCardsByIds,
  readProjectDatabaseCardSummaries,
  readProjectDatabaseCards,
} from "./card-read-store";
import { searchAuthoritativeCards } from "./card-search-store";
import { getDb } from "./database";
import { dbNotifier } from "./notifier";
import { requireProjectId } from "./projects";
import { COLUMNS } from "./schema";

const normalizeCardIdInput = (value: string | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return assertUuidV7(normalized);
};

export const readDatabaseCardSummaryById = (
  cardId: string,
  database: Database.Database = getDb(),
): CardSummary | null => readDatabaseCardSummaryFromStore(database, cardId);

/**
 * Read a bounded set of Database-row Card summaries in caller order with one
 * SQL query. Database View consumers already carry ordered Block identities,
 * so this boundary keeps those consumers independent from storage details.
 */
export const readDatabaseCardSummariesByIds = (
  cardIds: readonly string[],
  database: Database.Database = getDb(),
): CardSummary[] => readDatabaseCardSummariesFromStore(database, cardIds);

export interface CardDocumentBoardProjection {
  readonly projectId: string;
  readonly cardId: string;
  readonly status: CardStatus;
  readonly summary: CardSummary;
}

/** Read the board projection committed with a Card's Y.Doc head. */
export const readCardDocumentBoardProjection = (
  database: Database.Database,
  documentId: string,
): CardDocumentBoardProjection | null =>
  readDatabaseCardSummaryByDocumentId(database, documentId);

export const readColumn = async (
  projectId: string,
  columnId: CardStatus,
): Promise<Column> => {
  const canonicalProjectId = requireProjectId(projectId);
  const column = COLUMNS.find((candidate) => candidate.id === columnId);
  if (!column) throw new Error(`Unknown column: ${columnId}`);
  return {
    id: columnId,
    name: column.name,
    cards: readDatabaseCardColumn(getDb(), canonicalProjectId, columnId),
  };
};

export const readSummaryColumn = async (
  projectId: string,
  columnId: CardStatus,
): Promise<BoardSummaryColumn> => {
  const canonicalProjectId = requireProjectId(projectId);
  const column = COLUMNS.find((candidate) => candidate.id === columnId);
  if (!column) throw new Error(`Unknown column: ${columnId}`);
  return {
    id: columnId,
    name: column.name,
    cards: readDatabaseCardSummaryColumn(
      getDb(),
      canonicalProjectId,
      columnId,
    ),
  };
};

export const getBoard = async (projectId: string): Promise<Board> => {
  const canonicalProjectId = requireProjectId(projectId);
  const cards = readProjectDatabaseCards(getDb(), canonicalProjectId);
  return {
    columns: COLUMNS.map((column) => ({
      id: column.id,
      name: column.name,
      cards: cards.filter((card) => card.status === column.id),
    })),
  };
};

export const getBoardSummary = async (
  projectId: string,
): Promise<BoardSummary> => {
  const canonicalProjectId = requireProjectId(projectId);
  const cards = readProjectDatabaseCardSummaries(
    getDb(),
    canonicalProjectId,
  );
  return {
    columns: COLUMNS.map((column) => ({
      id: column.id,
      name: column.name,
      cards: cards.filter((card) => card.status === column.id),
    })),
  };
};

export const getDatabaseRowsDetails = async (
  projectId: string,
  input: DatabaseRowsDetailsInput,
): Promise<Card[]> => {
  const canonicalProjectId = requireProjectId(projectId);
  const cardIds = Array.from(
    new Set(input.cardIds.map((cardId) => cardId.trim()).filter(Boolean)),
  );
  if (cardIds.length === 0) return [];
  return readDatabaseCardsByIds(getDb(), canonicalProjectId, cardIds);
};

export const searchCards = async (
  input: CardSearchInput,
): Promise<CardSearchResult[]> =>
  searchAuthoritativeCards(getDb(), {
    ...input,
    projectIds: Array.from(new Set(input.projectIds.map(requireProjectId))),
  });

/**
 * Card is the user-facing name for a document-bearing Block. This facade is
 * intentionally a product-language adapter: one authoritative transaction
 * creates the Block, owned Y.Doc, Database membership/properties, placements,
 * projections, and operation receipt. There is no Card aggregate row.
 */
export const createCard = async (
  projectId: string,
  columnId: CardStatus,
  input: CardCreateInput,
  sessionId?: string,
  placement: CardCreatePlacement = "bottom",
): Promise<Card> => {
  const canonicalProjectId = requireProjectId(projectId);
  assertValidCardInput(input, "create");
  const database = getDb();
  const cardId = normalizeCardIdInput(input.id) ?? createUuidV7();
  const metadata = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (!metadata) throw new Error("Block store epoch is unavailable");

  const status = input.status ?? columnId;
  const topAnchor = placement === "top"
    ? database
        .prepare(
          `
          SELECT placement.block_id
          FROM top_level_block_placements placement
          INNER JOIN blocks block
            ON block.id = placement.block_id
           AND block.project_id = placement.project_id
          WHERE placement.project_id = ? AND block.lifecycle <> 'deleted'
          ORDER BY placement.rank_key, placement.block_id
          LIMIT 1
        `,
        )
        .get(canonicalProjectId) as
          | { readonly block_id: string }
          | undefined
    : undefined;
  const explicitViewAnchor = typeof placement === "object"
    ? placement.beforeCardId
    : undefined;
  const viewAnchor = placement === "top"
    ? database
        .prepare(
          `
          SELECT position.block_id
          FROM database_view_positions position
          INNER JOIN database_views view
            ON view.id = position.view_id
           AND view.project_id = position.project_id
          WHERE position.project_id = ? AND view.is_primary = 1
            AND view.lifecycle = 'active' AND position.group_key = ?
          ORDER BY position.rank_key, position.block_id
          LIMIT 1
        `,
        )
        .get(canonicalProjectId, status) as
          | { readonly block_id: string }
          | undefined
    : explicitViewAnchor
      ? { block_id: explicitViewAnchor }
      : undefined;

  const result = applyCardLifecycleMutation(database, {
    version: 1,
    operationId: randomUUID(),
    projectId: canonicalProjectId,
    storeEpoch: metadata.store_epoch,
    ...(sessionId ? { clientSessionId: sessionId } : {}),
    actor: { source: "card_create_facade" },
    operation: {
      kind: "create_card",
      cardId,
      title: input.title,
      nfm: input.description ?? "",
      status,
      priority: input.priority ?? null,
      estimate: input.estimate ?? null,
      tags: input.tags ?? [],
      dueDate: input.dueDate?.toISOString().slice(0, 10) ?? null,
      scheduledStart: input.scheduledStart?.toISOString() ?? null,
      scheduledEnd: input.scheduledEnd?.toISOString() ?? null,
      isAllDay: Boolean(input.isAllDay),
      recurrence: input.recurrence ?? null,
      reminders: input.reminders ?? [],
      scheduleTimezone: input.scheduleTimezone?.trim() || null,
      assignee: input.assignee?.trim() || null,
      agentBlocked: Boolean(input.agentBlocked),
      agentStatus: input.agentStatus?.trim() || null,
      runInTarget: input.runInTarget ?? "localProject",
      runInLocalPath: input.runInLocalPath?.trim() || null,
      runInBaseBranch: input.runInBaseBranch?.trim() || null,
      runInWorktreePath: input.runInWorktreePath?.trim() || null,
      runInEnvironmentPath: input.runInEnvironmentPath?.trim() || null,
      ...(topAnchor ? { beforeBlockId: topAnchor.block_id } : {}),
      ...(viewAnchor ? { beforeViewCardId: viewAnchor.block_id } : {}),
    },
  });
  if (!result.ok) throw new Error(result.error.message);

  const card = readDatabaseCardById(
    database,
    canonicalProjectId,
    result.value.cardId,
  );
  if (!card) {
    throw new Error(`Created Card ${result.value.cardId} has no read model`);
  }
  dbNotifier.notifyChange(canonicalProjectId, "create", status, card.id, {
    summary: readDatabaseCardSummaryFromStore(database, card.id) ?? undefined,
    mutationId: result.value.operationId,
  });
  return card;
};

/**
 * Compatibility reader for a Card as a row in the primary Database.
 * Canonical Card identity/content reads go through Card Detail instead.
 */
export const getDatabaseRowCard = async (
  projectId: string,
  cardId: string,
  columnId?: CardStatus,
): Promise<Card | null> => {
  const canonicalProjectId = requireProjectId(projectId);
  const card = readDatabaseCardById(getDb(), canonicalProjectId, cardId);
  if (!card || !columnId) return card;
  return card.status === columnId ? card : null;
};

export const findCardLocationById = (
  cardId: string,
): { projectId: string; columnId: CardStatus } | null => {
  const database = getDb();
  const block = database
    .prepare(
      `SELECT project_id FROM blocks
       WHERE id = ? AND type = 'card' AND lifecycle = 'active'`,
    )
    .get(cardId) as { readonly project_id: string } | undefined;
  if (!block) return null;
  const summary = readDatabaseCardSummaryFromStore(database, cardId);
  if (!summary) return null;
  return { projectId: block.project_id, columnId: summary.status };
};

export { COLUMNS };
