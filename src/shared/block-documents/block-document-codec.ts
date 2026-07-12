import { BlockNoteEditor } from "@blocknote/core";
import {
  blocksToYXmlFragment,
  yXmlFragmentToBlocks,
} from "@blocknote/core/yjs";
import * as Y from "yjs";
import { createUuidV7 } from "../card-id";
import { extractPlainText } from "../nfm/extract-text";
import { parseNfm } from "../nfm/parser";
import { serializeNfm } from "../nfm/serializer";
import {
  assertValidBlockDocument,
  BLOCK_GROUP_NODE_NAME,
  collectChildlessBlockViolations,
  type ScannedDocumentBlock,
} from "./block-structure";
import {
  assertValidCardDocumentRoots,
  CARD_DOCUMENT_SCHEMA_VERSION,
  createCardDocument,
} from "./card-document";
import type { BlockId, DocumentId } from "./contracts";
import {
  deriveBlockDocumentRecords,
  type BlockDocumentAssetReference,
  type BlockDocumentReference,
} from "./derived-records";
import { headlessBlockDocumentSchema } from "./headless-blocknote-schema";
import {
  blockNoteToNfm,
  nfmToBlockNote,
  nfmToBlockNoteWithIds,
  type BlockNoteBlockValue,
} from "./nfm-blocknote-adapter";

export type BlockTreeValue =
  | null
  | boolean
  | number
  | string
  | readonly BlockTreeValue[]
  | { readonly [key: string]: BlockTreeValue };

export interface BlockTreeNode {
  readonly id: BlockId;
  readonly type: string;
  readonly props: Readonly<Record<string, BlockTreeValue>>;
  readonly content?: BlockTreeValue;
  readonly children: readonly BlockTreeNode[];
}

export type {
  BlockDocumentAssetReference,
  BlockDocumentReference,
} from "./derived-records";

export interface CardDocumentMaterialization {
  readonly schemaVersion: number;
  readonly title: string;
  readonly blockTree: readonly BlockTreeNode[];
  readonly nfm: string;
  readonly plainText: string;
  readonly preview: string;
  readonly references: readonly BlockDocumentReference[];
  readonly assetRefs: readonly BlockDocumentAssetReference[];
}

/**
 * Common projection shape for every BlockNote-backed Document schema.
 *
 * `title` is a projection field, not proof that a schema owns a Y.Text root.
 * Body-only schemas deliberately materialize it as an empty string so the
 * existing relational projection remains rebuildable without inventing a
 * hidden collaborative title root.
 */
export type BlockDocumentMaterialization = CardDocumentMaterialization;

export interface CreateCardDocumentGenesisInput {
  readonly documentId: DocumentId;
  readonly title: string;
  readonly nfm: string;
  readonly allocateBlockId?: () => BlockId;
}

export interface CardDocumentGenesis {
  readonly document: Y.Doc;
  readonly update: Uint8Array;
  readonly stateVector: Uint8Array;
  readonly materialization: CardDocumentMaterialization;
}

export interface CreateDetachedCardDocumentFromBlockTreeInput {
  readonly documentId: DocumentId;
  readonly title?: string;
  readonly blockTree: readonly BlockTreeNode[];
}

export interface DetachedCardDocumentFromBlockTree {
  readonly document: Y.Doc;
  readonly materialization: CardDocumentMaterialization;
}

export interface CardDocumentMigrationResult {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly changed: boolean;
  readonly update: Uint8Array;
}

export class BlockDocumentCodecError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlockDocumentCodecError";
  }
}

/**
 * Canonicalize imported NFM to the durable semantics representable by a
 * BlockNote-backed Document. Disclosure state is intentionally omitted: an
 * expanded toggle is window-local UI state, not collaborative Card content.
 */
export const canonicalizeNfmForBlockDocument = (nfm: string): string =>
  serializeNfm(blockNoteToNfm(nfmToBlockNote(parseNfm(nfm))));

const headlessEditor = BlockNoteEditor.create({
  schema: headlessBlockDocumentSchema,
});

const ensureCanonicalBodyRoot = (body: Y.XmlFragment): void => {
  if (body.length > 0) return;
  body.insert(0, [new Y.XmlElement(BLOCK_GROUP_NODE_NAME)]);
};

export const populateBlockDocumentBodyFromNfm = (
  body: Y.XmlFragment,
  nfm: string,
  allocateBlockId: () => BlockId = createUuidV7,
): void => {
  const blockNoteBlocks = nfmToBlockNoteWithIds(parseNfm(nfm), allocateBlockId);
  blocksToYXmlFragment(
    headlessEditor,
    blockNoteBlocks as (typeof headlessBlockDocumentSchema.Block)[],
    body,
  );
  ensureCanonicalBodyRoot(body);
};

export const populateBlockDocumentBodyFromBlockTree = (
  body: Y.XmlFragment,
  blockTree: readonly BlockTreeNode[],
): void => {
  blocksToYXmlFragment(
    headlessEditor,
    blockTree as (typeof headlessBlockDocumentSchema.Block)[],
    body,
  );
  ensureCanonicalBodyRoot(body);
};

