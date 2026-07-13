import * as Y from "yjs";
import { MAX_CARD_TITLE_LENGTH } from "../card-limits";
import { BLOCK_GROUP_NODE_NAME } from "./block-structure";
import type { DocumentId } from "./contracts";
import {
  PortableRichTextError,
  readPortableRichTextFromYText,
} from "./portable-rich-text";

export const CARD_DOCUMENT_SCHEMA_KEY = "nodex.card";
export const CARD_DOCUMENT_SCHEMA_VERSION = 2;
export const CARD_DOCUMENT_TITLE_KEY = "title";
export const CARD_DOCUMENT_BODY_KEY = "body";

export interface CardDocumentEnvelope {
  readonly documentId: DocumentId;
  readonly document: Y.Doc;
  readonly title: Y.Text;
  readonly body: Y.XmlFragment;
}

export interface CreateCardDocumentOptions {
  readonly documentId: DocumentId;
  readonly initialTitle?: string;
  /** Genesis codecs may let BlockNote create the canonical body root directly. */
  readonly initializeBody?: boolean;
  readonly gc?: boolean;
}

export class CardDocumentRootValidationError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CardDocumentRootValidationError";
  }
}

const resolveCanonicalRoot = <Root>(
  key: string,
  resolve: () => Root,
): Root => {
  try {
    return resolve();
  } catch (error) {
    throw new TypeError(`Card document root "${key}" has an incompatible Yjs type`, {
      cause: error,
    });
  }
};

export const openCardDocument = (document: Y.Doc): CardDocumentEnvelope => {
  // Updates loaded into a fresh Y.Doc initially expose named roots as Yjs'
  // generic AbstractType placeholders. The typed getters resolve those
  // placeholders and still throw when a root was genuinely created with an
  // incompatible constructor.
  const title = resolveCanonicalRoot(
    CARD_DOCUMENT_TITLE_KEY,
    () => document.getText(CARD_DOCUMENT_TITLE_KEY),
  );
  const body = resolveCanonicalRoot(
    CARD_DOCUMENT_BODY_KEY,
    () => document.getXmlFragment(CARD_DOCUMENT_BODY_KEY),
  );

  return {
    documentId: document.guid,
    document,
    title,
    body,
  };
};

export const assertValidCardDocumentRoots = (
  document: Y.Doc,
): CardDocumentEnvelope => {
  const envelope = openCardDocument(document);
  const unexpectedRoots = [...document.share.keys()].filter(
    (key) => key !== CARD_DOCUMENT_TITLE_KEY && key !== CARD_DOCUMENT_BODY_KEY,
  );
  if (unexpectedRoots.length > 0) {
    throw new CardDocumentRootValidationError(
      `Card document contains unsupported named roots: ${unexpectedRoots.join(", ")}`,
    );
  }
  try {
    readPortableRichTextFromYText(envelope.title);
  } catch (error) {
    if (!(error instanceof PortableRichTextError)) throw error;
    throw new CardDocumentRootValidationError(
      `Card document title is not canonical rich text: ${error.message}`,
      { cause: error },
    );
  }
  if (Object.keys(envelope.title.getAttributes()).length > 0) {
    throw new CardDocumentRootValidationError(
      "Card document title contains hidden map attributes",
    );
  }
  return envelope;
};

/** Migration/history reader for the former plain-title schema only. */
export const assertValidLegacyCardDocumentRoots = (
  document: Y.Doc,
): CardDocumentEnvelope => {
  const envelope = openCardDocument(document);
  const unexpectedRoots = [...document.share.keys()].filter(
    (key) => key !== CARD_DOCUMENT_TITLE_KEY && key !== CARD_DOCUMENT_BODY_KEY,
  );
  if (unexpectedRoots.length > 0) {
    throw new CardDocumentRootValidationError(
      `Legacy Card document contains unsupported named roots: ${unexpectedRoots.join(", ")}`,
    );
  }
  for (const operation of envelope.title.toDelta()) {
    if (
      typeof operation.insert !== "string" ||
      (operation.attributes && Object.keys(operation.attributes).length > 0)
    ) {
      throw new CardDocumentRootValidationError(
        "Legacy Card document title must contain unformatted text only",
      );
    }
  }
  if (
    Object.keys(envelope.title.getAttributes()).length > 0 ||
    envelope.title.length > MAX_CARD_TITLE_LENGTH
  ) {
    throw new CardDocumentRootValidationError(
      "Legacy Card document title contains unsupported attributes or length",
    );
  }
  return envelope;
};

export const createCardDocument = ({
  documentId,
  initialTitle = "",
  initializeBody = true,
  gc = true,
}: CreateCardDocumentOptions): CardDocumentEnvelope => {
  if (documentId.trim().length === 0) {
    throw new TypeError("Card documentId must not be empty");
  }

  const envelope = openCardDocument(new Y.Doc({ guid: documentId, gc }));
  envelope.document.transact(() => {
    if (initialTitle.length > 0) {
      envelope.title.insert(0, initialTitle);
    }
    if (initializeBody) {
      envelope.body.insert(0, [new Y.XmlElement(BLOCK_GROUP_NODE_NAME)]);
    }
  });
  return envelope;
};
