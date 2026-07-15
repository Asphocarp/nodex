import type Database from "better-sqlite3";
import * as Y from "yjs";
import { removeCardReferenceDisplayHints } from "../../shared/block-documents/card-reference-hints";
import {
  applyPrimaryBlockDocumentMigrationUpdate,
  loadPrimaryBlockDocument,
} from "./block-document-store";

interface PendingDocumentRow {
  readonly document_id: string;
}

export interface CardReferenceHintFinalizationResult {
  readonly scannedDocuments: number;
  readonly updatedDocuments: number;
  readonly removedHints: number;
}

/**
 * Reach a clean current-head fixed point through the normal Document writer.
 * Historical updates and snapshots remain immutable and replayable.
 */
export const finalizeCardReferenceIdentityStorage = (
  database: Database.Database,
): CardReferenceHintFinalizationResult => {
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
  for (const row of rows) {
    const loaded = loadPrimaryBlockDocument(database, row.document_id);
    try {
      const before = Y.encodeStateVector(loaded.document);
      const body = loaded.document.getXmlFragment("body");
      let removed = { count: 0, blockIds: [] as readonly string[] };
      loaded.document.transact(() => {
        removed = removeCardReferenceDisplayHints(body);
      }, "card-reference-identity-finalization");
      if (removed.count === 0) continue;

      const update = Y.encodeStateAsUpdate(loaded.document, before);
      applyPrimaryBlockDocumentMigrationUpdate(database, {
        documentId: loaded.head.documentId,
        storeEpoch: loaded.storeEpoch,
        generation: loaded.head.generation,
        updateId: `card-reference-identity:v1:${loaded.head.documentId}:${loaded.head.headSeq}`,
        clientSessionId: "migration:card-reference-identity:v1",
        baseHeadSeq: loaded.head.headSeq,
        touchedBlockIds: removed.blockIds,
        update,
      });
      updatedDocuments += 1;
      removedHints += removed.count;
    } finally {
      loaded.document.destroy();
    }
  }

  return {
    scannedDocuments: rows.length,
    updatedDocuments,
    removedHints,
  };
};
