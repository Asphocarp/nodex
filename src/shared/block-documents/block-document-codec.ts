import { BlockNoteEditor } from "@blocknote/core";
import {
  blocksToYXmlFragment,
  yXmlFragmentToBlocks,
} from "@blocknote/core/yjs";
import * as Y from "yjs";
import { parseAssetSource } from "../assets";
import { createUuidV7 } from "../card-id";
import { extractPlainText } from "../nfm/extract-text";
import { parseNfm } from "../nfm/parser";
import { serializeNfm } from "../nfm/serializer";
import type { NfmBlock, NfmInlineContent } from "../nfm/types";
import {
  assertValidBlockDocument,
  BLOCK_GROUP_NODE_NAME,
  type ScannedDocumentBlock,
} from "./block-structure";
import {
  assertValidCardDocumentRoots,
  CARD_DOCUMENT_SCHEMA_VERSION,
  createCardDocument,
} from "./card-document";
import type { BlockId, DocumentId } from "./contracts";
import { headlessBlockDocumentSchema } from "./headless-blocknote-schema";
import {
  blockNoteToNfm,
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

export type BlockDocumentReference =
  | {
      readonly kind: "block";
      readonly sourceBlockId: BlockId;
      readonly targetBlockId: BlockId;
      readonly projectHint?: string;
    }
  | {
      readonly kind: "thread";
      readonly sourceBlockId: BlockId;
      readonly targetThreadId: string;
    }
  | {
      readonly kind: "legacy_database_query";
      readonly sourceBlockId: BlockId;
      readonly projectHint: string;
    };

export interface BlockDocumentAssetReference {
  readonly sourceBlockId: BlockId;
  readonly kind: "image" | "attachment";
  readonly source: string;
  readonly managedFileName: string | null;
}

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

const headlessEditor = BlockNoteEditor.create({
  schema: headlessBlockDocumentSchema,
});

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
    throw new BlockDocumentCodecError("Block tree values must not contain cycles");
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
      throw new BlockDocumentCodecError("Materialized Block is missing its identity");
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

const collectInlineReferences = (
  sourceBlockId: BlockId,
  inline: readonly NfmInlineContent[],
  references: BlockDocumentReference[],
  assetRefs: BlockDocumentAssetReference[],
): void => {
  for (const item of inline) {
    if (item.type === "threadMention") {
      references.push({
        kind: "thread",
        sourceBlockId,
        targetThreadId: item.uuid,
      });
      continue;
    }
    if (item.type !== "attachment") continue;
    assetRefs.push({
      sourceBlockId,
      kind: "attachment",
      source: item.source,
      managedFileName: parseAssetSource(item.source)?.fileName ?? null,
    });
  }
};

const collectDerivedRecords = (
  blockTree: readonly BlockTreeNode[],
  nfmBlocks: readonly NfmBlock[],
  references: BlockDocumentReference[],
  assetRefs: BlockDocumentAssetReference[],
): void => {
  if (blockTree.length !== nfmBlocks.length) {
    throw new BlockDocumentCodecError(
      "NFM projection does not match the materialized Block tree",
    );
  }

  blockTree.forEach((block, index) => {
    const nfmBlock = nfmBlocks[index];
    if (!nfmBlock) {
      throw new BlockDocumentCodecError("NFM projection is missing a Block");
    }
    if ("content" in nfmBlock && Array.isArray(nfmBlock.content)) {
      collectInlineReferences(
        block.id,
        nfmBlock.content,
        references,
        assetRefs,
      );
    }
    if (nfmBlock.type === "table") {
      for (const row of nfmBlock.rows) {
        for (const cell of row.cells) {
          collectInlineReferences(
            block.id,
            cell.content,
            references,
            assetRefs,
          );
        }
      }
    }
    if (nfmBlock.type === "image") {
      collectInlineReferences(
        block.id,
        nfmBlock.caption,
        references,
        assetRefs,
      );
      assetRefs.push({
        sourceBlockId: block.id,
        kind: "image",
        source: nfmBlock.source,
        managedFileName: parseAssetSource(nfmBlock.source)?.fileName ?? null,
      });
    } else if (nfmBlock.type === "cardRef") {
      references.push({
        kind: "block",
        sourceBlockId: block.id,
        targetBlockId: nfmBlock.cardId,
        projectHint: nfmBlock.sourceProjectId,
      });
    } else if (nfmBlock.type === "cardToggle") {
      references.push({
        kind: "block",
        sourceBlockId: block.id,
        targetBlockId: nfmBlock.cardId,
        ...(nfmBlock.sourceProjectId
          ? { projectHint: nfmBlock.sourceProjectId }
          : {}),
      });
    } else if (nfmBlock.type === "toggleListInlineView") {
      references.push({
        kind: "legacy_database_query",
        sourceBlockId: block.id,
        projectHint: nfmBlock.sourceProjectId,
      });
    }

    collectDerivedRecords(
      block.children,
      nfmBlock.children,
      references,
      assetRefs,
    );
  });
};

const buildPreview = (plainText: string): string => {
  if (plainText.length <= 240) return plainText;
  return `${plainText.slice(0, 240).trimEnd()}...`;
};

export const materializeCardDocument = (
  document: Y.Doc,
): CardDocumentMaterialization => {
  const envelope = assertValidCardDocumentRoots(document);
  const scannedBlocks = assertValidBlockDocument(envelope.body);
  let blockNoteBlocks: readonly BlockNoteBlockValue[] = [];
  if (scannedBlocks.length > 0) {
    try {
      blockNoteBlocks = yXmlFragmentToBlocks(
        headlessEditor,
        envelope.body,
      ) as readonly BlockNoteBlockValue[];
    } catch (error) {
      throw new BlockDocumentCodecError(
        "Card body cannot be decoded with the canonical BlockNote schema",
        { cause: error },
      );
    }
  }

  const blockTree = toBlockTree(blockNoteBlocks);
  assertMaterializationMatchesScan(blockTree, scannedBlocks);
  const nfmBlocks = blockNoteToNfm(blockNoteBlocks);
  const nfm = serializeNfm(nfmBlocks);
  const references: BlockDocumentReference[] = [];
  const assetRefs: BlockDocumentAssetReference[] = [];
  collectDerivedRecords(
    blockTree,
    nfmBlocks,
    references,
    assetRefs,
  );
  const plainText = extractPlainText(nfm);

  return {
    schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
    title: envelope.title.toString(),
    blockTree,
    nfm,
    plainText,
    preview: buildPreview(plainText),
    references,
    assetRefs,
  };
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
    const blockNoteBlocks = nfmToBlockNoteWithIds(
      parseNfm(nfm),
      allocateBlockId,
    );
    blocksToYXmlFragment(
      headlessEditor,
      blockNoteBlocks as typeof headlessBlockDocumentSchema.Block[],
      envelope.body,
    );
    if (envelope.body.length === 0) {
      envelope.body.insert(0, [new Y.XmlElement(BLOCK_GROUP_NODE_NAME)]);
    }
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
