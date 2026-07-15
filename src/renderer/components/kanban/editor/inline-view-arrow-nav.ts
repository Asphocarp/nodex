export type InlineArrowDirection = "prev" | "next";

interface InlineArrowBlockCursor {
  id: string;
  type: string;
}

interface InlineArrowSelection {
  anchor: number;
  head: number;
  $anchor: {
    parentOffset: number;
    parent: {
      content: {
        size: number;
      };
    };
  };
}

interface EditorForInlineArrowEntry {
  getTextCursorPosition: () => {
    block: InlineArrowBlockCursor;
    prevBlock?: InlineArrowBlockCursor;
    nextBlock?: InlineArrowBlockCursor;
  };
  transact: <T>(fn: (tr: { selection: InlineArrowSelection }) => T) => T;
}

function isCursorAtBlockBoundary(
  editor: EditorForInlineArrowEntry,
  direction: InlineArrowDirection,
): boolean {
  return editor.transact((tr) => {
    const { anchor, head, $anchor } = tr.selection;
    if (anchor !== head) return false;

    if (direction === "prev") {
      return $anchor.parentOffset === 0;
    }

    return $anchor.parentOffset === $anchor.parent.content.size;
  });
}

function querySingle(
  container: ParentNode | Element | undefined,
  selector: string,
): HTMLElement | null {
  if (!container) return null;
  const queryable = container as ParentNode & {
    querySelector?: <T extends Element = Element>(selectors: string) => T | null;
  };
  if (typeof queryable.querySelector !== "function") return null;
  return queryable.querySelector<HTMLElement>(selector);
}

function resolveBlockElement(
  editorDom: ParentNode | undefined,
  blockId: string | undefined,
): HTMLElement | null {
  if (!blockId) return null;
  return querySingle(editorDom, `.bn-block[data-id="${escapeSelector(blockId)}"]`);
}

function escapeSelector(value: string): string {
  const cssEscape = globalThis.CSS?.escape;
  if (typeof cssEscape === "function") {
    return cssEscape(value);
  }
  return value;
}

function hasContains(value: unknown): value is { contains: (candidate: unknown) => boolean } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { contains?: unknown }).contains === "function";
}

function resolveSelectionAnchorNode(editorDom: ParentNode | undefined): Node | null {
  if (!editorDom) return null;
  const ownerDocument = (editorDom as { ownerDocument?: Document }).ownerDocument
    ?? (typeof document !== "undefined" ? document : null);
  if (!ownerDocument) return null;
  const selection = ownerDocument.getSelection();
  return selection?.anchorNode ?? null;
}

function isSelectionWithinCollapsedToggleHeader(
  editorDom: ParentNode | undefined,
  eventTarget: EventTarget | null | undefined,
  currentBlock: HTMLElement,
  childGroup: HTMLElement,
): boolean {
  if (!hasContains(currentBlock) || !hasContains(childGroup)) return false;

  const selectionAnchorNode = resolveSelectionAnchorNode(editorDom);
  if (selectionAnchorNode) {
    if (!currentBlock.contains(selectionAnchorNode)) return false;
    return !childGroup.contains(selectionAnchorNode);
  }

  if (!eventTarget) return false;
  if (!currentBlock.contains(eventTarget)) return false;
  return !childGroup.contains(eventTarget);
}

function resolveCollapsedToggleChildGroup(currentBlock: HTMLElement): HTMLElement | null {
  const toggleWrapper = querySingle(currentBlock, ".bn-toggle-wrapper");
  if (!toggleWrapper) return null;
  if (toggleWrapper.getAttribute("data-show-children") !== "false") return null;

  return querySingle(currentBlock, ":scope > .bn-block-group")
    ?? querySingle(currentBlock, ".bn-block-group");
}

function resolveDirectionalBoundaryBlockContent(
  childGroup: HTMLElement,
  direction: InlineArrowDirection,
): HTMLElement | null {
  const edgeSelector = direction === "prev"
    ? ":scope > .bn-block-outer:last-child > .bn-block .bn-block-content"
    : ":scope > .bn-block-outer:first-child > .bn-block .bn-block-content";

  return querySingle(childGroup, edgeSelector);
}

function isCommonInlineBoundaryBlock(blockContent: HTMLElement): boolean {
  return querySingle(blockContent, ".bn-inline-content") !== null;
}

/**
 * When ArrowUp/ArrowDown would move across a collapsed toggle boundary, let the
 * browser keep native vertical motion if ProseMirror would otherwise dive into
 * a hidden edge non-inline child block.
 */
export function shouldDeferArrowToBrowserFromCollapsedToggle(
  editor: EditorForInlineArrowEntry,
  editorDom: ParentNode | undefined,
  direction: InlineArrowDirection,
  eventTarget?: EventTarget | null,
): boolean {
  if (!editorDom) return false;

  const cursor = editor.getTextCursorPosition();
  const currentBlock = resolveBlockElement(editorDom, cursor.block.id);
  const currentChildGroup = currentBlock
    ? resolveCollapsedToggleChildGroup(currentBlock)
    : null;
  if (
    currentBlock
    && currentChildGroup
    && isSelectionWithinCollapsedToggleHeader(editorDom, eventTarget, currentBlock, currentChildGroup)
  ) {
    return true;
  }

  if (!isCursorAtBlockBoundary(editor, direction)) return false;

  const candidate = direction === "prev" ? cursor.prevBlock : cursor.nextBlock;
  if (!candidate?.id) return false;

  const candidateBlock = resolveBlockElement(editorDom, candidate.id);
  if (!candidateBlock) return false;

  const candidateChildGroup = resolveCollapsedToggleChildGroup(candidateBlock);
  if (!candidateChildGroup) return false;

  const boundaryBlockContent = resolveDirectionalBoundaryBlockContent(candidateChildGroup, direction);
  if (!boundaryBlockContent) return false;

  return !isCommonInlineBoundaryBlock(boundaryBlockContent);
}

export function deferCollapsedToggleVerticalArrowToBrowser(
  editor: EditorForInlineArrowEntry,
  editorDom: ParentNode | undefined,
  direction: InlineArrowDirection,
  event: Pick<KeyboardEvent, "target" | "stopImmediatePropagation">,
): boolean {
  if (!shouldDeferArrowToBrowserFromCollapsedToggle(editor, editorDom, direction, event.target)) {
    return false;
  }

  event.stopImmediatePropagation();
  return true;
}
