import type Database from "better-sqlite3";
import * as Y from "yjs";
import { normalizePageReferences } from "../../shared/block-documents/page-reference-hints";
import {
  applyPrimaryBlockDocumentMigrationUpdate,
  loadPrimaryBlockDocument,
} from "./block-document-store";

interface PendingDocumentRow {
  readonly document_id: string;
}

export interface PageReferenceHintFinalizationResult {
  readonly scannedDocuments: number;
  readonly updatedDocuments: number;
  readonly removedHints: number;
  readonly renamedNodes: number;
}

/**
 * Reach a clean current-head fixed point through the normal Document writer.
 * Historical updates and snapshots remain immutable and replayable.
 */
export const finalizePageReferenceIdentityStorage = (
  database: Database.Database,
): PageReferenceHintFinalizationResult => {
  const rows = database.prepare(`
    SELECT document.id AS document_id
    FROM documents document
    JOIN block_documents ownership ON ownership.document_id = document.id
    JOIN blocks owner ON owner.id = ownership.block_id
    WHERE document.sync_engine = 'yjs'
      AND document.readiness = 'ready'
      AND document.authority = 'ydoc_primary'
      AND owner.lifecycle <> 'deleted'
    ORDER BY document.id
  `).all() as readonly PendingDocumentRow[];

  let updatedDocuments = 0;
  let removedHints = 0;
  let renamedNodes = 0;
  for (const row of rows) {
    const loaded = loadPrimaryBlockDocument(database, row.document_id);
    try {
      const before = Y.encodeStateVector(loaded.document);
      const body = loaded.document.getXmlFragment("body");
      let normalized = {
        removedHints: 0,
        renamedNodes: 0,
        blockIds: [] as readonly string[],
      };
      loaded.document.transact(() => {
        normalized = normalizePageReferences(body);
      }, "page-reference-identity-finalization");
      if (
        normalized.removedHints === 0
        && normalized.renamedNodes === 0
      ) continue;

      const update = Y.encodeStateAsUpdate(loaded.document, before);
      applyPrimaryBlockDocumentMigrationUpdate(database, {
        documentId: loaded.head.documentId,
        storeEpoch: loaded.storeEpoch,
        generation: loaded.head.generation,
        updateId: `page-reference-identity:v1:${loaded.head.documentId}:${loaded.head.headSeq}`,
        clientSessionId: "migration:page-reference-identity:v1",
        baseHeadSeq: loaded.head.headSeq,
        touchedBlockIds: normalized.blockIds,
        update,
      });
      updatedDocuments += 1;
      removedHints += normalized.removedHints;
      renamedNodes += normalized.renamedNodes;
    } finally {
      loaded.document.destroy();
    }
  }

  return {
    scannedDocuments: rows.length,
    updatedDocuments,
    removedHints,
    renamedNodes,
  };
};
