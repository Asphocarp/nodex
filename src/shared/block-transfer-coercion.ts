import { MAX_CARD_TITLE_LENGTH } from "./card-limits";

export const BLOCK_TRANSFER_COERCION_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "codeBlock",
  "table",
  "quote",
  "divider",
  "image",
  "callout",
  "threadSection",
  "card",
  "cardRef",
  "databaseViewRef",
  "syncedBlockRef",
  "templateRef",
  "largeDocument",
  "largeCode",
  "cardToggle",
  "toggleListInlineView",
] as const;

export type BlockTransferCoercionBlockType =
  (typeof BLOCK_TRANSFER_COERCION_BLOCK_TYPES)[number];

export type BlockTransferCoercionPolicy =
  | "already_card"
  | "promote_in_place"
  | "wrap_in_card"
  | "unsupported_legacy";

/**
 * Every Block type accepted by the canonical headless schema must make one
 * explicit Database-target identity decision. Adding a schema Block without
 * extending this record is a compile-time failure and a runtime schema test.
 */
export const BLOCK_TRANSFER_DATABASE_COERCION_POLICY = {
  paragraph: "promote_in_place",
  heading: "promote_in_place",
  bulletListItem: "promote_in_place",
  numberedListItem: "promote_in_place",
  checkListItem: "promote_in_place",
  toggleListItem: "promote_in_place",
  codeBlock: "wrap_in_card",
  table: "wrap_in_card",
  quote: "wrap_in_card",
  divider: "wrap_in_card",
  image: "wrap_in_card",
  callout: "wrap_in_card",
  threadSection: "wrap_in_card",
  card: "already_card",
  cardRef: "wrap_in_card",
  databaseViewRef: "wrap_in_card",
  syncedBlockRef: "wrap_in_card",
  templateRef: "wrap_in_card",
  largeDocument: "wrap_in_card",
  largeCode: "wrap_in_card",
  cardToggle: "unsupported_legacy",
  toggleListInlineView: "unsupported_legacy",
} as const satisfies Readonly<
  Record<BlockTransferCoercionBlockType, BlockTransferCoercionPolicy>
>;

export class BlockTransferCoercionError extends Error {
  constructor(
    readonly code: "unknown_block_type" | "unsupported_legacy_block",
    message: string,
  ) {
    super(message);
    this.name = "BlockTransferCoercionError";
  }
}

export const classifyDatabaseTransferBlock = (
  blockType: string,
): BlockTransferCoercionPolicy => {
  if (
    Object.hasOwn(BLOCK_TRANSFER_DATABASE_COERCION_POLICY, blockType)
  ) {
    return BLOCK_TRANSFER_DATABASE_COERCION_POLICY[
      blockType as BlockTransferCoercionBlockType
    ];
  }
  throw new BlockTransferCoercionError(
    "unknown_block_type",
    `Block type ${blockType} has no Database transfer policy`,
  );
};

export interface DatabaseTransferCoercionRoot {
  readonly blockId: string;
  readonly blockType: string;
  readonly text: string;
}

export type DatabaseTransferCoercionPlanEntry =
  | {
      readonly kind: "already_card";
      readonly sourceBlockId: string;
      readonly cardBlockId: string;
    }
  | {
      readonly kind: "promote_in_place";
      readonly sourceBlockId: string;
      readonly cardBlockId: string;
      readonly title: string;
    }
  | {
      readonly kind: "wrap_in_card";
      readonly sourceBlockId: string;
      readonly cardBlockId: string;
      readonly title: string;
    };

const normalizedTitle = (text: string, fallback: string): string => {
  const firstLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (firstLine ?? fallback).slice(0, MAX_CARD_TITLE_LENGTH);
};

export const planDatabaseTransferCoercions = (input: {
  readonly roots: readonly DatabaseTransferCoercionRoot[];
  readonly allocateWrapperCardId: (sourceBlockId: string) => string;
}): readonly DatabaseTransferCoercionPlanEntry[] =>
  input.roots.map((root) => {
    const policy = classifyDatabaseTransferBlock(root.blockType);
    if (policy === "unsupported_legacy") {
      throw new BlockTransferCoercionError(
        "unsupported_legacy_block",
        `Legacy projection Block ${root.blockId} (${root.blockType}) must be migrated before Database transfer`,
      );
    }
    if (policy === "already_card") {
      return {
        kind: "already_card",
        sourceBlockId: root.blockId,
        cardBlockId: root.blockId,
      };
    }
    const title = normalizedTitle(root.text, "Untitled");
    if (policy === "promote_in_place") {
      return {
        kind: "promote_in_place",
        sourceBlockId: root.blockId,
        cardBlockId: root.blockId,
        title,
      };
    }
    return {
      kind: "wrap_in_card",
      sourceBlockId: root.blockId,
      cardBlockId: input.allocateWrapperCardId(root.blockId),
      title,
    };
  });
