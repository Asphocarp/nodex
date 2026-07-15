export interface RichTitleDomSelection {
  readonly anchor: number;
  readonly focus: number;
  readonly start: number;
  readonly end: number;
  readonly direction: "forward" | "backward" | "none";
}

export interface RichTitleDomPoint {
  readonly node: Node;
  readonly offset: number;
}

export interface RichTitleRect {
  readonly top: number;
  readonly bottom: number;
}

export type RichTitleVerticalDirection = "up" | "down";

const readSegmentStart = (element: Element): number | null => {
  const value = element.getAttribute("data-rich-title-start");
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const readSegmentLength = (element: Element): number | null => {
  const value = element.getAttribute("data-rich-title-length");
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const closestSegment = (root: HTMLElement, node: Node): HTMLElement | null => {
  const element = node instanceof Element ? node : node.parentElement;
  const segment = element?.closest<HTMLElement>("[data-rich-title-segment]") ?? null;
  return segment && root.contains(segment) ? segment : null;
};

const rootOffsetToIndex = (root: HTMLElement, offset: number): number => {
  let index = 0;
  const boundedOffset = Math.min(Math.max(offset, 0), root.childNodes.length);
  for (let childIndex = 0; childIndex < boundedOffset; childIndex += 1) {
    const child = root.childNodes[childIndex];
    if (!(child instanceof Element)) continue;
    index += readSegmentLength(child) ?? 0;
  }
  return index;
};

const richTitleDraftNodeValue = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.richTitleKind === "atom") return "\uFFFC";
  if (node.dataset.richTitleKind === "linebreak") return "\n";
  return node.textContent ?? "";
};

const richTitleDraftNodeLength = (node: Node): number =>
  richTitleDraftNodeValue(node).length;

const closestDraftChild = (
  root: HTMLElement,
  node: Node,
): ChildNode | null => {
  if (!root.contains(node)) return null;
  let child: Node = node;
  while (child.parentNode && child.parentNode !== root) {
    child = child.parentNode;
  }
  return child.parentNode === root ? child as ChildNode : null;
};

const richTitleDraftDomPointToIndex = (
  root: HTMLElement,
  node: Node,
  offset: number,
): number | null => {
  const children = [...root.childNodes];
  if (node === root) {
    const boundedOffset = Math.min(Math.max(offset, 0), children.length);
    return children
      .slice(0, boundedOffset)
      .reduce((length, child) => length + richTitleDraftNodeLength(child), 0);
  }

  const draftChild = closestDraftChild(root, node);
  if (!draftChild) return null;
  const childIndex = children.indexOf(draftChild);
  if (childIndex < 0) return null;
  const childStart = children
    .slice(0, childIndex)
    .reduce((length, child) => length + richTitleDraftNodeLength(child), 0);
  if (!(draftChild instanceof HTMLElement)) {
    return childStart + Math.min(
      Math.max(offset, 0),
      richTitleDraftNodeLength(draftChild),
    );
  }
  if (
    draftChild.dataset.richTitleKind === "atom" ||
    draftChild.dataset.richTitleKind === "linebreak"
  ) {
    return childStart + (node === draftChild && offset === 0 ? 0 : 1);
  }

  const range = root.ownerDocument.createRange();
  range.setStart(draftChild, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return childStart + Math.min(
    range.toString().length,
    richTitleDraftNodeLength(draftChild),
  );
};

const readRichTitleSelection = (
  root: HTMLElement,
  pointToIndex: (
    root: HTMLElement,
    node: Node,
    offset: number,
  ) => number | null,
): RichTitleDomSelection | null => {
  const selection = root.ownerDocument.getSelection();
  if (!selection || !selection.anchorNode || !selection.focusNode) return null;
  const anchor = pointToIndex(
    root,
    selection.anchorNode,
    selection.anchorOffset,
  );
  const focus = pointToIndex(
    root,
    selection.focusNode,
    selection.focusOffset,
  );
  if (anchor === null || focus === null) return null;
  return {
    anchor,
    focus,
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
    direction: anchor === focus ? "none" : anchor < focus ? "forward" : "backward",
  };
};

export const richTitleDomPointToIndex = (
  root: HTMLElement,
  node: Node,
  offset: number,
): number | null => {
  if (node === root) return rootOffsetToIndex(root, offset);
  if (!root.contains(node)) return null;
  const segment = closestSegment(root, node);
  if (!segment) return null;
  const start = readSegmentStart(segment);
  const length = readSegmentLength(segment);
  if (start === null || length === null) return null;
  if (segment.dataset.richTitleKind !== "text") {
    if (node === segment) return start + (offset > 0 ? length : 0);
    return start + (offset > 0 ? length : 0);
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return start + Math.min(Math.max(offset, 0), length);
  }
  const range = root.ownerDocument.createRange();
  range.setStart(segment, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return start + Math.min(range.toString().length, length);
};

export const readRichTitleDomSelection = (
  root: HTMLElement,
): RichTitleDomSelection | null =>
  readRichTitleSelection(root, richTitleDomPointToIndex);

/**
 * Reads selection offsets from the browser-mutated draft DOM. Segment metadata
 * still describes the last committed Y.Text projection at this point, so draft
 * coordinates must be derived from the live DOM instead.
 */
export const readRichTitleDomDraftSelection = (
  root: HTMLElement,
): RichTitleDomSelection | null =>
  readRichTitleSelection(root, richTitleDraftDomPointToIndex);

export const richTitleIndexToDomPoint = (
  root: HTMLElement,
  requestedIndex: number,
): RichTitleDomPoint => {
  const index = Math.max(0, requestedIndex);
  const children = [...root.children] as HTMLElement[];
  for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
    const segment = children[childIndex];
    if (!segment) continue;
    const start = readSegmentStart(segment);
    const length = readSegmentLength(segment);
    if (start === null || length === null) continue;
    if (index > start + length) continue;
    if (segment.dataset.richTitleKind === "text") {
      const text = segment.firstChild;
      if (text?.nodeType === Node.TEXT_NODE) {
        return { node: text, offset: Math.min(Math.max(index - start, 0), length) };
      }
    }
    return {
      node: root,
      offset: index <= start ? childIndex : childIndex + 1,
    };
  }
  return { node: root, offset: root.childNodes.length };
};

export const restoreRichTitleDomSelection = (
  root: HTMLElement,
  anchorIndex: number,
  focusIndex: number,
): void => {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const anchor = richTitleIndexToDomPoint(root, anchorIndex);
  const focus = richTitleIndexToDomPoint(root, focusIndex);
  selection.removeAllRanges();
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      focus.node,
      focus.offset,
    );
    return;
  }
  const range = root.ownerDocument.createRange();
  range.setStart(anchor.node, anchor.offset);
  range.setEnd(focus.node, focus.offset);
  selection.addRange(range);
};

