import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createCanonicalEmptyParagraphBlock } from "../../shared/block-documents/block-document-codec";
import {
  DOCUMENT_OPERATION_CONTRACT_VERSION,
  type DocumentOperationBatch,
} from "../../shared/block-documents/document-operations";
import {
  getRegisteredBlockDocumentSchemaAdapter,
  inspectRegisteredOwnedBlockDocument,
} from "../../shared/block-documents/document-schema-adapters";
import type { OwnedBlockDocumentDescriptor } from "../../shared/block-documents";
import { getOwnedBlockDocumentDescriptor } from "./block-document-cutover";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { loadBlockDocument } from "./block-document-store";

export interface PreparedEditableOwnedBlockDocument {
  readonly descriptor: OwnedBlockDocumentDescriptor;
  readonly repairedEmptyRoot: boolean;
}

const coordinateDigest = (
  descriptor: OwnedBlockDocumentDescriptor,
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
  const descriptor = getOwnedBlockDocumentDescriptor(
    database,
    projectId,
    ownerBlockId,
  );
  if (
    descriptor.ownerLifecycle !== "active" ||
    descriptor.readiness !== "ready" ||
    descriptor.authority !== "ydoc_primary"
  ) {
    return { descriptor, repairedEmptyRoot: false };
  }

  const adapter = getRegisteredBlockDocumentSchemaAdapter({
    ownerType: descriptor.ownerType,
    schemaKey: descriptor.schemaKey,
    schemaVersion: descriptor.schemaVersion,
  });
  if (adapter.contentModel !== "block_tree") {
    return { descriptor, repairedEmptyRoot: false };
  }

  const loaded = loadBlockDocument(database, descriptor.documentId);
  try {
    const inspection = inspectRegisteredOwnedBlockDocument(loaded.document, {
      ownerType: descriptor.ownerType,
      schemaKey: descriptor.schemaKey,
      schemaVersion: descriptor.schemaVersion,
    });
    if (!("blocks" in inspection) || inspection.blocks.length > 0) {
      return { descriptor, repairedEmptyRoot: false };
    }
  } finally {
    loaded.document.destroy();
  }

  const digest = coordinateDigest(descriptor);
  const request: DocumentOperationBatch = {
    version: DOCUMENT_OPERATION_CONTRACT_VERSION,
    mutationId: `system:editable-root:${digest}`,
    projectId: descriptor.projectId,
    storeEpoch: descriptor.storeEpoch,
    clientSessionId: "system:owned-document-prepare",
    actor: {
      kind: "system",
      reason: "ensure_editable_block_document",
    },
    documentId: descriptor.documentId,
    generation: descriptor.generation,
    expectedHeadSeq: descriptor.headSeq,
    operations: [
      {
        kind: "insert_block",
        block: createCanonicalEmptyParagraphBlock(
          `block:editable-root:${digest}`,
        ),
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
    descriptor: getOwnedBlockDocumentDescriptor(
      database,
      projectId,
      ownerBlockId,
    ),
    repairedEmptyRoot: !result.value.duplicate,
  };
};
