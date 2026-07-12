import {
  hasDragType,
  isLocalNativeEditorDragFromAnotherSurface,
  NODEX_CARD_REFERENCES_DRAG_MIME,
  parseCardReferenceDragPayload,
  type CrossSurfaceCardReference,
} from "../cross-surface-drag";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  buildKanbanCardReferenceEditorDropTargetData,
  isKanbanCardDragData,
} from "../pragmatic-drag-data";
import { hasClosest, resolveBlockId } from "./drag-source-resolver";

interface EditorBlock {
  readonly id: string;
}

export interface CardReferenceDropEditor {
  readonly document: readonly EditorBlock[];
  insertBlocks(
    blocks: readonly unknown[],
    referenceBlock: string,
    placement: "before" | "after",
  ): unknown;
  replaceBlocks(
    toRemove: readonly unknown[],
    replacements: readonly unknown[],
  ): void;
  transact?<T>(operation: () => T): T;
}

export interface CardReferenceDropBoundary {
  readonly projectId: string;
  readonly hostCardId?: string;
  readonly ancestorCardIds: readonly string[];
  readonly allocateBlockId: () => string;
}

interface DropAnchor {
  readonly blockId: string;
  readonly placement: "before" | "after";
  readonly element: HTMLElement;
}

const resolveAnchor = (
  container: HTMLElement,
  clientX: number,
  clientY: number,
): DropAnchor | null => {
  const elements =
    typeof container.ownerDocument.elementsFromPoint === "function"
      ? container.ownerDocument.elementsFromPoint(clientX, clientY)
      : [];
  for (const element of elements) {
    if (!hasClosest(element) || !container.contains(element)) continue;
    const blockElement = element.closest<HTMLElement>(".bn-block[data-id]");
    if (!blockElement) continue;
    const blockId = resolveBlockId(blockElement);
    if (!blockId) continue;
    const rect = blockElement.getBoundingClientRect();
    return {
      blockId,
      placement: clientY <= rect.top + rect.height / 2 ? "before" : "after",
      element: blockElement,
    };
  }

  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>(".bn-block[data-id]"),
  );
  for (const blockElement of blocks) {
    const blockId = resolveBlockId(blockElement);
    if (!blockId) continue;
    const rect = blockElement.getBoundingClientRect();
    if (clientY <= rect.top + rect.height / 2) {
      return { blockId, placement: "before", element: blockElement };
    }
  }
  const last = blocks.at(-1);
  const lastId = last ? resolveBlockId(last) : null;
  return last && lastId
    ? { blockId: lastId, placement: "after", element: last }
    : null;
};

const allowedCards = (
  cards: readonly CrossSurfaceCardReference[],
  boundary: CardReferenceDropBoundary,
): readonly CrossSurfaceCardReference[] => {
  const forbidden = new Set(boundary.ancestorCardIds);
  if (boundary.hostCardId) forbidden.add(boundary.hostCardId);
  return cards.filter(
    (card) => card.projectId === boundary.projectId && !forbidden.has(card.cardId),
  );
};

const referencesFromKanbanDrag = (
  source: unknown,
): readonly CrossSurfaceCardReference[] => {
  if (!isKanbanCardDragData(source)) return [];
  return source.dragItems.map((item) => ({
    projectId: source.projectId,
    cardId: item.card.id,
    title: item.card.title,
  }));
};

const toReferenceBlocks = (
  cards: readonly CrossSurfaceCardReference[],
  allocateBlockId: () => string,
) =>
  cards.map((card) => ({
    id: allocateBlockId(),
    type: "cardRef" as const,
    props: {
      targetBlockId: card.cardId,
      displayHint: card.title,
    },
  }));

const insertReferences = (
  editor: CardReferenceDropEditor,
  anchor: DropAnchor | null,
  blocks: readonly unknown[],
): void => {
  const run = <T>(operation: () => T): T =>
    editor.transact ? editor.transact(operation) : operation();
  run(() => {
    if (anchor) {
      editor.insertBlocks(blocks, anchor.blockId, anchor.placement);
      return;
    }
    if (editor.document.length === 0) {
      editor.replaceBlocks(editor.document, blocks);
      return;
    }
    editor.insertBlocks(blocks, editor.document.at(-1)!.id, "after");
  });
};

const createIndicator = (container: HTMLElement): HTMLDivElement => {
  const indicator = container.ownerDocument.createElement("div");
  indicator.setAttribute("data-card-reference-drop-indicator", "");
  indicator.setAttribute("aria-hidden", "true");
  indicator.className =
    "prosemirror-dropcursor-block prosemirror-dropcursor-block-horizontal pointer-events-none absolute z-50";
  return indicator;
};