const OMIT_VALUE = Symbol("omit-block-tree-value");

const cloneBlockTreeValue = (
  value: unknown,
  ancestors = new Set<object>(),
): BlockTreeValue | typeof OMIT_VALUE => {
  if (value === undefined) return OMIT_VALUE;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new BlockDocumentCodecError(
        "Block tree values must contain finite numbers",
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new BlockDocumentCodecError(
      `Unsupported Block tree value: ${typeof value}`,
    );
  }
  if (ancestors.has(value)) {
    throw new BlockDocumentCodecError(
      "Block tree values must not contain cycles",
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const cloned = cloneBlockTreeValue(entry, nextAncestors);
      return cloned === OMIT_VALUE ? null : cloned;
    });
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new BlockDocumentCodecError(
      `Unsupported Block tree object: ${value.constructor.name}`,
    );
  }

  const entries = Object.entries(value).flatMap(([key, entry]) => {
    const cloned = cloneBlockTreeValue(entry, nextAncestors);
    return cloned === OMIT_VALUE ? [] : [[key, cloned] as const];
  });
  return Object.fromEntries(entries);
};

const cloneProps = (
  props: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, BlockTreeValue>> => {
  const cloned = cloneBlockTreeValue(props ?? {});
  if (
    cloned === OMIT_VALUE ||
    typeof cloned !== "object" ||
    cloned === null ||
    Array.isArray(cloned)
  ) {
    throw new BlockDocumentCodecError("Block props must be a portable object");
  }
  return cloned as Readonly<Record<string, BlockTreeValue>>;
};

const toBlockTree = (
  blocks: readonly BlockNoteBlockValue[],
): readonly BlockTreeNode[] =>
  blocks.map((block) => {
    if (!block.id) {
      throw new BlockDocumentCodecError(
        "Materialized Block is missing its identity",
      );
    }
    const content = cloneBlockTreeValue(block.content);
    return {
      id: block.id,
      type: block.type,
      props: cloneProps(block.props),
      ...(content === OMIT_VALUE ? {} : { content }),
      children: toBlockTree(block.children ?? []),
    };
  });

const flattenBlockTree = (
  blocks: readonly BlockTreeNode[],
  parentBlockId: BlockId | null = null,
): readonly {
  readonly block: BlockTreeNode;
  readonly parentBlockId: BlockId | null;
}[] =>
  blocks.flatMap((block) => [
    { block, parentBlockId },
    ...flattenBlockTree(block.children, block.id),
  ]);

const blockTreeValuesEqual = (
  left: BlockTreeValue | undefined,
  right: BlockTreeValue | undefined,
): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => blockTreeValuesEqual(entry, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  const leftEntries = Object.entries(left);
  const rightRecord = right as Readonly<Record<string, BlockTreeValue>>;
  return leftEntries.every(
    ([key, value]) =>
      Object.hasOwn(rightRecord, key) &&
      blockTreeValuesEqual(value, rightRecord[key]),
  );
};

const requestedBlockSemanticsArePreserved = (
  requested: BlockTreeNode,
  actual: BlockTreeNode,
): boolean =>
  blockTreeValuesEqual(requested.props, actual.props) &&
  (!Object.hasOwn(requested, "content") ||
    blockTreeValuesEqual(requested.content, actual.content));

const assertMaterializationMatchesScan = (
  blockTree: readonly BlockTreeNode[],
  scannedBlocks: readonly ScannedDocumentBlock[],
): void => {
  const materializedBlocks = flattenBlockTree(blockTree);
  if (materializedBlocks.length !== scannedBlocks.length) {
    throw new BlockDocumentCodecError(
      "BlockNote materialization does not match the persisted Block registry",
    );
  }
  materializedBlocks.forEach(({ block, parentBlockId }, index) => {
    const scanned = scannedBlocks[index];
    if (
      !scanned ||
      scanned.id !== block.id ||
      scanned.blockType !== block.type ||
      scanned.parentBlockId !== parentBlockId
    ) {
      throw new BlockDocumentCodecError(
        `BlockNote materialization diverges at Block ${block.id}`,
      );
    }
  });
};

const assertCanonicalChildlessBlocks = (
  body: Y.XmlFragment,
): void => {
  const violation = collectChildlessBlockViolations(body)[0];
  if (!violation) return;
  throw new BlockDocumentCodecError(
    `Childless ${violation.blockType} Block ${violation.blockId ?? "unknown"} must not contain child Blocks`,
  );
};

const buildPreview = (plainText: string): string => {
  if (plainText.length <= 240) return plainText;
  return `${plainText.slice(0, 240).trimEnd()}...`;
};

export interface MaterializeBlockDocumentBodyInput {
  readonly body: Y.XmlFragment;
  readonly schemaVersion: number;
  readonly title?: string;
  readonly schemaLabel: string;
}

/** DOM-neutral materializer shared by registered BlockNote Document schemas. */
export const materializeBlockDocumentBody = ({
  body,
  schemaVersion,
  title = "",
  schemaLabel,
}: MaterializeBlockDocumentBodyInput): BlockDocumentMaterialization => {
  const scannedBlocks = assertValidBlockDocument(body);
  assertCanonicalChildlessBlocks(body);
  let blockNoteBlocks: readonly BlockNoteBlockValue[] = [];
  if (scannedBlocks.length > 0) {
    try {
      blockNoteBlocks = yXmlFragmentToBlocks(
        headlessEditor,
        body,
      ) as readonly BlockNoteBlockValue[];
    } catch (error) {
      throw new BlockDocumentCodecError(
        `${schemaLabel} body cannot be decoded with the canonical BlockNote schema`,
        { cause: error },
      );
    }
  }

  const blockTree = toBlockTree(blockNoteBlocks);
  assertMaterializationMatchesScan(blockTree, scannedBlocks);
  const nfmBlocks = blockNoteToNfm(blockNoteBlocks);
  const nfm = serializeNfm(nfmBlocks);
  const { references, assetRefs } = deriveBlockDocumentRecords(
    blockTree,
    nfmBlocks,
  );
  const plainText = extractPlainText(nfm);

  return {
    schemaVersion,
    title,
    blockTree,
    nfm,
    plainText,
    preview: buildPreview(plainText),
    references,
    assetRefs,
  };
};

export const materializeCardDocument = (
  document: Y.Doc,
): CardDocumentMaterialization => {
  const envelope = assertValidCardDocumentRoots(document);
  return materializeBlockDocumentBody({
    body: envelope.body,
    schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
    title: envelope.title.toString(),
    schemaLabel: "Card",
  });
};

export const createCardDocumentGenesis = ({
  documentId,
  title,
  nfm,
  allocateBlockId = createUuidV7,
}: CreateCardDocumentGenesisInput): CardDocumentGenesis => {
  const envelope = createCardDocument({
    documentId,
    initialTitle: title,
    initializeBody: false,
  });
  try {
    populateBlockDocumentBodyFromNfm(envelope.body, nfm, allocateBlockId);
    const materialization = materializeCardDocument(envelope.document);
    return {
      document: envelope.document,
      update: Y.encodeStateAsUpdate(envelope.document),
      stateVector: Y.encodeStateVector(envelope.document),
      materialization,
    };
  } catch (error) {
    envelope.document.destroy();
    if (error instanceof BlockDocumentCodecError) throw error;
    throw new BlockDocumentCodecError(
      `Could not import NFM genesis for Document ${documentId}`,
      { cause: error },
    );
  }
};

/**
 * Build a disposable, validated Card Document from an internal stable-ID
 * BlockTree. This is a codec primitive for headless writers: it does not run
 * BlockNote editor commands and it never mutates an authoritative Y.Doc.
 */
export const createDetachedCardDocumentFromBlockTree = ({
  documentId,
  title = "",
  blockTree,
}: CreateDetachedCardDocumentFromBlockTreeInput): DetachedCardDocumentFromBlockTree => {
  const envelope = createCardDocument({
    documentId,
    initialTitle: title,
    initializeBody: false,
  });
  try {
    populateBlockDocumentBodyFromBlockTree(envelope.body, blockTree);
    const materialization = materializeCardDocument(envelope.document);
    const requested = flattenBlockTree(blockTree);
    const actual = flattenBlockTree(materialization.blockTree);
    const identityMatches =
      requested.length === actual.length &&
      requested.every(({ block, parentBlockId }, index) => {
        const candidate = actual[index];
        return (
          candidate?.block.id === block.id &&
          candidate.block.type === block.type &&
          candidate.parentBlockId === parentBlockId &&
          requestedBlockSemanticsArePreserved(block, candidate.block)
        );
      });
    if (!identityMatches) {
      throw new BlockDocumentCodecError(
        "Stable-ID BlockTree encoding changed identity, type, or hierarchy",
      );
    }
    return { document: envelope.document, materialization };
  } catch (error) {
    envelope.document.destroy();
    if (error instanceof BlockDocumentCodecError) throw error;
    throw new BlockDocumentCodecError(
      `Could not encode stable-ID BlockTree for Document ${documentId}`,
      { cause: error },
    );
  }
};

export const migrateCardDocument = (
  document: Y.Doc,
  fromVersion: number,
  toVersion = CARD_DOCUMENT_SCHEMA_VERSION,
): CardDocumentMigrationResult => {
  if (fromVersion !== CARD_DOCUMENT_SCHEMA_VERSION) {
    throw new BlockDocumentCodecError(
      `No Card Document migration is registered from schema version ${fromVersion}`,
    );
  }
  if (toVersion !== CARD_DOCUMENT_SCHEMA_VERSION) {
    throw new BlockDocumentCodecError(
      `Unsupported Card Document target schema version ${toVersion}`,
    );
  }

  materializeCardDocument(document);
  return {
    fromVersion,
    toVersion,
    changed: false,
    update: new Uint8Array(),
  };
};
