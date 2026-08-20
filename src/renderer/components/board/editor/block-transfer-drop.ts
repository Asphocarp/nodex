import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { DropCursorExtension } from "@blocknote/core/extensions";
import type { PublicBlockTransferIntent } from "../../../../shared/block-transfer-transport";
import type {
  BlockTransferCommandResult,
  BlockTransferDocumentHead,
} from "../../../../shared/block-transfer";
import type { DocumentHeadFence } from "../../../lib/block-document-surface-runtime";
import {
  blockTransferDropLabel,
  claimLocalBlockDragDropTarget,
  containsCanvasBlockDrag,
  containsDatabaseBlockDrag,
  type CrossSurfaceBlockTransferPayload,
  endLocalBlockDragSession,
  isSingleCanvasBlockDrag,
  registerLocalBlockDragDropTarget,
  releaseLocalBlockDragDropTarget,
  resolveLocalBlockDragDropSession,
  resolveLocalBlockDragSession,
  resolveCrossSurfaceTransferMode,
} from "../../workbench/block-transfer/cross-surface-drag";
import type {
  LibraryPageInsertion,
} from "../../../../shared/library-module";
import { resolveCanvasDropInsertion } from "@/lib/canvas-host-operations";
import {
  buildBoardCardEditorTransferTargetData,
  isBoardCardDragData,
} from "../pragmatic-drag-data";
import { hasClosest, resolveBlockId } from "./drag-source-resolver";

interface EditorBlock {
  readonly id: string;
  readonly children?: readonly EditorBlock[];
}

export interface BlockTransferDropEditor {
  readonly document: readonly EditorBlock[];
  readonly getExtension?: (extension: unknown) => unknown;
}

export interface BlockTransferDropBoundary {
  readonly surfaceId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly hostPageId?: string;
  readonly ancestorPageIds: readonly string[];
  /** Flushes unsent edits in the destination document before Core plans. */
  readonly flushAndFence?: () => Promise<DocumentHeadFence>;
  /** Flushes the actual drag source session when it is mounted locally. */
  readonly flushSourceAndFence?: (
    sourceSurfaceId: string,
  ) => Promise<DocumentHeadFence | undefined>;
  readonly transfer: (
    intent: PublicBlockTransferIntent,
  ) => Promise<BlockTransferCommandResult>;
  readonly transferCanvas?: (intent: {
    readonly canvasBlockId: string;
    readonly sourceSurfaceId: string;
    readonly sourcePageId: string;
    readonly targetPageId: string;
    readonly mode: "move" | "copy";
    readonly insertion: LibraryPageInsertion;
  }) => Promise<void>;
  readonly createOperationId: () => string;
  readonly reportError: (message: string) => void;
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

interface LocatedBlock {
  readonly parentBlockId?: string;
  readonly siblings: readonly EditorBlock[];
  readonly index: number;
}

const locateBlock = (
  blocks: readonly EditorBlock[],
  blockId: string,
  parentBlockId?: string,
): LocatedBlock | null => {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) return { parentBlockId, siblings: blocks, index };
  for (const block of blocks) {
    const nested = locateBlock(block.children ?? [], blockId, block.id);
    if (nested) return nested;
  }
  return null;
};

export const resolveBlockTransferDocumentTarget = (
  editor: BlockTransferDropEditor,
  anchor: Pick<DropAnchor, "blockId" | "placement"> | null,
): {
  readonly parentBlockId?: string;
  readonly beforeBlockId?: string;
} => {
  if (!anchor) return {};
  const located = locateBlock(editor.document, anchor.blockId);
  if (!located) return {};
  const beforeBlockId =
    anchor.placement === "before"
      ? anchor.blockId
      : located.siblings[located.index + 1]?.id;
  return {
    ...(located.parentBlockId ? { parentBlockId: located.parentBlockId } : {}),
    ...(beforeBlockId ? { beforeBlockId } : {}),
  };
};

