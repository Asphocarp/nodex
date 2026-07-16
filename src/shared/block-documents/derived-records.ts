import { parseAssetSource } from "../assets";
import { parseNfm } from "../nfm/parser";
import type { NfmBlock, NfmInlineContent } from "../nfm/types";
import type { BlockTreeNode } from "./block-document-codec";
import {
  MAX_BLOCK_ID_LENGTH,
  MAX_REFERENCE_DISPLAY_HINT_LENGTH,
  type BlockId,
} from "./contracts";

export type BlockDocumentReference =
  | {
      readonly kind: "block";
      readonly sourceBlockId: BlockId;
      readonly targetBlockId: BlockId;
      readonly displayHint?: string;
    }
  | {
      readonly kind: "database_view";
      readonly sourceBlockId: BlockId;
      readonly databaseViewId: string;
      readonly displayHint?: string;
    }
  | {
      readonly kind: "thread";
      readonly sourceBlockId: BlockId;
      readonly targetThreadId: string;
    }
  | {
      readonly kind: "legacy_card_projection";
      readonly sourceBlockId: BlockId;
      readonly targetBlockId: BlockId;
      readonly projectHint?: string;
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
  reference.kind === "legacy_card_projection"
  || reference.kind === "legacy_database_query";

export class BlockDocumentDerivedRecordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockDocumentDerivedRecordsError";
  }
}

const assertCanonicalReferenceId = (value: string, label: string): void => {
  if (
    value.length === 0
    || value !== value.trim()
    || value.length > MAX_BLOCK_ID_LENGTH
  ) {
    throw new BlockDocumentDerivedRecordsError(
      `${label} must be a non-empty stable identity no longer than ${MAX_BLOCK_ID_LENGTH} characters`,
    );
  }
};

const readDisplayHint = (value: string | undefined): string | undefined => {
  if (value === undefined || value.length === 0) return undefined;
  if (value.length > MAX_REFERENCE_DISPLAY_HINT_LENGTH) {
    throw new BlockDocumentDerivedRecordsError(
      `Reference display hints must not exceed ${MAX_REFERENCE_DISPLAY_HINT_LENGTH} characters`,
    );
  }
  return value;
};

const appendResolvedAssetReference = (
  assetRefs: BlockDocumentAssetReference[],
  input: Omit<BlockDocumentAssetReference, "managedFileName">,
): void => {
  // BlockNote inserts file Blocks before the asynchronous upload resolves.
  // The empty source is valid collaborative content, but it does not yet
  // identify an asset and therefore must not enter the asset projection.
  if (input.source.length === 0) return;

  assetRefs.push({
    ...input,
    managedFileName: parseAssetSource(input.source)?.fileName ?? null,
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
    appendResolvedAssetReference(assetRefs, {
      sourceBlockId,
      kind: "attachment",
      source: item.source,
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
      appendResolvedAssetReference(assetRefs, {
        sourceBlockId: block.id,
        kind: "image",
        source: nfmBlock.source,
      });
    } else if (
      nfmBlock.type === "page" &&
      nfmBlock.uuid !== undefined &&
      nfmBlock.uuid !== block.id
    ) {
      throw new BlockDocumentDerivedRecordsError(
        `Owning Page NFM uuid ${nfmBlock.uuid} does not match Block ${block.id}`,
      );
    } else if (nfmBlock.type === "pageRef") {
      assertCanonicalReferenceId(nfmBlock.targetBlockId, "targetBlockId");
      references.push({
        kind: "block",
        sourceBlockId: block.id,
        targetBlockId: nfmBlock.targetBlockId,
      });
    } else if (nfmBlock.type === "cardRef") {
      references.push({
        kind: "legacy_card_projection",
        sourceBlockId: block.id,
        targetBlockId: nfmBlock.pageId,
        projectHint: nfmBlock.sourceProjectId,
      });
    } else if (nfmBlock.type === "cardToggle") {
      references.push({
        kind: "legacy_card_projection",
        sourceBlockId: block.id,
        targetBlockId: nfmBlock.pageId,
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
    } else if (nfmBlock.type === "databaseViewRef") {
      assertCanonicalReferenceId(
        nfmBlock.databaseViewId,
        "databaseViewId",
      );
      const displayHint = readDisplayHint(nfmBlock.displayHint);
      references.push({
        kind: "database_view",
        sourceBlockId: block.id,
        databaseViewId: nfmBlock.databaseViewId,
        ...(displayHint !== undefined ? { displayHint } : {}),
      });
    } else if (nfmBlock.type === "syncedBlockRef") {
      assertCanonicalReferenceId(nfmBlock.sourceBlockId, "sourceBlockId");
      references.push({
        kind: "block",
        sourceBlockId: block.id,
        targetBlockId: nfmBlock.sourceBlockId,
      });
    } else if (nfmBlock.type === "templateRef") {
      assertCanonicalReferenceId(nfmBlock.sourceBlockId, "sourceBlockId");
      const displayHint = readDisplayHint(nfmBlock.displayHint);
      references.push({
        kind: "block",
        sourceBlockId: block.id,
        targetBlockId: nfmBlock.sourceBlockId,
        ...(displayHint !== undefined ? { displayHint } : {}),
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
