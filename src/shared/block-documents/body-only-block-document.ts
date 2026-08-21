import * as Y from "yjs";
import { BLOCK_GROUP_NODE_NAME } from "./block-structure";
import type { DocumentId } from "./contracts";

export const BODY_ONLY_DOCUMENT_ROOT_KEY = "body";

export interface BodyOnlyBlockDocumentEnvelope {
  readonly documentId: DocumentId;
  readonly document: Y.Doc;
  readonly body: Y.XmlFragment;
}

export interface BodyOnlyBlockDocumentSchemaIdentity {
  readonly label: string;
  readonly makeRootError?: (message: string) => Error;
}

export interface CreateBodyOnlyBlockDocumentOptions extends BodyOnlyBlockDocumentSchemaIdentity {
  readonly documentId: DocumentId;
  readonly initializeBody?: boolean;
  readonly gc?: boolean;
}

export class BodyOnlyBlockDocumentRootValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "BodyOnlyBlockDocumentRootValidationError";
  }
}

const makeRootError = (schema: BodyOnlyBlockDocumentSchemaIdentity, message: string): Error =>
  schema.makeRootError?.(message) ?? new BodyOnlyBlockDocumentRootValidationError(message);

const requireDocumentId = (
  documentId: DocumentId,
  schema: BodyOnlyBlockDocumentSchemaIdentity,
): DocumentId => {
  if (documentId.length > 0 && documentId === documentId.trim()) {
    return documentId;
  }
  throw new TypeError(`${schema.label} documentId must be a non-empty identity`);
};

export const openBodyOnlyBlockDocument = (
  document: Y.Doc,
  schema: BodyOnlyBlockDocumentSchemaIdentity,
): BodyOnlyBlockDocumentEnvelope => {
  let body: Y.XmlFragment;
  try {
    body = document.getXmlFragment(BODY_ONLY_DOCUMENT_ROOT_KEY);
  } catch {
    throw makeRootError(
      schema,
      `${schema.label} document root "${BODY_ONLY_DOCUMENT_ROOT_KEY}" has an incompatible Yjs type`,
    );
  }
  return { documentId: document.guid, document, body };
};

export const assertValidBodyOnlyBlockDocumentRoots = (
  document: Y.Doc,
  schema: BodyOnlyBlockDocumentSchemaIdentity,
): BodyOnlyBlockDocumentEnvelope => {
  const envelope = openBodyOnlyBlockDocument(document, schema);
  const unexpectedRoots = [...document.share.keys()].filter(
    (key) => key !== BODY_ONLY_DOCUMENT_ROOT_KEY,
  );
  if (unexpectedRoots.length === 0) return envelope;
  throw makeRootError(
    schema,
    `${schema.label} document contains unsupported named roots: ${unexpectedRoots.join(", ")}`,
  );
};

export const createBodyOnlyBlockDocument = ({
  documentId,
  initializeBody = true,
  gc = true,
  ...schema
}: CreateBodyOnlyBlockDocumentOptions): BodyOnlyBlockDocumentEnvelope => {
  const document = new Y.Doc({
    guid: requireDocumentId(documentId, schema),
    gc,
  });
  const envelope = openBodyOnlyBlockDocument(document, schema);
  if (initializeBody) {
    envelope.body.insert(0, [new Y.XmlElement(BLOCK_GROUP_NODE_NAME)]);
  }
  return envelope;
};
