import { blockNoteToNfm, serializeNfm } from "@/lib/nfm";
import type { CardCreateInput } from "@/lib/types";

export interface DraggableEditorBlock {
  readonly id: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly content?: unknown;
  readonly children?: readonly DraggableEditorBlock[];
}

interface InlineContentItem {
  readonly type?: string;
  readonly text?: string;
  readonly content?: readonly { readonly text?: string }[];
}

const TEXT_LIKE_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "callout",
]);

const FALLBACK_TITLES: Readonly<Record<string, string>> = {
  codeBlock: "Code block",
  image: "Image",
  divider: "Divider",
  cardRef: "Card reference",
  databaseViewRef: "Database view",
};

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const inlineContentToText = (content: unknown): string => {
  if (typeof content === "string") return normalizeText(content);
  if (!Array.isArray(content)) return "";
  return normalizeText(
    content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const inline = item as InlineContentItem;
        if (inline.type === "text") return inline.text ?? "";
        if (inline.type !== "link" || !Array.isArray(inline.content)) return "";
        return inline.content.map((part) => part.text ?? "").join("");
      })
      .join(""),
  );
};

const serializeBlocks = (blocks: readonly DraggableEditorBlock[]): string =>
  serializeNfm(blockNoteToNfm(blocks as never[]));

export const resolveTopLevelDraggedBlocks = (
  editor: {
    getBlock: (id: string) => DraggableEditorBlock | undefined;
    getParentBlock: (id: string) => DraggableEditorBlock | undefined;
  },
  draggedIds: readonly string[],
): readonly DraggableEditorBlock[] => {
  const selected = new Set(draggedIds);
  return draggedIds
    .filter((id) => {
      let parent = editor.getParentBlock(id);
      while (parent) {
        if (selected.has(parent.id)) return false;
        parent = editor.getParentBlock(parent.id);
      }
      return true;
    })
    .map((id) => editor.getBlock(id))
    .filter((block): block is DraggableEditorBlock => block !== undefined);
};

/**
 * Cross-surface editor drag is an explicit copy boundary. NFM is used only as
 * the new Card's genesis projection; existing collaborative Documents are
 * never reconstructed or overwritten from this payload.
 */
export const mapBlocksToCardCopies = (
  blocks: readonly DraggableEditorBlock[],
): readonly CardCreateInput[] =>
  blocks.map((block) => {
    const titleText = TEXT_LIKE_BLOCK_TYPES.has(block.type)
      ? inlineContentToText(block.content)
      : "";
    const title = titleText || FALLBACK_TITLES[block.type] || "Untitled block";
    const children = block.children ?? [];
    const descriptionBlocks = TEXT_LIKE_BLOCK_TYPES.has(block.type)
      ? children
      : [block];
    return {
      title,
      description: serializeBlocks(descriptionBlocks),
    };
  });

export const mapCanonicalCardReferences = (
  blocks: readonly DraggableEditorBlock[],
  requestingProjectId: string,
):
  | readonly {
      readonly projectId: string;
      readonly cardId: string;
      readonly title: string;
    }[]
  | null => {
  const references = blocks.map((block) => {
    const targetBlockId = block.props?.targetBlockId;
    const displayHint = block.props?.displayHint;
    if (
      block.type !== "cardRef" ||
      typeof targetBlockId !== "string" ||
      targetBlockId.trim().length === 0
    ) {
      return null;
    }
    return {
      projectId: requestingProjectId,
      cardId: targetBlockId,
      title: typeof displayHint === "string" ? displayHint : "",
    };
  });
  if (!references.every((reference) => reference !== null)) return null;
  const canonical = references.filter(
    (reference): reference is NonNullable<typeof reference> =>
      reference !== null,
  );
  return [
    ...new Map(canonical.map((reference) => [reference.cardId, reference])).values(),
  ];
};
