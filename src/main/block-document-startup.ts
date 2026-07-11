import type { BlockDocumentShadowInitializationResult } from "./card-mutation-worker-protocol";
import type { CutoverEligibleCardDocumentsResult } from "./local-store/block-document-cutover";
import type { ForeignReferenceMigrationBatchResult } from "./local-store/foreign-reference-migration";

const STARTUP_FIXED_POINT_LIMIT = 100;

interface ResultEnvelope<T> {
  readonly result: T;
}

export interface BlockDocumentStartupWriter {
  readonly initializeBlockDocumentShadows: () => Promise<
    ResultEnvelope<BlockDocumentShadowInitializationResult>
  >;
  readonly migrateLegacyForeignReferences: () => Promise<
    ResultEnvelope<ForeignReferenceMigrationBatchResult>
  >;
  readonly cutoverEligibleCardDocuments: () => Promise<
    ResultEnvelope<CutoverEligibleCardDocumentsResult>
  >;
}

const drainLegacyShadows = async (
  writer: BlockDocumentStartupWriter,
): Promise<void> => {
  while (true) {
    const envelope = await writer.initializeBlockDocumentShadows();
    const shadow = envelope.result;
    if (shadow.errors > 0 || shadow.failed > 0) {
      throw new Error(
        `Block Document shadow initialization did not reach parity: ${JSON.stringify(shadow)}`,
      );
    }
    if (shadow.exhausted) return;
    if (shadow.processed > 0) continue;
    throw new Error("Block Document shadow initialization made no progress");
  }
};

const drainForeignReferences = async (
  writer: BlockDocumentStartupWriter,
): Promise<number> => {
  let processedDocuments = 0;
  while (true) {
    const envelope = await writer.migrateLegacyForeignReferences();
    const migration = envelope.result;
    processedDocuments += migration.processedDocuments;
    if (migration.failedDocuments > 0 || migration.errors.length > 0) {
      throw new Error(
        `Legacy foreign-reference migration failed: ${JSON.stringify(migration.errors)}`,
      );
    }
    if (migration.exhausted) return processedDocuments;
    if (migration.processedDocuments > 0) continue;
    throw new Error("Legacy foreign-reference migration made no progress");
  }
};

/**
 * Reach a stable shadow/migration fixed point before flipping any active Card
 * to Y.Doc authority. A migration can create a recovered Card (and therefore a
 * new shadow job), so one shadow -> migration -> shadow pass is insufficient.
 */
export const prepareBlockDocumentAuthorityForStartup = async (
  writer: BlockDocumentStartupWriter,
): Promise<CutoverEligibleCardDocumentsResult> => {
  for (let round = 0; round < STARTUP_FIXED_POINT_LIMIT; round += 1) {
    await drainLegacyShadows(writer);
    const migratedDocuments = await drainForeignReferences(writer);
    if (migratedDocuments > 0) continue;

    const cutover = await writer.cutoverEligibleCardDocuments();
    if (cutover.result.deferredForeignReferences === 0) return cutover.result;
    throw new Error(
      `${cutover.result.deferredForeignReferences} Card Documents still contain legacy foreign-body projections`,
    );
  }

  throw new Error(
    `Block Document startup did not reach a fixed point after ${STARTUP_FIXED_POINT_LIMIT} rounds`,
  );
};
