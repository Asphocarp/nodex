import { createHash } from "node:crypto";
import { createUuidV7 } from "./card-id";

export interface OwnershipClosureBlock {
  readonly blockId: string;
  readonly blockType: string;
  readonly containingDocumentId: string | null;
}

export interface OwnershipClosureDocument {
  readonly documentId: string;
  readonly ownerBlockId: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}

export interface BlockOwnershipGraphReader {
  readonly readBlock: (blockId: string) => OwnershipClosureBlock | null;
  readonly readOwnedDocument: (
    ownerBlockId: string,
  ) => OwnershipClosureDocument | null;
  readonly readDocumentBlocks: (
    documentId: string,
  ) => readonly OwnershipClosureBlock[];
}

export interface BlockOwnershipClosure {
  readonly rootBlockIds: readonly string[];
  readonly blocks: readonly OwnershipClosureBlock[];
  readonly documents: readonly OwnershipClosureDocument[];
}

export class BlockOwnershipClosureError extends Error {
  constructor(
    readonly code:
      | "root_not_found"
      | "ownership_cycle"
      | "document_owner_mismatch"
      | "duplicate_block_identity",
    message: string,
  ) {
    super(message);
    this.name = "BlockOwnershipClosureError";
  }
}

export const planBlockOwnershipClosure = (
  reader: BlockOwnershipGraphReader,
  rootBlockIds: readonly string[],
): BlockOwnershipClosure => {
  const roots = [...new Set(rootBlockIds)];
  if (roots.length !== rootBlockIds.length || roots.length === 0) {
    throw new BlockOwnershipClosureError(
      "duplicate_block_identity",
      "Ownership closure roots must be non-empty and unique",
    );
  }
  const blocks: OwnershipClosureBlock[] = [];
  const documents: OwnershipClosureDocument[] = [];
  const visitedBlocks = new Set<string>();
  const visitedOwners = new Set<string>();
  const activeOwners = new Set<string>();

  const includeBlock = (block: OwnershipClosureBlock): void => {
    if (visitedBlocks.has(block.blockId)) return;
    visitedBlocks.add(block.blockId);
    blocks.push(block);
  };

  const visitOwner = (ownerBlockId: string): void => {
    if (activeOwners.has(ownerBlockId)) {
      throw new BlockOwnershipClosureError(
        "ownership_cycle",
        `Document ownership cycle reaches Block ${ownerBlockId}`,
      );
    }
    if (visitedOwners.has(ownerBlockId)) return;
    const owned = reader.readOwnedDocument(ownerBlockId);
    if (!owned) return;
    if (owned.ownerBlockId !== ownerBlockId) {
      throw new BlockOwnershipClosureError(
        "document_owner_mismatch",
        `Owned Document ${owned.documentId} does not point back to ${ownerBlockId}`,
      );
    }
    activeOwners.add(ownerBlockId);
    documents.push(owned);
    for (const child of reader.readDocumentBlocks(owned.documentId)) {
      includeBlock(child);
      visitOwner(child.blockId);
    }
    activeOwners.delete(ownerBlockId);
    visitedOwners.add(ownerBlockId);
  };

  for (const rootBlockId of roots) {
    const root = reader.readBlock(rootBlockId);
    if (!root) {
      throw new BlockOwnershipClosureError(
        "root_not_found",
        `Ownership root does not exist: ${rootBlockId}`,
      );
    }
    includeBlock(root);
    visitOwner(root.blockId);
  }
  return { rootBlockIds: roots, blocks, documents };
};

export interface BlockOwnershipCopyIdentityMap {
  readonly blockIds: Readonly<Record<string, string>>;
  readonly documentIds: Readonly<Record<string, string>>;
}

const deterministicIdentity = (
  operationId: string,
  role: string,
  sourceId: string,
): string =>
  `${role}:copy:${createHash("sha256")
    .update(`${operationId}\0${role}\0${sourceId}`)
    .digest("hex")}`;

export const allocateBlockOwnershipCopyIdentities = (
  operationId: string,
  closure: BlockOwnershipClosure,
  allocateBlockId: () => string = createUuidV7,
): BlockOwnershipCopyIdentityMap => ({
  blockIds: Object.fromEntries(
    closure.blocks.map((block) => [
      block.blockId,
      allocateBlockId(),
    ]),
  ),
  documentIds: Object.fromEntries(
    closure.documents.map((document) => [
      document.documentId,
      deterministicIdentity(operationId, "document", document.documentId),
    ]),
  ),
});
