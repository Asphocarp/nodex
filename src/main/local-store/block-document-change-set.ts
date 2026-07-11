import { createHash } from "node:crypto";
import * as Y from "yjs";
import {
  assertValidBlockDocument,
  assertValidCardDocumentRoots,
  BLOCK_CONTAINER_NODE_NAME,
  BLOCK_GROUP_NODE_NAME,
  encodeXmlSubtree,
  type BlockId,
  type PortableXmlSubtree,
  type PortableXmlValue,
} from "../../shared/block-documents";

export interface BlockChangeDescriptor {
  readonly id: BlockId;
  readonly blockType: string;
  readonly parentBlockId: BlockId | null;
  readonly ordinal: number;
  readonly text: string;
  readonly contentHash: string;
  readonly childOrderSignature: string;
}

export interface BlockDocumentChangeState {
  readonly title: string;
  readonly blocks: ReadonlyMap<BlockId, BlockChangeDescriptor>;
}

const canonicalPortableValue = (value: PortableXmlValue): string => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return `number:${value}`;
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (value instanceof Uint8Array) {
    return `bytes:${Buffer.from(value).toString("base64")}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalPortableValue).join(",")}]`;
  }

  const record = value as Readonly<Record<string, PortableXmlValue>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalPortableValue(record[key])}`)
    .join(",")}}`;
};

const canonicalPortableSubtree = (subtree: PortableXmlSubtree): string => {
  if (subtree.kind === "text") {
    return `text:[${subtree.delta
      .map((operation) =>
        `{insert:${JSON.stringify(operation.insert)},attributes:${canonicalPortableValue(operation.attributes)}}`,
      )
      .join(",")}]`;
  }

  return `element:{name:${JSON.stringify(subtree.nodeName)},attributes:${canonicalPortableValue(subtree.attributes)},children:[${subtree.children
    .map(canonicalPortableSubtree)
    .join(",")}]}`;
};

const hashBlockContent = (
  container: Y.XmlElement,
  blockId: BlockId,
): string => {
  const content = container
    .toArray()
    .find(
      (child): child is Y.XmlElement =>
        child instanceof Y.XmlElement && child.nodeName !== BLOCK_GROUP_NODE_NAME,
    );
  if (!content) {
    throw new TypeError(`Block ${blockId} has no content element`);
  }

  const containerAttributes = canonicalPortableValue(container.getAttributes());
  const contentSubtree = canonicalPortableSubtree(encodeXmlSubtree(content));
  return createHash("sha256")
    .update(containerAttributes)
    .update("\0")
    .update(contentSubtree)
    .digest("hex");
};

const collectBlockContentHashes = (
  body: Y.XmlFragment,
): ReadonlyMap<BlockId, string> => {
  const hashes = new Map<BlockId, string>();
  const visit = (parent: Y.XmlFragment | Y.XmlElement): void => {
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === BLOCK_CONTAINER_NODE_NAME) {
        const blockId = child.getAttribute("id");
        if (typeof blockId !== "string") {
          throw new TypeError("Validated Block container lost its identity");
        }
        hashes.set(blockId, hashBlockContent(child, blockId));
      }
      visit(child);
    }
  };
  visit(body);
  return hashes;
};

export const captureBlockDocumentChangeState = (
  document: Y.Doc,
): BlockDocumentChangeState => {
  const envelope = assertValidCardDocumentRoots(document);
  const scannedBlocks = assertValidBlockDocument(envelope.body);
  const contentHashes = collectBlockContentHashes(envelope.body);
  const childIdsByParent = new Map<BlockId, BlockId[]>();
  for (const block of scannedBlocks) {
    if (block.parentBlockId === null) continue;
    const siblings = childIdsByParent.get(block.parentBlockId) ?? [];
    siblings.push(block.id);
    childIdsByParent.set(block.parentBlockId, siblings);
  }
  const blocks = new Map<BlockId, BlockChangeDescriptor>();
  scannedBlocks.forEach((block, ordinal) => {
    const contentHash = contentHashes.get(block.id);
    if (!contentHash) {
      throw new TypeError(`Validated Block ${block.id} has no content fingerprint`);
    }
    blocks.set(block.id, {
      id: block.id,
      blockType: block.blockType,
      parentBlockId: block.parentBlockId,
      ordinal,
      text: block.text,
      contentHash,
      childOrderSignature: JSON.stringify(childIdsByParent.get(block.id) ?? []),
    });
  });
  return {
    title: envelope.title.toString(),
    blocks,
  };
};

const descriptorsEqual = (
  left: BlockChangeDescriptor,
  right: BlockChangeDescriptor,
): boolean =>
  left.id === right.id
  && left.blockType === right.blockType
  && left.parentBlockId === right.parentBlockId
  && left.ordinal === right.ordinal
  && left.text === right.text
  && left.contentHash === right.contentHash
  && left.childOrderSignature === right.childOrderSignature;

/**
 * Derives the application-level change set from two already causally related
 * Card Documents. Client-declared touched IDs are intentionally absent from
 * this Interface: callers cannot influence the authoritative result.
 */
export const deriveBlockDocumentTouchedIds = (input: {
  readonly ownerBlockId: BlockId;
  readonly before: BlockDocumentChangeState;
  readonly after: BlockDocumentChangeState;
}): readonly BlockId[] => {
  const touched = new Set<BlockId>();

  if (input.before.title !== input.after.title) {
    touched.add(input.ownerBlockId);
  }

  for (const [blockId, beforeBlock] of input.before.blocks) {
    const afterBlock = input.after.blocks.get(blockId);
    if (!afterBlock || !descriptorsEqual(beforeBlock, afterBlock)) {
      touched.add(blockId);
    }
  }
  for (const [blockId, afterBlock] of input.after.blocks) {
    const beforeBlock = input.before.blocks.get(blockId);
    if (!beforeBlock || !descriptorsEqual(beforeBlock, afterBlock)) {
      touched.add(blockId);
    }
  }

  return [...touched].sort((left, right) => left.localeCompare(right));
};
