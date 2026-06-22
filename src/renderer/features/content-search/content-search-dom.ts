export const CONTENT_SEARCH_MARK_CLASS = "codex-thread-find-match";
export const CONTENT_SEARCH_ACTIVE_MARK_CLASS = "codex-thread-find-active";
export const CONTENT_SEARCH_MATCH_ID_ATTRIBUTE = "data-content-search-match-id";

const CONTENT_SEARCH_SKIP_SELECTOR = [
  "script",
  "style",
  "textarea",
  "input",
  "[contenteditable='true']",
  "[data-thread-find-skip]",
  "[data-content-search-skip]",
  "[data-review-line-number]",
  ".diff-line-number",
  ".diff-gutter",
].join(",");

export interface ContentSearchDomMatch {
  id: string;
  ordinal: number;
  element: HTMLElement;
}

export interface ContentSearchDomApplyResult {
  matches: ContentSearchDomMatch[];
  totalMatches: number;
  capped: boolean;
}

interface TextNodeMatches {
  node: Text;
  indexes: number[];
}

function isElementSkipped(element: Element | null): boolean {
  if (!element) return true;
  return Boolean(element.closest(CONTENT_SEARCH_SKIP_SELECTOR));
}

function getMatchIndexes(text: string, query: string): number[] {
  const indexes: number[] = [];
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let cursor = 0;

  while (cursor < normalizedText.length) {
    const index = normalizedText.indexOf(normalizedQuery, cursor);
    if (index === -1) break;
    indexes.push(index);
    cursor = index + normalizedQuery.length;
  }

  return indexes;
}

function collectTextNodeMatches(
  root: HTMLElement,
  query: string,
  limit: number,
): { nodes: TextNodeMatches[]; totalMatches: number; capped: boolean } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (isElementSkipped(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue.toLowerCase().includes(query.toLowerCase())
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: TextNodeMatches[] = [];
  let totalMatches = 0;
  let capped = false;

  while (true) {
    const current = walker.nextNode() as Text | null;
    if (!current) break;
    const indexes = getMatchIndexes(current.nodeValue ?? "", query);
    if (indexes.length === 0) continue;

    const remaining = limit - totalMatches;
    if (remaining <= 0) {
      capped = true;
      break;
    }

    const acceptedIndexes = indexes.slice(0, remaining);
    nodes.push({ node: current, indexes: acceptedIndexes });
    totalMatches += acceptedIndexes.length;
    if (indexes.length > acceptedIndexes.length || totalMatches >= limit) {
      capped = indexes.length > acceptedIndexes.length || totalMatches >= limit;
      break;
    }
  }

  return { nodes, totalMatches, capped };
}

export function clearContentSearchMarks(root: HTMLElement | null): void {
  if (!root) return;
  const marks = Array.from(root.querySelectorAll<HTMLElement>(`mark.${CONTENT_SEARCH_MARK_CLASS}`));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}

export function applyContentSearchDomMarks(input: {
  root: HTMLElement;
  query: string;
  idPrefix: string;
  activeMatchId?: string | null;
  limit?: number;
}): ContentSearchDomApplyResult {
  const limit = input.limit ?? 150;
  const query = input.query.trim();
  clearContentSearchMarks(input.root);
  if (!query) {
    return { matches: [], totalMatches: 0, capped: false };
  }

  const collected = collectTextNodeMatches(input.root, query, limit);
  const matches: ContentSearchDomMatch[] = [];
  let ordinal = 0;

  for (const item of collected.nodes) {
    const indexedMatches = item.indexes.map((index, offset) => ({
      index,
      ordinal: ordinal + offset,
    }));
    for (const { index, ordinal: matchOrdinal } of [...indexedMatches].reverse()) {
      const originalNode = item.node;
      const afterNode = originalNode.splitText(index + query.length);
      const matchNode = originalNode.splitText(index);
      const parent = afterNode.parentNode;
      if (!parent) continue;

      const id = `${input.idPrefix}:${matchOrdinal}`;
      const mark = document.createElement("mark");
      mark.className = input.activeMatchId === id
        ? `${CONTENT_SEARCH_MARK_CLASS} ${CONTENT_SEARCH_ACTIVE_MARK_CLASS}`
        : CONTENT_SEARCH_MARK_CLASS;
      mark.setAttribute(CONTENT_SEARCH_MATCH_ID_ATTRIBUTE, id);
      mark.appendChild(matchNode);
      parent.insertBefore(mark, afterNode);
      matches.push({ id, ordinal: matchOrdinal, element: mark });
    }
    ordinal += item.indexes.length;
  }

  matches.sort((left, right) => left.ordinal - right.ordinal);
  return {
    matches,
    totalMatches: collected.totalMatches,
    capped: collected.capped,
  };
}

export function setActiveContentSearchDomMatch(root: HTMLElement | null, activeMatchId: string | null): HTMLElement | null {
  if (!root) return null;
  let activeElement: HTMLElement | null = null;
  const marks = root.querySelectorAll<HTMLElement>(`mark.${CONTENT_SEARCH_MARK_CLASS}`);
  for (const mark of marks) {
    const isActive = mark.getAttribute(CONTENT_SEARCH_MATCH_ID_ATTRIBUTE) === activeMatchId;
    mark.classList.toggle(CONTENT_SEARCH_ACTIVE_MARK_CLASS, isActive);
    if (isActive) activeElement = mark;
  }
  return activeElement;
}

export function countContentSearchDomMatches(input: {
  root: HTMLElement;
  query: string;
  limit?: number;
}): { totalMatches: number; capped: boolean } {
  const query = input.query.trim();
  if (!query) return { totalMatches: 0, capped: false };
  const collected = collectTextNodeMatches(input.root, query, input.limit ?? 150);
  return {
    totalMatches: collected.totalMatches,
    capped: collected.capped,
  };
}
