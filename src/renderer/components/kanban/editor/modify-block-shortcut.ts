import type { FocusedImagePreview } from "./image-preview-shortcut";
import { findToggleButtonForBlock } from "./toggle-shortcut";

interface ModifyShortcutBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
}

interface ModifyShortcutSelection {
  blocks?: ModifyShortcutBlock[];
}

export interface ModifyShortcutEditor {
  domElement?: ParentNode;
  getSelection?: () => ModifyShortcutSelection | undefined;
  getTextCursorPosition: () => { block?: ModifyShortcutBlock };
  getBlock?: (id: string) => ModifyShortcutBlock | undefined;
  updateBlock?: (
    block: ModifyShortcutBlock | string,
    update: { props?: Record<string, unknown> },
  ) => unknown;
}

export interface OpenModifyShortcutCardInput {
  projectId: string;
  cardId: string;
  titleSnapshot?: string;
}

export interface ModifyShortcutActions {
  projectId: string;
  openImagePreview?: (preview: FocusedImagePreview) => void;
  openCard?: (input: OpenModifyShortcutCardInput) => void | Promise<void>;
  openThread?: (threadId: string) => void | Promise<void>;
}

function readStringProp(props: Record<string, unknown> | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function isToggleLikeBlock(block: ModifyShortcutBlock | undefined): boolean {
  if (!block) return false;
  if (block.type === "toggleListItem") return true;
  return block.type === "heading" && block.props?.isToggleable === true;
}

function isModifiableBlock(block: ModifyShortcutBlock | undefined): boolean {
  if (!block) return false;
  if (block.type === "checkListItem") return true;
  if (block.type === "image") return true;
  if (block.type === "cardRef") return true;
  if (block.type === "cardToggle") return true;
  if (block.type === "threadSection") return true;
  return isToggleLikeBlock(block);
}

function resolveSelectedBlock(editor: ModifyShortcutEditor): ModifyShortcutBlock | null | undefined {
  const selection = editor.getSelection?.();
  if (!selection) return undefined;

  const selectedBlocks = selection.blocks ?? [];
  if (selectedBlocks.length !== 1) return null;

  const selectedBlock = selectedBlocks[0];
  if (!isModifiableBlock(selectedBlock)) return null;
  if (!selectedBlock.id) return selectedBlock;

  return editor.getBlock?.(selectedBlock.id) ?? selectedBlock;
}

function resolveShortcutBlock(editor: ModifyShortcutEditor): ModifyShortcutBlock | null {
  const selectedBlock = resolveSelectedBlock(editor);
  if (selectedBlock !== undefined) return selectedBlock;

  const cursorBlock = editor.getTextCursorPosition().block;
  if (!isModifiableBlock(cursorBlock)) return null;
  if (!cursorBlock?.id) return cursorBlock ?? null;

  return editor.getBlock?.(cursorBlock.id) ?? cursorBlock;
}

function readInlineText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return "";

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (!Array.isArray(record.content)) return "";

  return record.content.map(readInlineText).join("");
}

function readBlockText(block: ModifyShortcutBlock): string | undefined {
  if (!Array.isArray(block.content)) return undefined;

  const text = block.content.map(readInlineText).join("").trim();
  return text || undefined;
}

function resolveImagePreview(block: ModifyShortcutBlock): FocusedImagePreview | null {
  const source = readStringProp(block.props, "url");
  if (!source) return null;

  const caption = readStringProp(block.props, "caption");
  const name = readStringProp(block.props, "name");
  return {
    source,
    alt: caption || name || "Image preview",
  };
}

function handleToggleBlock(editor: ModifyShortcutEditor, block: ModifyShortcutBlock): boolean {
  if (!block.id) return false;

  const toggleButton = findToggleButtonForBlock(editor.domElement, block.id);
  if (!toggleButton) return false;

  toggleButton.click();
  return true;
}

function resolveCardTarget(
  actions: ModifyShortcutActions,
  block: ModifyShortcutBlock,
): OpenModifyShortcutCardInput | null {
  if (block.type === "cardRef") {
    const cardId = readStringProp(block.props, "cardId");
    if (!cardId) return null;

    return {
      projectId: readStringProp(block.props, "sourceProjectId") || actions.projectId,
      cardId,
      titleSnapshot: readBlockText(block),
    };
  }

  if (block.type !== "cardToggle") return null;

  const cardId = readStringProp(block.props, "cardId") || readStringProp(block.props, "projectionCardId");
  if (!cardId) return null;

  return {
    projectId:
      readStringProp(block.props, "sourceProjectId")
      || readStringProp(block.props, "projectionSourceProjectId")
      || actions.projectId,
    cardId,
    titleSnapshot: readBlockText(block),
  };
}

export function modifyCurrentBlock(
  editor: ModifyShortcutEditor,
  actions: ModifyShortcutActions,
): boolean {
  const block = resolveShortcutBlock(editor);
  if (!block) return false;

  if (block.type === "checkListItem") {
    if (!editor.updateBlock) return false;
    editor.updateBlock(block, { props: { checked: !Boolean(block.props?.checked) } });
    return true;
  }

  if (isToggleLikeBlock(block)) {
    return handleToggleBlock(editor, block);
  }

  if (block.type === "image") {
    const preview = resolveImagePreview(block);
    if (!preview || !actions.openImagePreview) return false;
    actions.openImagePreview(preview);
    return true;
  }

  if (block.type === "cardRef" || block.type === "cardToggle") {
    const cardTarget = resolveCardTarget(actions, block);
    if (cardTarget && actions.openCard) {
      void actions.openCard(cardTarget);
      return true;
    }

    if (block.type === "cardToggle") {
      return handleToggleBlock(editor, block);
    }
    return false;
  }

  if (block.type !== "threadSection") return false;

  const threadId = readStringProp(block.props, "threadId");
  if (!threadId || !actions.openThread) return false;

  void actions.openThread(threadId);
  return true;
}
