import type Database from "better-sqlite3";
import { materializeCardDocument } from "../../shared/block-documents/block-document-codec";
import { loadPrimaryBlockDocument } from "./block-document-store";
import { persistCardDocumentMaterialization } from "./document-materializations";

interface PendingRichTitleDocument {
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
}

/**
 * Rebuilds v2 rich-title projections from current Yjs authority. The v73→v74
 * DDL edge changes only schema coordinates and adds projection columns; this
 * writer-owned fixed point prevents SQL title projections from becoming a
 * migration authority.
 */
export const finalizeRichCardTitleSchema = (
  database: Database.Database,
): number => {
  const rows = database
    .prepare(
      `
      SELECT document.id AS document_id,
             document.generation,
             document.head_seq
      FROM documents document
      JOIN block_documents ownership ON ownership.document_id = document.id
      JOIN blocks owner ON owner.id = ownership.block_id
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
      WHERE owner.type = 'card'
        AND document.schema_key = 'nodex.card'
        AND document.schema_version = 2
        AND document.readiness = 'ready'
        AND document.authority = 'ydoc_primary'
        AND (
          materialization.document_id IS NULL
          OR materialization.schema_version <> 2
          OR materialization.generation <> document.generation
          OR materialization.projected_seq <> document.head_seq
          OR materialization.title_rich_hash =
             '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
             AND materialization.title <> ''
        )
      ORDER BY document.id
    `,
    )
    .all() as readonly PendingRichTitleDocument[];
  if (rows.length === 0) return 0;

  const finalize = database.transaction(() => {
    for (const row of rows) {
      const loaded = loadPrimaryBlockDocument(database, row.document_id);
      try {
        if (
          loaded.head.generation !== row.generation ||
          loaded.head.headSeq !== row.head_seq ||
          loaded.head.schemaVersion !== 2
        ) {
          throw new Error(
            `Card Document ${row.document_id} changed during rich-title finalization`,
          );
        }
        persistCardDocumentMaterialization(database, {
          documentId: row.document_id,
          generation: row.generation,
          projectedSeq: row.head_seq,
          materialization: materializeCardDocument(loaded.document),
        });
      } finally {
        loaded.document.destroy();
      }
    }
  });
  finalize.immediate();
  return rows.length;
};
