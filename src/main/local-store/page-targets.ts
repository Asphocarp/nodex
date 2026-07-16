import type Database from "better-sqlite3";
import type { PageTargetReadModel } from "../../shared/page-targets";
import type {
  PageTargetChangedEvent,
  PageTargetChangeKind,
} from "../../shared/page-target-events";
import { readPageInDatabase } from "./pages";
import { getDb } from "./database";

const MAX_BLOCK_ID_LENGTH = 512;

export class PageTargetStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageTargetStoreError";
  }
}

interface PageTargetRow {
  readonly id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly library_id: string | null;
  readonly document_id: string | null;
  readonly readiness: "pending_genesis" | "ready" | "failed" | null;
  readonly schema_key: string | null;
  readonly schema_version: number | null;
}

interface PageTargetDocumentCoordinateRow {
  readonly block_id: string;
  readonly library_id: string;
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
}

/** Map a committed Page Document head to its target invalidation coordinate. */
export const readPageTargetContentChangedEvent = (
  database: Database.Database,
  documentId: string,
): PageTargetChangedEvent | null => {
  const row = database.prepare(`
    SELECT owner.id AS block_id,
           page.library_id,
           document.id AS document_id,
           document.generation,
           document.head_seq
    FROM documents document
    JOIN block_documents ownership ON ownership.document_id = document.id
    JOIN blocks owner ON owner.id = ownership.block_id
      AND owner.project_id = ownership.project_id
    JOIN pages page ON page.block_id = owner.id
    WHERE document.id = ? AND owner.type = 'page'
    LIMIT 1
  `).get(documentId) as PageTargetDocumentCoordinateRow | undefined;
  if (!row) return null;
  return {
    libraryId: row.library_id,
    targetPageId: row.block_id,
    changeKind: "content",
    document: {
      id: row.document_id,
      generation: row.generation,
      headSeq: row.head_seq,
    },
  };
};

export const readPageTargetChangedEvent = (
  database: Database.Database,
  targetPageId: string,
  changeKind: Exclude<PageTargetChangeKind, "content">,
): PageTargetChangedEvent | null => {
  const row = database.prepare(`
    SELECT block.id AS block_id, page.library_id
    FROM blocks block
    INNER JOIN pages page ON page.block_id = block.id
    WHERE block.id = ? AND block.type = 'page'
    LIMIT 1
  `).get(targetPageId) as
    | { readonly block_id: string; readonly library_id: string }
    | undefined;
  if (!row) return null;
  return {
    libraryId: row.library_id,
    targetPageId: row.block_id,
    changeKind,
  };
};

const requireBlockId = (value: string): string => {
  if (
    value.length > 0 &&
    value.length <= MAX_BLOCK_ID_LENGTH &&
    value === value.trim()
  ) {
    return value;
  }
  throw new PageTargetStoreError("targetPageId is invalid");
};

/** Resolve one Page identity without assuming it belongs to any Data Source. */
export const resolvePageTarget = (
  targetPageId: string,
  database: Database.Database = getDb(),
): PageTargetReadModel => {
  const canonicalTargetPageId = requireBlockId(targetPageId);
  return database.transaction((): PageTargetReadModel => {
    const row = database.prepare(`
      SELECT
        target.id,
        target.type,
        target.lifecycle,
        page.library_id,
        document.id AS document_id,
        document.readiness,
        document.schema_key,
        document.schema_version
      FROM blocks target
      LEFT JOIN pages page ON page.block_id = target.id
      LEFT JOIN block_documents ownership ON ownership.block_id = target.id
      LEFT JOIN documents document ON document.id = ownership.document_id
      WHERE target.id = ?
      LIMIT 1
    `).get(canonicalTargetPageId) as PageTargetRow | undefined;

    if (!row) {
      return { status: "missing", targetPageId: canonicalTargetPageId };
    }
    if (row.type !== "page") {
      return {
        status: "invalid_target",
        targetPageId: canonicalTargetPageId,
        actualBlockType: row.type,
      };
    }
    if (row.lifecycle === "deleted") {
      if (!row.library_id) {
        throw new PageTargetStoreError(
          `Page target ${canonicalTargetPageId} has no Library authority`,
        );
      }
      return {
        status: "deleted",
        targetPageId: canonicalTargetPageId,
        libraryId: row.library_id,
      };
    }

    const page = readPageInDatabase(database, canonicalTargetPageId);
    if (
      !page ||
      page.documentId !== row.document_id ||
      !row.readiness ||
      !row.schema_key ||
      row.schema_version === null
    ) {
      throw new PageTargetStoreError(
        `Page target ${canonicalTargetPageId} has an incomplete content read model`,
      );
    }
    if (page.lifecycle === "deleted") {
      throw new PageTargetStoreError(
        `Page target ${canonicalTargetPageId} changed lifecycle while resolving`,
      );
    }

    return {
      status: "available",
      targetPageId: canonicalTargetPageId,
      page: { ...page, lifecycle: page.lifecycle },
      document: {
        readiness: row.readiness,
        schemaKey: row.schema_key,
        schemaVersion: row.schema_version,
      },
    };
  })();
};
