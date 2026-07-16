import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createUuidV7 } from "../../shared/uuid-v7";
import { createCanonicalEmptyParagraphBlock } from "../../shared/block-documents/block-document-codec";
import {
  DOCUMENT_OPERATION_CONTRACT_VERSION,
  type DocumentOperationBatch,
} from "../../shared/block-documents/document-operations";
import { inspectOwnedBlockDocument } from "../../shared/block-documents/document-schema-adapters";
import type { OwnedDocumentDescriptor } from "../../shared/block-documents/contracts";
import { getOwnedDocumentAccess } from "./block-document-cutover";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { loadBlockDocument } from "./block-document-store";

export interface PreparedEditableOwnedBlockDocument {
  readonly descriptor: OwnedDocumentDescriptor;
  readonly repairedEmptyRoot: boolean;
}

const coordinateDigest = (
  descriptor: OwnedDocumentDescriptor,
): string =>
  createHash("sha256")
    .update(descriptor.storeEpoch)
    .update("\0")
    .update(descriptor.documentId)
    .update("\0")
    .update(String(descriptor.generation))
    .update("\0")
    .update(String(descriptor.headSeq))
    .digest("hex");

/**
 * Makes a BlockNote-backed authority mountable before a renderer/provider can
 * observe it. The one SQLite writer serializes this lazy repair, so two windows
 * preparing the same historical empty Document converge on one registered
 * paragraph instead of racing editor-generated placeholder Blocks.
 */
export const prepareEditableOwnedBlockDocument = (
  database: Database.Database,
  projectId: string,
  ownerBlockId: string,
): PreparedEditableOwnedBlockDocument => {
  const access = getOwnedDocumentAccess(
    database,
    projectId,
    ownerBlockId,
    "read",
  );
  const { descriptor } = access;
  if (
    descriptor.ownerLifecycle !== "active" ||
    descriptor.readiness !== "ready" ||
    descriptor.sync.kind !== "yjs"
  ) {
    return { descriptor, repairedEmptyRoot: false };
  }

  const loaded = loadBlockDocument(database, descriptor.documentId);
  try {
    const inspection = inspectOwnedBlockDocument(loaded.document, {
      ownerType: descriptor.ownerType,
      schemaKey: descriptor.schemaKey,
      schemaVersion: descriptor.schemaVersion,
    });
    if (inspection.blocks.length > 0) {
      return { descriptor, repairedEmptyRoot: false };
    }
  } finally {
    loaded.document.destroy();
  }

  const writableAccess = getOwnedDocumentAccess(
    database,
    projectId,
    ownerBlockId,
    "write",
  );
  const digest = coordinateDigest(writableAccess.descriptor);
  const request: DocumentOperationBatch = {
    version: DOCUMENT_OPERATION_CONTRACT_VERSION,
    mutationId: `system:editable-root:${digest}`,
    projectId: writableAccess.storageProjectId,
    storeEpoch: writableAccess.descriptor.storeEpoch,
    clientSessionId: "system:owned-document-prepare",
    actor: {
      kind: "system",
      reason: "ensure_editable_block_document",
    },
    documentId: writableAccess.descriptor.documentId,
    generation: writableAccess.descriptor.generation,
    expectedHeadSeq: writableAccess.descriptor.headSeq,
    operations: [
      {
        kind: "insert_block",
        block: createCanonicalEmptyParagraphBlock(createUuidV7()),
      },
    ],
  };
  const result = applyDocumentOperationBatch(database, request);
  if (!result.ok) {
    throw new Error(
      `Could not prepare editable Document ${descriptor.documentId}: ${result.error.message}`,
    );
  }
  return {
    descriptor: getOwnedDocumentAccess(
      database,
      projectId,
      ownerBlockId,
      "write",
    ).descriptor,
    repairedEmptyRoot: !result.value.duplicate,
  };
};
