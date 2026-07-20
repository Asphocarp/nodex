import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { assertUuidV7, createUuidV7 } from "../../shared/uuid-v7";
import {
  type Board,
  type BoardSummary,
  type BoardSummaryColumn,
  type DatabasePage,
  type PageCreateInput,
  type PageCreatePlacement,
  type PageSearchInput,
  type PageSearchResult,
  type DatabaseRowsDetailsInput,
  type DatabasePageSummary,
  type Column,
} from "../../shared/types";
import { type WorkflowStatus } from "../../shared/workflow-status";
import type { PageLifecycleCreateDisplayIntent } from "../../shared/page-lifecycle-v2-runtime";
import { databaseGroupKeyForValue } from "../../shared/database-kernel";
import { applyPageLifecycleMutationV2 } from "./page-lifecycle-v2-store";
import { compilePageLifecycleCreateRequestV2InDatabase } from "./page-lifecycle-v2-compiler";
import { assertValidPageInput } from "../../shared/page-input-validation";
import {
  readDatabasePageById,
  readDatabasePageColumn,
  readDatabasePageSummariesByIds as readDatabasePageSummariesFromStore,
  readDatabasePageSummaryByDocumentId,
  readDatabasePageSummaryById as readDatabasePageSummaryFromStore,
  readDatabasePageSummaryColumn,
  readDatabasePagesByIds,
  readProjectDatabasePageSummaries,
  readProjectDatabasePages,
  PageReadStoreError,
} from "./page-read-store";
import { searchAuthoritativePages } from "./page-search-store";
import { getDb } from "./database";
import { dbNotifier } from "./notifier";
import { requireProjectId } from "./projects";
import { COLUMNS } from "./schema";

const normalizePageIdInput = (value: string | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return assertUuidV7(normalized);
};

export const readDatabasePageSummaryById = (
  pageId: string,
  database: Database.Database = getDb(),
): DatabasePageSummary | null => readDatabasePageSummaryFromStore(database, pageId);

/**
 * Read a bounded set of Database-row DatabasePage summaries in caller order with one
 * SQL query. Database View consumers already carry ordered Block identities,
 * so this boundary keeps those consumers independent from storage details.
 */
export const readDatabasePageSummariesByIds = (
  pageIds: readonly string[],
  database: Database.Database = getDb(),
): DatabasePageSummary[] => readDatabasePageSummariesFromStore(database, pageIds);

export interface PageDocumentBoardProjection {
  readonly projectId: string;
  readonly pageId: string;
  readonly status: WorkflowStatus;
  readonly summary: DatabasePageSummary;
}

/** Read the board projection committed with a DatabasePage's Y.Doc head. */
export const readPageDocumentBoardProjection = (
  database: Database.Database,
  documentId: string,
): PageDocumentBoardProjection | null => {
  try {
    return readDatabasePageSummaryByDocumentId(database, documentId);
  } catch (error) {
    if (
      error instanceof PageReadStoreError
      && error.code === "page_database_membership_missing"
    ) {
      return null;
    }
    throw error;
  }
};

export const readColumn = async (
  projectId: string,
  columnId: WorkflowStatus,
): Promise<Column> => {
  const canonicalProjectId = requireProjectId(projectId);
  const column = COLUMNS.find((candidate) => candidate.id === columnId);
  if (!column) throw new Error(`Unknown column: ${columnId}`);
  return {
    id: columnId,
    name: column.name,
    cards: readDatabasePageColumn(getDb(), canonicalProjectId, columnId),
  };
};

export const readSummaryColumn = async (
  projectId: string,
  columnId: WorkflowStatus,
): Promise<BoardSummaryColumn> => {
  const canonicalProjectId = requireProjectId(projectId);
  const column = COLUMNS.find((candidate) => candidate.id === columnId);
  if (!column) throw new Error(`Unknown column: ${columnId}`);
  return {
    id: columnId,
    name: column.name,
    cards: readDatabasePageSummaryColumn(
      getDb(),
      canonicalProjectId,
      columnId,
    ),
  };
};

