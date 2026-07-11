import * as Y from "yjs";
import { BLOCK_GROUP_NODE_NAME } from "./block-structure";
import type { DocumentId } from "./contracts";

export const SYNCED_BLOCK_SOURCE_TYPE = "synced_block_source";
export const SYNCED_BLOCK_REFERENCE_TYPE = "syncedBlockRef";
export const SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY = "nodex.synced-block";
export const SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION = 1;
export const SYNCED_BLOCK_DOCUMENT_BODY_KEY = "body";

export interface SyncedBlockDocumentEnvelope {
  readonly documentId: DocumentId;
  readonly document: Y.Doc;
  readonly body: Y.XmlFragment;
}

export interface CreateSyncedBlockDocumentOptions {
  readonly documentId: DocumentId;
  readonly initializeBody?: boolean;
  readonly gc?: boolean;
}

export class SyncedBlockDocumentRootValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "SyncedBlockDocumentRootValidationError";
  }
}

export const openSyncedBlockDocument = (
  document: Y.Doc,
): SyncedBlockDocumentEnvelope => {
  let body: Y.XmlFragment;
  try {
    body = document.getXmlFragment(SYNCED_BLOCK_DOCUMENT_BODY_KEY);
  } catch {
    throw new SyncedBlockDocumentRootValidationError(
      `Synced Block document root "${SYNCED_BLOCK_DOCUMENT_BODY_KEY}" has an incompatible Yjs type`,
    );
  }
  return {
    documentId: document.guid,
    document,
    body,
  };
};

export const assertValidSyncedBlockDocumentRoots = (
  document: Y.Doc,
): SyncedBlockDocumentEnvelope => {
  const envelope = openSyncedBlockDocument(document);
  const unexpectedRoots = [...document.share.keys()].filter(
    (key) => key !== SYNCED_BLOCK_DOCUMENT_BODY_KEY,
  );
  if (unexpectedRoots.length === 0) return envelope;
  throw new SyncedBlockDocumentRootValidationError(
    `Synced Block document contains unsupported named roots: ${unexpectedRoots.join(", ")}`,
  );
};

export const createSyncedBlockDocument = ({
  documentId,
  initializeBody = true,
  gc = true,
}: CreateSyncedBlockDocumentOptions): SyncedBlockDocumentEnvelope => {
  if (documentId.trim().length === 0) {
    throw new TypeError("Synced Block documentId must not be empty");
  }
  const envelope = openSyncedBlockDocument(new Y.Doc({ guid: documentId, gc }));
  if (initializeBody) {
    envelope.body.insert(0, [new Y.XmlElement(BLOCK_GROUP_NODE_NAME)]);
  }
  return envelope;
};
