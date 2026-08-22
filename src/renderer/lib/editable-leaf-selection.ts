const getBrowserSelection = (root: HTMLElement): Selection | null =>
  root.ownerDocument.getSelection();

export const EDITABLE_LEAF_SELECTOR = '[data-editor-select-all-scope="leaf"]';

const closestEditableLeaf = (node: Node | null): HTMLElement | null => {
  if (!node || typeof Element === "undefined") return null;
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(EDITABLE_LEAF_SELECTOR) ?? null;
};

export function findSelectedEditableLeaf(
  editorRoot: ParentNode | undefined,
  selection: Selection | null,
): HTMLElement | null {
  if (!editorRoot || !selection) return null;
  const anchorLeaf = closestEditableLeaf(selection.anchorNode);
  const focusLeaf = closestEditableLeaf(selection.focusNode);
  if (!anchorLeaf || anchorLeaf !== focusLeaf) return null;
  return editorRoot instanceof Node && editorRoot.contains(anchorLeaf) ? anchorLeaf : null;
}

const nodeBoundaryLength = (node: Node): number =>
  node instanceof Text ? node.length : node.childNodes.length;

const isPointAtLeafEdge = (
  root: HTMLElement,
  node: Node,
  offset: number,
  edge: "start" | "end",
): boolean => {
  if (node === root) return offset === (edge === "start" ? 0 : root.childNodes.length);
  if (!root.contains(node)) return false;
  if (offset !== (edge === "start" ? 0 : nodeBoundaryLength(node))) return false;

  let current = node;
  while (current.parentNode && current.parentNode !== root) {
    const siblingAtEdge =
      edge === "start" ? current.parentNode.firstChild : current.parentNode.lastChild;
    if (current !== siblingAtEdge) return false;
    current = current.parentNode;
  }
  return current === (edge === "start" ? root.firstChild : root.lastChild);
};

/**
 * Returns whether one DOM range covers every boundary inside an editable leaf.
 * The range may extend beyond the leaf, which is important once a parent editor
 * has already promoted the selection to its document scope.
 */
export function selectionCoversEditableLeaf(
  root: HTMLElement,
  selection: Selection | null = getBrowserSelection(root),
): boolean {
  if (!selection || selection.rangeCount !== 1) return false;

  const rangeConstructor = root.ownerDocument.defaultView?.Range;
  if (!rangeConstructor) return false;

  const selectedRange = selection.getRangeAt(0);
  const leafRange = root.ownerDocument.createRange();
  leafRange.selectNodeContents(root);
  const startsBeforeOrAtLeaf =
    selectedRange.compareBoundaryPoints(rangeConstructor.START_TO_START, leafRange) <= 0 ||
    isPointAtLeafEdge(root, selectedRange.startContainer, selectedRange.startOffset, "start");
  const endsAfterOrAtLeaf =
    selectedRange.compareBoundaryPoints(rangeConstructor.END_TO_END, leafRange) >= 0 ||
    isPointAtLeafEdge(root, selectedRange.endContainer, selectedRange.endOffset, "end");
  return startsBeforeOrAtLeaf && endsAfterOrAtLeaf;
}

/**
 * Selects one editable leaf on the first select-all command. Returns false once
 * that leaf is already covered so the enclosing editor can handle the command.
 */
export function selectEditableLeafContent(
  root: HTMLElement,
  selection: Selection | null = getBrowserSelection(root),
): boolean {
  if (!selection || selectionCoversEditableLeaf(root, selection)) return false;

  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
