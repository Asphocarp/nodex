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
): RichTitleDomSelection | null => {
  const selection = root.ownerDocument.getSelection();
  if (!selection || !selection.anchorNode || !selection.focusNode) return null;
  const anchor = richTitleDomPointToIndex(
    root,
    selection.anchorNode,
    selection.anchorOffset,
  );
  const focus = richTitleDomPointToIndex(
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

/** Reads the browser's uncommitted IME draft using Y.Text-compatible atoms. */
export const readRichTitleDomDraft = (root: HTMLElement): string =>
  [...root.childNodes]
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof HTMLElement)) return "";
      if (node.dataset.richTitleKind === "atom") return "\uFFFC";
      if (node.dataset.richTitleKind === "linebreak") return "\n";
      return node.textContent ?? "";
    })
    .join("");
