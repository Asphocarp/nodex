import type { BlockId } from "./contracts";
import {
  createCanonicalEmptyParagraphBlock,
  type BlockTreeNode,
} from "./block-document-codec";
import {
  assessBlockSemanticContentForCard,
  type BlockSemanticContentAssessment,
} from "./block-semantic-content";
import {
  canonicalizePortableRichText,
  plainTextToPortableRichText,
  portableRichTextPlainText,
  type PortableRichText,
} from "./portable-rich-text";
import { blockNoteInlineToNfm } from "./nfm-blocknote-adapter";

export type BlockToCardTransformation =
  | {
      readonly kind: "promote";
      readonly cardId: BlockId;
      readonly richTitle: PortableRichText;
      readonly bodyRoots: readonly BlockTreeNode[];
      readonly consumedType: string;
      readonly consumedProps: Readonly<Record<string, unknown>>;
      readonly placeholderBlockId: BlockId | null;
    }
  | {
      readonly kind: "wrap";
      readonly cardId: BlockId;
      readonly wrappedRoot: BlockTreeNode;
      readonly richTitle: PortableRichText;
      readonly reason: Extract<BlockSemanticContentAssessment, { kind: "wrap" }>[
        "reason"
      ];
      readonly detail: string;
    }
  | {
      readonly kind: "already_card";
      readonly cardId: BlockId;
    };

export const planBlockToCardTransformation = (input: {
  readonly root: BlockTreeNode;
  readonly resultRootId: BlockId;
  readonly wrapperCardId: BlockId;
  readonly allocateEmptyBodyBlockId: () => BlockId;
}): BlockToCardTransformation => {
  const assessment = assessBlockSemanticContentForCard(input.root);
  if (assessment.kind === "already_card") {
    return { kind: "already_card", cardId: input.resultRootId };
  }
  if (assessment.kind === "wrap") {
    let richTitle: PortableRichText = plainTextToPortableRichText(
      input.root.type,
    );
    try {
      const candidate = canonicalizePortableRichText(
        blockNoteInlineToNfm(input.root.content),
      );
      if (portableRichTextPlainText(candidate).trim().length > 0) {
        richTitle = candidate;
      }
    } catch {
      // The complete wrapped root remains authority; a type label is lossless.
    }
    return {
      kind: "wrap",
      cardId: input.wrapperCardId,
      wrappedRoot: input.root,
      richTitle,
      reason: assessment.reason,
      detail: assessment.detail,
    };
  }
  if (assessment.children.length > 0) {
    return {
      kind: "promote",
      cardId: input.resultRootId,
      richTitle: assessment.primary,
      bodyRoots: assessment.children,
      consumedType: assessment.consumedType,
      consumedProps: assessment.consumedProps,
      placeholderBlockId: null,
    };
  }
  const placeholderBlockId = input.allocateEmptyBodyBlockId();
  return {
    kind: "promote",
    cardId: input.resultRootId,
    richTitle: assessment.primary,
    bodyRoots: [createCanonicalEmptyParagraphBlock(placeholderBlockId)],
    consumedType: assessment.consumedType,
    consumedProps: assessment.consumedProps,
    placeholderBlockId,
  };
};