export const getBoard = async (projectId: string): Promise<Board> => {
  const canonicalProjectId = requireProjectId(projectId);
  const cards = readProjectDatabasePages(getDb(), canonicalProjectId);
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
  const cards = readProjectDatabasePageSummaries(
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
): Promise<DatabasePage[]> => {
  const canonicalProjectId = requireProjectId(projectId);
  const pageIds = Array.from(
    new Set(input.pageIds.map((pageId) => pageId.trim()).filter(Boolean)),
  );
  if (pageIds.length === 0) return [];
  return readDatabasePagesByIds(getDb(), canonicalProjectId, pageIds);
};

export const searchPages = async (
  input: PageSearchInput,
): Promise<PageSearchResult[]> =>
  searchAuthoritativePages(getDb(), {
    ...input,
    projectIds: Array.from(new Set(input.projectIds.map(requireProjectId))),
  });

/**
 * DatabasePage is the user-facing name for a document-bearing Block. This facade is
 * intentionally a product-language adapter: one authoritative transaction
 * creates the Block, owned Y.Doc, Database membership/properties, placements,
 * projections, and operation receipt. There is no DatabasePage aggregate row.
 */
export const createPage = async (
  projectId: string,
  columnId: WorkflowStatus,
  input: PageCreateInput,
  sessionId?: string,
  placement: PageCreatePlacement = "bottom",
): Promise<DatabasePage> => {
  const canonicalProjectId = requireProjectId(projectId);
  assertValidPageInput(input, "create");
  const database = getDb();
  const pageId = normalizePageIdInput(input.id) ?? createUuidV7();
  const metadata = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (!metadata) throw new Error("Block store epoch is unavailable");

  const status = input.status ?? columnId;
  const explicitViewAnchor = typeof placement === "object"
    ? placement.beforePageId
    : undefined;
  const viewAnchor = placement === "top"
    ? database
        .prepare(
          `
          SELECT position.page_block_id
          FROM database_view_page_positions position
          INNER JOIN database_views view
            ON view.id = position.view_id
          INNER JOIN database_containers container
            ON container.default_view_id = view.id
           AND container.block_id = view.database_block_id
          INNER JOIN project_database_bindings binding
            ON binding.database_block_id = container.block_id
           AND binding.lifecycle = 'active'
          WHERE binding.project_id = ? AND view.lifecycle = 'active'
            AND position.group_key = ?
          ORDER BY position.rank_key, position.page_block_id
          LIMIT 1
        `,
        )
        .get(canonicalProjectId, databaseGroupKeyForValue(status)) as
          | { readonly page_block_id: string }
          | undefined
    : explicitViewAnchor
      ? { page_block_id: explicitViewAnchor }
      : undefined;

  const intent: PageLifecycleCreateDisplayIntent = {
    operationId: randomUUID(),
    projectId: canonicalProjectId,
    storeEpoch: metadata.store_epoch,
    ...(sessionId ? { clientSessionId: sessionId } : {}),
    actor: { source: "page_create_facade" },
    operation: {
      kind: "create_page",
      pageId,
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
      runInTarget: input.runInTarget ?? "localProject",
      runInLocalPath: input.runInLocalPath?.trim() || null,
      runInBaseBranch: input.runInBaseBranch?.trim() || null,
      runInWorktreePath: input.runInWorktreePath?.trim() || null,
      runInEnvironmentPath: input.runInEnvironmentPath?.trim() || null,
      ...(viewAnchor
        ? { beforeViewPageId: viewAnchor.page_block_id }
        : {}),
    },
  };
  const result = applyPageLifecycleMutationV2(
    database,
    compilePageLifecycleCreateRequestV2InDatabase(database, intent),
  );
  if (!result.ok) throw new Error(result.error.message);

  const page = readDatabasePageById(
    database,
    canonicalProjectId,
    result.value.pageId,
  );
  if (!page) {
    throw new Error(`Created Page ${result.value.pageId} has no Board projection`);
  }
  dbNotifier.notifyChange(canonicalProjectId, "create", status, page.id, {
    summary: readDatabasePageSummaryFromStore(database, page.id) ?? undefined,
    mutationId: result.value.operationId,
  });
  return page;
};

/**
 * Compatibility reader for a DatabasePage as a row in the primary Database.
 * Canonical Page identity/content reads go through Page Detail instead.
 */
export const getDatabaseRowPage = async (
  projectId: string,
  pageId: string,
  columnId?: WorkflowStatus,
): Promise<DatabasePage | null> => {
  const canonicalProjectId = requireProjectId(projectId);
  const page = readDatabasePageById(getDb(), canonicalProjectId, pageId);
  if (!page || !columnId) return page;
  return page.status === columnId ? page : null;
};

export const findPageLocationById = (
  pageId: string,
): { projectId: string; columnId: WorkflowStatus } | null => {
  const database = getDb();
  const block = database
    .prepare(
      `SELECT project_id FROM blocks
       WHERE id = ? AND type = 'page' AND lifecycle = 'active'`,
    )
    .get(pageId) as { readonly project_id: string } | undefined;
  if (!block) return null;
  const summary = readDatabasePageSummaryFromStore(database, pageId);
  if (!summary) return null;
  return { projectId: block.project_id, columnId: summary.status };
};

export { COLUMNS };