const positionIndicator = (
  indicator: HTMLDivElement,
  container: HTMLElement,
  anchor: DropAnchor | null,
): void => {
  const containerRect = container.getBoundingClientRect();
  if (!anchor) {
    indicator.style.left = "12px";
    indicator.style.right = "12px";
    indicator.style.top = "10px";
    return;
  }
  const rect = anchor.element.getBoundingClientRect();
  indicator.style.left = `${Math.max(rect.left - containerRect.left, 0)}px`;
  indicator.style.width = `${Math.max(rect.width, 32)}px`;
  indicator.style.top = `${(anchor.placement === "before" ? rect.top : rect.bottom) - containerRect.top}px`;
};

export const setupCardReferenceDrop = (
  container: HTMLElement,
  editor: CardReferenceDropEditor,
  boundary: CardReferenceDropBoundary,
): (() => void) => {
  let indicator: HTMLDivElement | null = null;
  const clear = () => {
    indicator?.remove();
    indicator = null;
    container.removeAttribute("data-card-reference-drop-hover");
  };
  const onDragOver = (event: DragEvent) => {
    if (
      !event.dataTransfer ||
      !isLocalNativeEditorDragFromAnotherSurface(container) ||
      !hasDragType(event.dataTransfer, NODEX_CARD_REFERENCES_DRAG_MIME)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "link";
    container.setAttribute("data-card-reference-drop-hover", "");
    indicator ??= createIndicator(container);
    if (!indicator.isConnected) container.append(indicator);
    positionIndicator(
      indicator,
      container,
      resolveAnchor(container, event.clientX, event.clientY),
    );
  };
  const onDragLeave = (event: DragEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && container.contains(next)) return;
    clear();
  };
  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer) return;
    if (!isLocalNativeEditorDragFromAnotherSurface(container)) return;
    const payload = parseCardReferenceDragPayload(
      event.dataTransfer.getData(NODEX_CARD_REFERENCES_DRAG_MIME),
    );
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    const cards = allowedCards(payload.cards, boundary);
    if (cards.length > 0) {
      insertReferences(
        editor,
        resolveAnchor(container, event.clientX, event.clientY),
        toReferenceBlocks(cards, boundary.allocateBlockId),
      );
    }
    clear();
  };
  container.addEventListener("dragover", onDragOver);
  container.addEventListener("dragleave", onDragLeave);
  container.addEventListener("drop", onDrop);
  return () => {
    container.removeEventListener("dragover", onDragOver);
    container.removeEventListener("dragleave", onDragLeave);
    container.removeEventListener("drop", onDrop);
    clear();
  };
};

export const setupKanbanCardReferenceDrop = (
  container: HTMLElement,
  editor: CardReferenceDropEditor,
  boundary: CardReferenceDropBoundary,
): (() => void) => {
  let indicator: HTMLDivElement | null = null;
  const clear = () => {
    indicator?.remove();
    indicator = null;
    container.removeAttribute("data-card-reference-drop-hover");
  };
  const updateIndicator = (clientX: number, clientY: number) => {
    container.setAttribute("data-card-reference-drop-hover", "");
    indicator ??= createIndicator(container);
    if (!indicator.isConnected) container.append(indicator);
    positionIndicator(
      indicator,
      container,
      resolveAnchor(container, clientX, clientY),
    );
  };

  return dropTargetForElements({
    element: container,
    getData: buildKanbanCardReferenceEditorDropTargetData,
    canDrop: ({ source }) =>
      allowedCards(referencesFromKanbanDrag(source.data), boundary).length > 0,
    getDropEffect: () => "link",
    onDragEnter: ({ location }) => updateIndicator(
      location.current.input.clientX,
      location.current.input.clientY,
    ),
    onDrag: ({ location }) => updateIndicator(
      location.current.input.clientX,
      location.current.input.clientY,
    ),
    onDragLeave: clear,
    onDrop: ({ source, location }) => {
      const cards = allowedCards(
        referencesFromKanbanDrag(source.data),
        boundary,
      );
      if (cards.length > 0) {
        insertReferences(
          editor,
          resolveAnchor(
            container,
            location.current.input.clientX,
            location.current.input.clientY,
          ),
          toReferenceBlocks(cards, boundary.allocateBlockId),
        );
      }
      clear();
    },
  });
};
