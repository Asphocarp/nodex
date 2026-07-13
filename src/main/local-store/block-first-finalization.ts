import type Database from "better-sqlite3";

import {
  createCardDocumentGenesis,
  materializeCardDocument,
} from "../../shared/block-documents/block-document-codec";
import { isLegacyForeignBodyReference } from "../../shared/block-documents/derived-records";
import { createUuidV7 } from "../../shared/card-id";
import { cutoverEligibleCardDocumentsToPrimary } from "./block-document-cutover";
import {
  initializeBlockDocumentGenesis,
  loadLegacyShadowBlockDocument,
} from "./block-document-store";
import { requireBlockStoreEpoch } from "./block-store-metadata";
import { dropLegacyBlockFirstTables } from "./block-first-legacy-schema";
import { migrateLegacyForeignReferences } from "./foreign-reference-migration";
import { drainLegacyCardShadowJobs } from "./legacy-card-shadow-processor";

const MAX_FIXED_POINT_ROUNDS = 100;
const SHADOW_BATCH_SIZE = 1_000;
const FOREIGN_REFERENCE_BATCH_SIZE = 1_000;
const FINALIZATION_CLIENT_SESSION_ID = "block-first-finalization";

interface RemainingLegacyCardDocumentRow {
  readonly document_id: string;
  readonly owner_block_id: string;
  readonly owner_lifecycle: "active" | "archived" | "deleted";
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
}

export interface BlockFirstFinalizationResult {
  readonly requeuedObsoleteParityFailures: number;
  readonly shadowJobsProcessed: number;
  readonly foreignDocumentsProcessed: number;
  readonly cutoverDocuments: number;
  readonly finalizedDeletedDocuments: number;
  readonly repairedDocumentProjections: number;
  readonly droppedTables: readonly string[];
}

export class BlockFirstFinalizationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlockFirstFinalizationError";
  }
}

const requeueObsoleteToggleDisclosureParityFailures = (
  database: Database.Database,
): number => {
  const now = new Date().toISOString();
  return database
    .prepare(
      `
      UPDATE legacy_card_shadow_jobs
      SET status = 'pending', claim_token = NULL, claimed_at = NULL,
          claim_expires_at = NULL, applied_document_head_seq = NULL,
          last_error = NULL, completed_at = NULL, updated_at = ?
      WHERE status = 'failed'
        AND last_error LIKE
          'LegacyCardShadowProcessorError: Document for Card % failed normalized title/NFM parity'
    `,
    )
    .run(now).changes;
};

const drainLegacyShadows = (
  database: Database.Database,
): number => {
  let processed = 0;
  while (true) {
    const batch = drainLegacyCardShadowJobs(database, {
      maxJobs: SHADOW_BATCH_SIZE,
    });
    processed += batch.results.length;
    const failure = batch.results.find((result) => result.outcome === "failed");
    if (failure) {
      throw new BlockFirstFinalizationError(
        `Legacy Card ${failure.cardId} could not reach Y.Doc parity: ${failure.error ?? "unknown shadow failure"}`,
      );
    }
    const retainedFailure = database
      .prepare(
        `
        SELECT card_id, last_error
        FROM legacy_card_shadow_jobs
        WHERE status = 'failed'
        ORDER BY card_id, source_event_seq
        LIMIT 1
      `,
      )
      .get() as
      | { readonly card_id: string; readonly last_error: string | null }
      | undefined;
    if (retainedFailure) {
      throw new BlockFirstFinalizationError(
        `Legacy Card ${retainedFailure.card_id} could not reach Y.Doc parity: ${retainedFailure.last_error ?? "terminal shadow failure"}`,
      );
    }
    if (batch.exhausted) return processed;
    if (batch.results.length > 0) continue;
    throw new BlockFirstFinalizationError(
      "Legacy Card shadow migration made no progress",
    );
  }
};

