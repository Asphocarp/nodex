import { parseAssetSource } from "../assets";
import { parseNfm } from "../nfm/parser";
import type { NfmBlock, NfmInlineContent } from "../nfm/types";
import type { BlockTreeNode } from "./block-document-codec";
import type { BlockId } from "./contracts";

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

export interface BlockDocumentDerivedRecords {
  readonly references: readonly BlockDocumentReference[];
  readonly assetRefs: readonly BlockDocumentAssetReference[];
}

/**
 * BF-04 safety fence. These legacy reference shapes project another Card body
 * into the host editor; canonical reference-only Blocks replace them in BF-05.
 */
export const isLegacyForeignBodyReference = (
  reference: BlockDocumentReference,
): boolean =>
  reference.kind === "block" || reference.kind === "legacy_database_query";

export class BlockDocumentDerivedRecordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockDocumentDerivedRecordsError";
  }
}

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
    throw new BlockDocumentDerivedRecordsError(
      "NFM projection does not match the materialized Block tree",
    );
  }

  blockTree.forEach((block, index) => {
    const nfmBlock = nfmBlocks[index];
    if (!nfmBlock) {
      throw new BlockDocumentDerivedRecordsError(
        "NFM projection is missing a Block",
      );
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

export const deriveBlockDocumentRecords = (
  blockTree: readonly BlockTreeNode[],
  nfmBlocks: readonly NfmBlock[],
): BlockDocumentDerivedRecords => {
  const references: BlockDocumentReference[] = [];
  const assetRefs: BlockDocumentAssetReference[] = [];
  collectDerivedRecords(blockTree, nfmBlocks, references, assetRefs);
  return { references, assetRefs };
};

export const deriveBlockDocumentRecordsFromNfm = (
  blockTree: readonly BlockTreeNode[],
  nfm: string,
): BlockDocumentDerivedRecords =>
  deriveBlockDocumentRecords(blockTree, parseNfm(nfm));
