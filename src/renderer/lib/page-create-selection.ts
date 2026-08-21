import { MAX_PAGE_TITLE_LENGTH } from "../../shared/page-limits";
import { classifyKeyboardActionPath } from "./keyboard-action-runtime";

export interface PageCreateSeed {
  readonly title: string;
}

const normalizeWhitespace = (value: string): string =>
  value.replace(/\p{White_Space}+/gu, " ").trim();

const truncateUtf16WithoutSplittingSurrogate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  const truncated = value.slice(0, maxLength);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit < 0xd800 || finalCodeUnit > 0xdbff) return truncated;
  return truncated.slice(0, -1);
};

export function normalizePageCreateSelectionText(text: string): string | null {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return null;
  return truncateUtf16WithoutSplittingSurrogate(normalized, MAX_PAGE_TITLE_LENGTH);
}

function nodePath(node: Node | null): readonly EventTarget[] {
  const path: EventTarget[] = [];
  let current: Node | null = node;
  while (current) {
    path.push(current);
    current = current.parentNode;
  }
  return path;
}

const nodeIsGloballyOwned = (node: Node | null): boolean =>
  classifyKeyboardActionPath(nodePath(node)) === "global";

function rangeCrossesOwnedSurface(range: Range): boolean {
  const commonAncestor = range.commonAncestorContainer;
  const root: Element | null =
    commonAncestor.nodeType === Node.ELEMENT_NODE
      ? (commonAncestor as Element)
      : commonAncestor.parentElement;
  if (!root) return false;

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let element: Node | null = root;
  while (element) {
    if (range.intersectsNode(element) && !nodeIsGloballyOwned(element)) {
      return true;
    }
    element = walker.nextNode();
  }
  return false;
}

export function capturePageCreateSeed(selection: Selection | null): PageCreateSeed | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!nodeIsGloballyOwned(selection.anchorNode)) return null;
  if (!nodeIsGloballyOwned(selection.focusNode)) return null;
  if (!nodeIsGloballyOwned(range.commonAncestorContainer)) return null;
  if (rangeCrossesOwnedSurface(range)) return null;

  const title = normalizePageCreateSelectionText(selection.toString());
  return title ? { title } : null;
}