const migrateForeignReferences = async (
  database: Database.Database,
): Promise<number> => {
  let processed = 0;
  while (true) {
    const batch = await migrateLegacyForeignReferences(database, {
      limit: FOREIGN_REFERENCE_BATCH_SIZE,
    });
    processed += batch.processedDocuments;
    if (batch.failedDocuments > 0 || batch.errors.length > 0) {
      throw new BlockFirstFinalizationError(
        `Legacy foreign references could not be made reference-only: ${batch.errors
          .map((error) => `${error.documentId}: ${error.message}`)
          .join("; ")}`,
      );
    }
    if (batch.exhausted) return processed;
    if (batch.processedDocuments > 0) continue;
    throw new BlockFirstFinalizationError(
      "Legacy foreign-reference migration made no progress",
    );
  }
};

const readRemainingLegacyCardDocuments = (
  database: Database.Database,
): readonly RemainingLegacyCardDocumentRow[] =>
  database
    .prepare(
      `
      SELECT
        document.id AS document_id,
        owner.id AS owner_block_id,
        owner.lifecycle AS owner_lifecycle,
        document.generation,
        document.head_seq,
        document.readiness
      FROM documents document
      INNER JOIN block_documents ownership
        ON ownership.document_id = document.id
       AND ownership.project_id = document.project_id
      INNER JOIN blocks owner
        ON owner.id = ownership.block_id
       AND owner.project_id = ownership.project_id
      WHERE owner.type = 'card'
        AND document.authority = 'legacy_shadow'
      ORDER BY document.id
    `,
    )
    .all() as readonly RemainingLegacyCardDocumentRow[];

const assertReferenceOnlyDocument = (
  database: Database.Database,
  documentId: string,
): void => {
  const loaded = loadLegacyShadowBlockDocument(database, documentId);
  try {
    const materialization = materializeCardDocument(loaded.document);
    const foreign = materialization.references.find(
      isLegacyForeignBodyReference,
    );
    if (!foreign) return;
    throw new BlockFirstFinalizationError(
      `Deleted Card Document ${documentId} still contains foreign body projection ${foreign.sourceBlockId}`,
    );
  } finally {
    loaded.document.destroy();
  }
};

const initializeDeletedDocument = (
  database: Database.Database,
  row: RemainingLegacyCardDocumentRow,
): void => {
  const genesis = createCardDocumentGenesis({
    documentId: row.document_id,
    title: "",
    nfm: "",
    allocateBlockId: createUuidV7,
  });
  try {
    const initialize = database.transaction(() => {
      const madeReadable = database
        .prepare(
          `
          UPDATE blocks
          SET lifecycle = 'archived'
          WHERE id = ? AND lifecycle = 'deleted'
        `,
        )
        .run(row.owner_block_id);
      if (madeReadable.changes !== 1) {
        throw new BlockFirstFinalizationError(
          `Deleted Card ${row.owner_block_id} changed during finalization`,
        );
      }
      initializeBlockDocumentGenesis(database, {
        documentId: row.document_id,
        storeEpoch: requireBlockStoreEpoch(database),
        generation: row.generation,
        updateId: `block-first-finalization:${row.document_id}`,
        clientSessionId: FINALIZATION_CLIENT_SESSION_ID,
        update: genesis.update,
        finalAuthority: "ydoc_primary",
      });
      const restoredTombstone = database
        .prepare(
          `
          UPDATE blocks
          SET lifecycle = 'deleted'
          WHERE id = ? AND lifecycle = 'archived'
        `,
        )
        .run(row.owner_block_id);
      if (restoredTombstone.changes !== 1) {
        throw new BlockFirstFinalizationError(
          `Deleted Card ${row.owner_block_id} could not restore its tombstone`,
        );
      }
    });
    initialize.immediate();
  } finally {
    genesis.document.destroy();
  }
};

const finalizeDeletedCardDocuments = (
  database: Database.Database,
): number => {
  const remaining = readRemainingLegacyCardDocuments(database);
  for (const row of remaining) {
    if (row.owner_lifecycle !== "deleted") {
      throw new BlockFirstFinalizationError(
        `Retained Card ${row.owner_block_id} did not cut over to Y.Doc authority`,
      );
    }
    if (row.readiness === "failed") {
      throw new BlockFirstFinalizationError(
        `Deleted Card Document ${row.document_id} is failed`,
      );
    }
    if (row.readiness === "pending_genesis") {
      initializeDeletedDocument(database, row);
      continue;
    }
    assertReferenceOnlyDocument(database, row.document_id);
    const updated = database
      .prepare(
        `
        UPDATE documents
        SET authority = 'ydoc_primary', updated_at = ?
        WHERE id = ? AND generation = ? AND head_seq = ?
          AND readiness = 'ready' AND authority = 'legacy_shadow'
      `,
      )
      .run(
        new Date().toISOString(),
        row.document_id,
        row.generation,
        row.head_seq,
      );
    if (updated.changes !== 1) {
      throw new BlockFirstFinalizationError(
        `Deleted Card Document ${row.document_id} changed during authority finalization`,
      );
    }
  }
  return remaining.length;
};

