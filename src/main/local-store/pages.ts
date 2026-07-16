import type Database from "better-sqlite3";

import {
  canonicalizePortableRichText,
  portableRichTextPlainText,
} from "../../shared/block-documents/portable-rich-text";
import type { Page, PageParent } from "../../shared/page";

interface PageRow {
  readonly block_id: string;
  readonly library_id: string;
  readonly parent_kind: "library" | "page" | "data_source";
  readonly parent_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly parent_revision: number;
  readonly metadata_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly projected_seq: number | null;
  readonly title: string | null;
  readonly title_rich_json: string | null;
  readonly preview: string | null;
  readonly plain_text: string | null;
}

export class PageStoreStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PageStoreStateError";
  }
}

const parentFromRow = (row: PageRow): PageParent => {
  if (row.parent_kind === "library") {
    return { kind: "library", libraryId: row.parent_id };
  }
  if (row.parent_kind === "page") {
    return { kind: "page", pageId: row.parent_id };
  }
  return { kind: "data_source", dataSourceId: row.parent_id };
};

const rowToPage = (row: PageRow): Page => {
  if (
    row.projected_seq !== row.head_seq ||
    row.title === null ||
    row.title_rich_json === null ||
    row.preview === null ||
    row.plain_text === null
  ) {
    throw new PageStoreStateError(
      `Page ${row.block_id} has no exact-head content projection`,
    );
  }
  let richTitle: Page["richTitle"];
  try {
    richTitle = canonicalizePortableRichText(
      JSON.parse(row.title_rich_json) as unknown,
    );
  } catch (error) {
    throw new PageStoreStateError(
      `Page ${row.block_id} has invalid rich title authority`,
      { cause: error },
    );
  }
  if (portableRichTextPlainText(richTitle) !== row.title) {
    throw new PageStoreStateError(
      `Page ${row.block_id} has divergent rich and plain titles`,
    );
  }
  return {
    pageId: row.block_id,
    libraryId: row.library_id,
    parent: parentFromRow(row),
    lifecycle: row.lifecycle,
    parentRevision: row.parent_revision,
    metadataRevision: row.metadata_revision,
    documentId: row.document_id,
    documentGeneration: row.generation,
    documentHeadSeq: row.head_seq,
    title: row.title,
    richTitle,
    preview: row.preview,
    plainText: row.plain_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const readPagesInDatabase = (
  database: Database.Database,
  pageIds: readonly string[],
): ReadonlyMap<string, Page> => {
  if (pageIds.length === 0) return new Map();
  const placeholders = pageIds.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT page.block_id, page.library_id, page.parent_kind, page.parent_id,
      page.lifecycle, page.parent_revision, page.metadata_revision,
      page.created_at, page.updated_at, page.document_id,
      document.generation, document.head_seq,
      materialization.projected_seq, materialization.title,
      materialization.title_rich_json, materialization.preview,
      materialization.plain_text
    FROM pages page
    INNER JOIN documents document ON document.id = page.document_id
    LEFT JOIN document_materializations materialization
      ON materialization.document_id = document.id
      AND materialization.generation = document.generation
      AND materialization.projected_seq = document.head_seq
      AND materialization.schema_version = document.schema_version
    WHERE page.block_id IN (${placeholders})
    ORDER BY page.block_id
  `).all(...pageIds) as readonly PageRow[];
  return new Map(rows.map((row) => {
    const page = rowToPage(row);
    return [page.pageId, page] as const;
  }));
};

export const readPageInDatabase = (
  database: Database.Database,
  pageId: string,
): Page | null => readPagesInDatabase(database, [pageId]).get(pageId) ?? null;
