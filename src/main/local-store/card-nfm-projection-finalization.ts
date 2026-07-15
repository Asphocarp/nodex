import type Database from "better-sqlite3";
import {
  getRegisteredBlockDocumentSchemaAdapter,
  toPersistedBlockDocumentMaterialization,
} from "../../shared/block-documents/document-schema-adapters";
import { replaceDocumentSecondaryProjections } from "./block-document-projections";
import { loadPrimaryBlockDocument } from "./block-document-store";
import { persistCardDocumentMaterialization } from "./document-materializations";
import { rebuildCardReadModelProjection } from "./card-read-store";

interface ProjectionDocumentRow {
  readonly document_id: string;
  readonly project_id: string;
  readonly owner_block_id: string;
  readonly owner_type: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly stored_nfm: string | null;
}

export interface CardNfmProjectionFinalizationResult {
  readonly scannedDocuments: number;
  readonly rematerializedDocuments: number;
}

export interface CardNfmProjectionFinalizationOptions {
  /** Active Documents restored after the startup migration can catch up here. */
  readonly documentIds?: readonly string[];
}

/**
 * Upgrade disposable current-head NFM projections without manufacturing a
 * causal Yjs update. Authority already contains Card shell and target IDs.
 */
export const finalizeCardNfmIdentityProjection = (
  database: Database.Database,
  options: CardNfmProjectionFinalizationOptions = {},
): CardNfmProjectionFinalizationResult => {
  const documentIds =
    options.documentIds === undefined
      ? null
      : Array.from(new Set(options.documentIds));
  if (documentIds?.length === 0) {
    return { scannedDocuments: 0, rematerializedDocuments: 0 };
  }
  const documentFilter = documentIds
    ? `AND document.id IN (${documentIds.map(() => "?").join(", ")})`
    : "";
  const rows = database.prepare(`
    SELECT document.id AS document_id,
           document.project_id,
           owner.id AS owner_block_id,
           owner.type AS owner_type,
           document.generation,
           document.head_seq,
           document.schema_key,
           document.schema_version,
           materialization.nfm AS stored_nfm
    FROM documents document
    JOIN block_documents ownership ON ownership.document_id = document.id
    JOIN blocks owner ON owner.id = ownership.block_id
    LEFT JOIN document_materializations materialization
      ON materialization.document_id = document.id
    WHERE document.sync_engine = 'yjs'
      AND document.readiness = 'ready'
      AND document.authority = 'ydoc_primary'
      AND owner.lifecycle <> 'deleted'
      ${documentFilter}
    ORDER BY document.id
  `).all(...(documentIds ?? [])) as readonly ProjectionDocumentRow[];

  let rematerializedDocuments = 0;
  const cardIdsByProject = new Map<string, Set<string>>();
  const finalize = database.transaction(() => {
    for (const row of rows) {
      if (
        row.stored_nfm !== null &&
        !row.stored_nfm.includes("<card")
      ) {
        continue;
      }

      const loaded = loadPrimaryBlockDocument(database, row.document_id);
      try {
        if (
          loaded.ownerType !== row.owner_type ||
          loaded.head.generation !== row.generation ||
          loaded.head.headSeq !== row.head_seq ||
          loaded.head.schemaKey !== row.schema_key ||
          loaded.head.schemaVersion !== row.schema_version
        ) {
          throw new Error(
            `Document ${row.document_id} changed during Card NFM projection finalization`,
          );
        }

        const adapter = getRegisteredBlockDocumentSchemaAdapter({
          ownerType: row.owner_type,
          schemaKey: row.schema_key,
          schemaVersion: row.schema_version,
        });
        const materialization = toPersistedBlockDocumentMaterialization(
          adapter.inspect(loaded.document).materialization,
        );
        if (materialization.nfm === row.stored_nfm) continue;

        persistCardDocumentMaterialization(database, {
          documentId: row.document_id,
          generation: row.generation,
          projectedSeq: row.head_seq,
          materialization,
        });
        replaceDocumentSecondaryProjections(database, {
          documentId: row.document_id,
          expectedGeneration: row.generation,
          expectedProjectedSeq: row.head_seq,
        });
        if (row.owner_type === "card") {
          const cardIds = cardIdsByProject.get(row.project_id) ?? new Set();
          cardIds.add(row.owner_block_id);
          cardIdsByProject.set(row.project_id, cardIds);
        }
        rematerializedDocuments += 1;
      } finally {
        loaded.document.destroy();
      }
    }
    for (const [projectId, cardIds] of cardIdsByProject) {
      rebuildCardReadModelProjection(database, projectId, [...cardIds]);
    }
  });
  finalize.immediate();

  return {
    scannedDocuments: rows.length,
    rematerializedDocuments,
  };
};
