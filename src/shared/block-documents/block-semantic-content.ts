import type { BlockTreeNode } from "./block-document-codec";
import { blockNoteInlineToNfm } from "./nfm-blocknote-adapter";
import {
  canonicalizePortableRichText,
  PortableRichTextError,
  type PortableRichText,
} from "./portable-rich-text";

export type BlockToCardTypeCapability =
  | "promote_primary"
  | "wrap_subtree"
  | "already_card"
  | "unsupported_legacy";

export const BLOCK_TO_CARD_TYPE_CAPABILITIES = {
  paragraph: "promote_primary",
  heading: "promote_primary",
  bulletListItem: "promote_primary",
  numberedListItem: "promote_primary",
  checkListItem: "wrap_subtree",
  toggleListItem: "promote_primary",
  codeBlock: "wrap_subtree",
  table: "wrap_subtree",
  quote: "promote_primary",
  divider: "wrap_subtree",
  image: "wrap_subtree",
  callout: "wrap_subtree",
  threadSection: "wrap_subtree",
  card: "already_card",
  cardRef: "wrap_subtree",
  databaseViewRef: "wrap_subtree",
  syncedBlockRef: "wrap_subtree",
  templateRef: "wrap_subtree",
  cardToggle: "unsupported_legacy",
  toggleListInlineView: "unsupported_legacy",
} as const satisfies Readonly<Record<string, BlockToCardTypeCapability>>;

export type BlockToCardRegisteredType =
  keyof typeof BLOCK_TO_CARD_TYPE_CAPABILITIES;

export type BlockSemanticContentAssessment =
  | {
      readonly kind: "promote";
      readonly primary: PortableRichText;
      readonly children: readonly BlockTreeNode[];
      readonly consumedType: string;
      readonly consumedProps: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "wrap";
      readonly reason:
        | "type_requires_wrapper"
        | "unsupported_primary_content"
        | "unmapped_type_state";
      readonly detail: string;
    }
  | {
      readonly kind: "already_card";
    };

export class BlockSemanticContentError extends TypeError {
  constructor(
    readonly code: "unknown_block_type" | "unsupported_legacy_block",
    message: string,
  ) {
    super(message);
    this.name = "BlockSemanticContentError";
  }
}

const typeCapability = (blockType: string): BlockToCardTypeCapability => {
  if (Object.hasOwn(BLOCK_TO_CARD_TYPE_CAPABILITIES, blockType)) {
    return BLOCK_TO_CARD_TYPE_CAPABILITIES[
      blockType as BlockToCardRegisteredType
    ];
  }
  throw new BlockSemanticContentError(
    "unknown_block_type",
    `Block type ${blockType} has no Card transformation capability`,
  );
};

const presentationPropsForPromotion = (
  root: BlockTreeNode,
): Readonly<Record<string, unknown>> => {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root.props)) {
    if (
      key === "backgroundColor" ||
      key === "textColor" ||
      key === "textAlignment" ||
      key === "level" ||
      key === "isToggleable" ||
      key === "start"
    ) {
      props[key] = value;
      continue;
    }
    return { unsupportedProperty: key };
  }
  return props;
};

export const assessBlockSemanticContentForCard = (
  root: BlockTreeNode,
): BlockSemanticContentAssessment => {
  const capability = typeCapability(root.type);
  if (capability === "unsupported_legacy") {
    throw new BlockSemanticContentError(
      "unsupported_legacy_block",
      `Legacy projection Block ${root.id} (${root.type}) must migrate before Card transformation`,
    );
  }
  if (capability === "already_card") return { kind: "already_card" };
  if (capability === "wrap_subtree") {
    return {
      kind: "wrap",
      reason: "type_requires_wrapper",
      detail: `${root.type} preserves its complete subtree under a wrapper Card`,
    };
  }
  const consumedProps = presentationPropsForPromotion(root);
  if ("unsupportedProperty" in consumedProps) {
    return {
      kind: "wrap",
      reason: "unmapped_type_state",
      detail: `${root.type} property ${String(consumedProps.unsupportedProperty)} has no Card mapping`,
    };
  }
  try {
    const primary = canonicalizePortableRichText(
      blockNoteInlineToNfm(root.content),
    );
    return {
      kind: "promote",
      primary,
      children: root.children,
      consumedType: root.type,
      consumedProps,
    };
  } catch (error) {
    if (!(error instanceof PortableRichTextError)) throw error;
    return {
      kind: "wrap",
      reason: "unsupported_primary_content",
      detail: error.message,
    };
  }
};