const richTitleDomLength = (root: HTMLElement): number =>
  [...root.children].reduce((length, child) => {
    const start = readSegmentStart(child);
    const segmentLength = readSegmentLength(child);
    if (start === null || segmentLength === null) return length;
    return Math.max(length, start + segmentLength);
  }, 0);

export function isCaretAtVerticalRectBoundary(
  caret: RichTitleRect,
  contentRects: readonly RichTitleRect[],
  direction: RichTitleVerticalDirection,
): boolean {
  return !contentRects.some((rect) => {
    if (rect.bottom <= rect.top + 1) return false;
    return direction === "up"
      ? caret.top - rect.top > (rect.bottom - caret.top) * 2
      : rect.bottom - caret.bottom > (caret.bottom - rect.top) * 2;
  });
}

const readRenderedContentRects = (root: HTMLElement): readonly DOMRect[] => {
  const rects: DOMRect[] = [];
  for (const child of root.childNodes) {
    if (child instanceof Element) {
      rects.push(...child.getClientRects());
      continue;
    }
    if (!(child instanceof Text) || child.length === 0) continue;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(child);
    rects.push(...range.getClientRects());
  }
  return rects;
};

export function isRichTitleDomSelectionAtVerticalBoundary(
  root: HTMLElement,
  direction: RichTitleVerticalDirection,
): boolean {
  const richSelection = readRichTitleDomSelection(root);
  if (!richSelection || richSelection.start !== richSelection.end) return false;

  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  const caret = range.getBoundingClientRect();
  const contentRects = readRenderedContentRects(root);
  if (caret.height > 0 && contentRects.length > 0) {
    return isCaretAtVerticalRectBoundary(caret, contentRects, direction);
  }

  return direction === "up"
    ? richSelection.start === 0
    : richSelection.end === richTitleDomLength(root);
}

export function focusRichTitleDomBoundary(
  root: HTMLElement,
  placement: "start" | "end",
): void {
  root.focus();
  const index = placement === "start" ? 0 : richTitleDomLength(root);
  restoreRichTitleDomSelection(root, index, index);
}

export function focusRichTitleDomAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): void {
  root.focus();
  const documentWithCaret = root.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { readonly offsetNode: Node; readonly offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = documentWithCaret.caretPositionFromPoint?.(clientX, clientY);
  const range = position
    ? null
    : documentWithCaret.caretRangeFromPoint?.(clientX, clientY) ?? null;
  const node = position?.offsetNode ?? range?.startContainer ?? null;
  const offset = position?.offset ?? range?.startOffset ?? 0;
  const index = node ? richTitleDomPointToIndex(root, node, offset) : null;
  const resolvedIndex = index ?? richTitleDomLength(root);
  restoreRichTitleDomSelection(root, resolvedIndex, resolvedIndex);
}

/** Reads the browser's uncommitted IME draft using Y.Text-compatible atoms. */
export const readRichTitleDomDraft = (root: HTMLElement): string =>
  [...root.childNodes].map(richTitleDraftNodeValue).join("");