const createIndicator = (container: HTMLElement): HTMLDivElement => {
  const indicator = container.ownerDocument.createElement("div");
  indicator.setAttribute("data-block-transfer-drop-indicator", "");
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

interface PragmaticDropTargetLocation {
  readonly current: {
    readonly dropTargets: readonly { readonly element: Element }[];
  };
}

const isInnermostPragmaticDropTarget = (
  location: PragmaticDropTargetLocation,
  element: Element,
): boolean => location.current.dropTargets[0]?.element === element;

export const setupBlockTransferDocumentDrop = (
  container: HTMLElement,
  editor: BlockTransferDropEditor,
  boundary: BlockTransferDropBoundary,
): (() => void) => {
  let indicator: HTMLDivElement | null = null;
  const dropCursor = editor.getExtension?.(DropCursorExtension) as
    | { readonly clearDropCursor?: () => void }
    | undefined;
  const clear = () => {
    indicator?.remove();
    indicator = null;
    container.removeAttribute("data-block-transfer-drop-hover");
    container.removeAttribute("data-block-transfer-drop-label");
    dropCursor?.clearDropCursor?.();
  };
  const canTransfer = (source: unknown): boolean => {
    if (!isBoardCardDragData(source)) return false;
    if (
      source.projectId !== boundary.projectId ||
      source.storeEpoch !== boundary.storeEpoch
    ) {
      return false;
    }
    const forbidden = new Set(boundary.ancestorPageIds);
    if (boundary.hostPageId) forbidden.add(boundary.hostPageId);
    return source.dragItems.every((item) => !forbidden.has(item.card.id));
  };
  const updateIndicator = (
    clientX: number,
    clientY: number,
    altKey: boolean,
  ) => {
    // BlockNote owns ordinary editor drags. Once this typed Page transfer is
    // accepted, its native cursor must yield to our one canonical insertion line.
    dropCursor?.clearDropCursor?.();
    container.setAttribute("data-block-transfer-drop-hover", "");
    container.setAttribute(
      "data-block-transfer-drop-label",
      blockTransferDropLabel(
        resolveCrossSurfaceTransferMode({ altKey }),
        "page",
      ),
    );
    indicator ??= createIndicator(container);
    if (!indicator.isConnected) container.append(indicator);
    positionIndicator(
      indicator,
      container,
      resolveAnchor(container, clientX, clientY),
    );
  };

  const prepareStructuralMutation = async (
    sourceSurfaceId?: string,
  ): Promise<readonly DocumentHeadFence[]> => {
    const tokens = await Promise.all([
      boundary.flushAndFence?.(),
      sourceSurfaceId === undefined
        ? undefined
        : boundary.flushSourceAndFence?.(sourceSurfaceId),
    ]);
    return tokens.filter(
      (token): token is DocumentHeadFence => token !== undefined,
    );
  };

  const causalDependenciesFromTokens = (
    tokens: readonly DocumentHeadFence[],
  ): readonly BlockTransferDocumentHead[] => {
    const dependencies = new Map<string, BlockTransferDocumentHead>();
    for (const token of tokens) {
      if (token.storeEpoch !== boundary.storeEpoch) {
        throw new Error("Block transfer causal Document belongs to another store epoch");
      }
      dependencies.set(token.documentId, {
        documentId: token.documentId,
        generation: token.generation,
        expectedHeadSeq: token.expectedHeadSeq,
      });
    }
    return [...dependencies.values()];
  };

  const reportFailure = (error: unknown, fallback: string): void => {
    boundary.reportError(error instanceof Error ? error.message : fallback);
  };

  const pragmaticCleanup = dropTargetForElements({
    element: container,
    getData: buildBoardCardEditorTransferTargetData,
    canDrop: ({ source }) => canTransfer(source.data),
    getDropEffect: ({ input }) => resolveCrossSurfaceTransferMode(input),
    onDragEnter: ({ location, self }) => {
      if (!isInnermostPragmaticDropTarget(location, self.element)) {
        clear();
        return;
      }
      updateIndicator(
        location.current.input.clientX,
        location.current.input.clientY,
        location.current.input.altKey,
      );
    },
    onDrag: ({ location, self }) => {
      if (!isInnermostPragmaticDropTarget(location, self.element)) {
        clear();
        return;
      }
      updateIndicator(
        location.current.input.clientX,
        location.current.input.clientY,
        location.current.input.altKey,
      );
    },
    onDragLeave: clear,
    onDrop: ({ source, location, self }) => {
      if (!isInnermostPragmaticDropTarget(location, self.element)) {
        clear();
        return;
      }
      if (!isBoardCardDragData(source.data)) {
        clear();
        return;
      }
      const sourceData = source.data;
      const anchor = resolveAnchor(
        container,
        location.current.input.clientX,
        location.current.input.clientY,
      );
      const target = resolveBlockTransferDocumentTarget(editor, anchor);
      clear();
      void prepareStructuralMutation()
        .then((tokens) => boundary.transfer({
          operationId: boundary.createOperationId(),
          projectId: boundary.projectId,
          storeEpoch: boundary.storeEpoch,
          mode: resolveCrossSurfaceTransferMode(location.current.input),
          rootBlockIds: sourceData.dragItems.map((item) => item.card.id),
          causalDependencies: causalDependenciesFromTokens(tokens),
          source: {
            kind: "data_source",
            dataSourceId: sourceData.dataSourceId,
          },
          target: boundary.hostPageId
            ? { kind: "page", pageId: boundary.hostPageId, ...target }
            : {
                kind: "document",
                documentId: boundary.documentId,
                ...target,
              },
          promotionPolicy: "literal",
        }))
        .then((result) => {
          if (!result.ok) boundary.reportError(result.error.message);
        })
        .catch((error: unknown) => reportFailure(error, "Block transfer failed"));
    },
  });

  const unregisterManagedDropTarget = registerLocalBlockDragDropTarget({
    surfaceId: boundary.surfaceId,
    element: container,
    deactivate: clear,
  });

  const resolveManagedSession = (event: DragEvent) => {
    const session = resolveLocalBlockDragSession(event.dataTransfer);
    if (!session) return null;
    if (
      !claimLocalBlockDragDropTarget({
        surfaceId: boundary.surfaceId,
        event,
      })
    ) {
      return null;
    }
    if (
      session.sourceSurfaceId === boundary.surfaceId
      && !containsCanvasBlockDrag(session.payload)
    ) {
      return null;
    }
    return session;
  };
  const canTransferPayload = (
    payload: CrossSurfaceBlockTransferPayload,
  ): boolean => {
    if (
      payload.projectId !== boundary.projectId ||
      payload.storeEpoch !== boundary.storeEpoch
    ) {
      return false;
    }
    if (containsDatabaseBlockDrag(payload)) return false;
    const forbidden = new Set(boundary.ancestorPageIds);
    if (boundary.hostPageId) forbidden.add(boundary.hostPageId);
    return payload.rootBlockIds.every((blockId) => !forbidden.has(blockId));
  };
  const claimManagedEvent = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onNativeDragOver = (event: DragEvent) => {
    const session = resolveManagedSession(event);
    if (!session) return;
    claimManagedEvent(event);

    if (
      (session.payload.source.kind === "page" &&
        session.payload.source.pageId === boundary.hostPageId) ||
      (session.payload.source.kind === "document" &&
        session.payload.source.documentId === boundary.documentId)
    ) {
      if (!containsCanvasBlockDrag(session.payload)) {
        event.dataTransfer!.dropEffect = "none";
        clear();
        return;
      }
    }
    if (containsDatabaseBlockDrag(session.payload)) {
      event.dataTransfer!.dropEffect = "none";
      clear();
      return;
    }
    if (
      containsCanvasBlockDrag(session.payload)
      && (
        !isSingleCanvasBlockDrag(session.payload)
        || session.payload.source.kind !== "page"
        || !boundary.hostPageId
        || !boundary.transferCanvas
      )
    ) {
      event.dataTransfer!.dropEffect = "none";
      clear();
      return;
    }
    if (!canTransferPayload(session.payload)) {
      event.dataTransfer!.dropEffect = "none";
      clear();
      return;
    }

    const mode = resolveCrossSurfaceTransferMode(event);
    event.dataTransfer!.dropEffect = mode;
    updateIndicator(event.clientX, event.clientY, event.altKey);
  };
  const onNativeDragLeave = (event: DragEvent) => {
    if (!resolveLocalBlockDragSession(event.dataTransfer)) return;
    const next = event.relatedTarget;
    if (next instanceof Node && container.contains(next)) return;
    releaseLocalBlockDragDropTarget(boundary.surfaceId);
    clear();
  };
  const onNativeDrop = (event: DragEvent) => {
    const managedSession = resolveManagedSession(event);
    if (!managedSession) return;
    claimManagedEvent(event);
    clear();
    const session = resolveLocalBlockDragDropSession(event.dataTransfer);
    if (!session || session.sessionId !== managedSession.sessionId) return;
    endLocalBlockDragSession({ sessionId: session.sessionId });

    if (containsDatabaseBlockDrag(session.payload)) {
      boundary.reportError(
        "Database blocks can only move through a typed Database action.",
      );
      return;
    }
    if (
      (session.payload.source.kind === "page" &&
        session.payload.source.pageId === boundary.hostPageId) ||
      (session.payload.source.kind === "document" &&
        session.payload.source.documentId === boundary.documentId)
    ) {
      if (!containsCanvasBlockDrag(session.payload)) {
        boundary.reportError(
          "This Block is already in the same collaborative Document.",
        );
        return;
      }
    }
    if (!canTransferPayload(session.payload)) {
      boundary.reportError(
        "Block transfer belongs to another Project, store generation, or recursive Page boundary.",
      );
      return;
    }

    const anchor = resolveAnchor(container, event.clientX, event.clientY);
    const target = resolveBlockTransferDocumentTarget(editor, anchor);
    if (containsCanvasBlockDrag(session.payload)) {
      if (
        !isSingleCanvasBlockDrag(session.payload)
        || session.payload.source.kind !== "page"
        || !boundary.hostPageId
        || !boundary.transferCanvas
      ) {
        boundary.reportError("Move or copy one Canvas at a time.");
        return;
      }
      if (session.payload.source.kind !== "page") {
        boundary.reportError("Canvas transfer source must be a Page.");
        return;
      }
      const sourcePageId = session.payload.source.pageId;
      if (!sourcePageId) {
        boundary.reportError("Canvas transfer source Page is missing.");
        return;
      }
      const targetPageId = boundary.hostPageId;
      if (!targetPageId) {
        boundary.reportError("Canvas transfer target Page is missing.");
        return;
      }
      const mode = resolveCrossSurfaceTransferMode(event);
      const canvasBlockId = session.payload.rootBlockIds[0]!;
      if (mode === "move" && target.beforeBlockId === canvasBlockId) return;
      void prepareStructuralMutation(session.sourceSurfaceId)
        .then(() => boundary.transferCanvas?.({
          canvasBlockId,
          sourceSurfaceId: session.sourceSurfaceId,
          sourcePageId,
          targetPageId,
          mode,
          insertion: resolveCanvasDropInsertion(target),
        }))
        .then(() => undefined)
        .catch((error: unknown) => reportFailure(error, "Canvas move failed"));
      return;
    }
    void prepareStructuralMutation(session.sourceSurfaceId)
      .then((tokens) => boundary.transfer({
        operationId: boundary.createOperationId(),
        projectId: boundary.projectId,
        storeEpoch: boundary.storeEpoch,
        mode: resolveCrossSurfaceTransferMode(event),
        rootBlockIds: session.payload.rootBlockIds,
        causalDependencies: causalDependenciesFromTokens(tokens),
        source: session.payload.source,
        target: boundary.hostPageId
          ? { kind: "page", pageId: boundary.hostPageId, ...target }
          : {
              kind: "document",
              documentId: boundary.documentId,
              ...target,
            },
        promotionPolicy: "literal",
      }))
      .then((result) => {
        if (!result.ok) boundary.reportError(result.error.message);
      })
      .catch((error: unknown) => reportFailure(error, "Block transfer failed"));
  };

  container.addEventListener("dragenter", onNativeDragOver, true);
  container.addEventListener("dragover", onNativeDragOver, true);
  container.addEventListener("dragleave", onNativeDragLeave, true);
  container.addEventListener("drop", onNativeDrop, true);

  return () => {
    clear();
    pragmaticCleanup();
    container.removeEventListener("dragenter", onNativeDragOver, true);
    container.removeEventListener("dragover", onNativeDragOver, true);
    container.removeEventListener("dragleave", onNativeDragLeave, true);
    container.removeEventListener("drop", onNativeDrop, true);
    unregisterManagedDropTarget();
  };
};