const assertCanonicalCardDocuments = (
  database: Database.Database,
): void => {
  const invalid = database
    .prepare(
      `
      SELECT owner.id, document.id AS document_id,
             document.readiness, document.authority
      FROM blocks owner
      LEFT JOIN block_documents ownership ON ownership.block_id = owner.id
      LEFT JOIN documents document ON document.id = ownership.document_id
      WHERE owner.type = 'card'
        AND (
          document.id IS NULL
          OR document.readiness <> 'ready'
          OR document.authority <> 'ydoc_primary'
        )
      LIMIT 1
    `,
    )
    .get() as
    | {
        readonly id: string;
        readonly document_id: string | null;
        readonly readiness: string | null;
        readonly authority: string | null;
      }
    | undefined;
  if (!invalid) return;
  throw new BlockFirstFinalizationError(
    `Card ${invalid.id} has invalid final Document ${invalid.document_id ?? "missing"} (${invalid.readiness ?? "missing"}/${invalid.authority ?? "missing"})`,
  );
};

/**
 * Complete the one-way Block-first migration before removing compatibility
 * storage. The fixed point is intentionally content-aware and runs before the
 * schema drop: a recovered inline snapshot may create another legacy Card,
 * which in turn requires one more shadow/import/cutover round.
 */
export const finalizeBlockFirstAuthority = async (
  database: Database.Database,
  targetSchemaVersion = 70,
): Promise<BlockFirstFinalizationResult> => {
  // Older v69 builds compared persisted toggle disclosure markers even though
  // Card Documents deliberately keep disclosure state window-local. Retrying
  // only that obsolete failure is safe: the failed attempt rolled back, the
  // job remains fenced to the same source revision, and any current failure
  // still fails closed below.
  const requeuedObsoleteParityFailures =
    requeueObsoleteToggleDisclosureParityFailures(database);
  let shadowJobsProcessed = 0;
  let foreignDocumentsProcessed = 0;
  let cutoverDocuments = 0;
  let reachedFixedPoint = false;

  for (let round = 0; round < MAX_FIXED_POINT_ROUNDS; round += 1) {
    shadowJobsProcessed += drainLegacyShadows(database);
    const migrated = await migrateForeignReferences(database);
    foreignDocumentsProcessed += migrated;
    if (migrated > 0) continue;

    const cutover = cutoverEligibleCardDocumentsToPrimary(database);
    cutoverDocuments += cutover.cutoverDocumentIds.length;
    if (cutover.deferredForeignReferences > 0) {
      throw new BlockFirstFinalizationError(
        `${cutover.deferredForeignReferences} Card Document(s) still contain foreign-body projections`,
      );
    }
    reachedFixedPoint = true;
    break;
  }
  if (!reachedFixedPoint) {
    throw new BlockFirstFinalizationError(
      `Block-first authority migration did not converge after ${MAX_FIXED_POINT_ROUNDS} rounds`,
    );
  }

  const finalizedDeletedDocuments = finalizeDeletedCardDocuments(database);
  assertCanonicalCardDocuments(database);
  const droppedTables = dropLegacyBlockFirstTables(
    database,
    targetSchemaVersion,
  );
  return {
    requeuedObsoleteParityFailures,
    shadowJobsProcessed,
    foreignDocumentsProcessed,
    cutoverDocuments,
    finalizedDeletedDocuments,
    // Retired schemas are deliberately absent from the live projection
    // registry. initializeDatabase repairs these projections after the
    // synchronous schema edges advance every Card to the current descriptor.
    repairedDocumentProjections: 0,
    droppedTables,
  };
};
