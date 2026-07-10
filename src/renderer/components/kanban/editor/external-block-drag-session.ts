import {
  discardCrossWindowDrag,
  endCrossWindowDragSource,
  isElectronCrossWindowDragAvailable,
  startCrossWindowDrag,
  subscribeCrossWindowDragResult,
} from "@/lib/cross-window-drag";
import type {
  BlockDropImportSourceUpdate,
  CardCreateInput,
} from "@/lib/types";
import {
  CROSS_WINDOW_DRAG_TOKEN_VERSION,
  type DragTransferOperation,
} from "../../../../shared/cross-window-drag";

export interface DragSessionBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: DragSessionBlock[];
}

export interface EditorForExternalBlockDrop {
  document: DragSessionBlock[];
  prosemirrorView?: {
    state: {
      selection: object;
    };
  };
  getSelection?: () => { blocks: Array<{ id: string }> } | undefined;
  getBlock: (id: string) => DragSessionBlock | undefined;
  getParentBlock: (id: string) => DragSessionBlock | undefined;
  removeBlocks: (ids: string[]) => void;
  replaceBlocks: (toRemove: unknown[], replacements: unknown[]) => void;
  transact?: <T>(fn: () => T) => T;
}

export interface ExternalDropAdapter {
  buildSourceUpdates: (
    sourceDocument: DragSessionBlock[],
    projectedDocument: DragSessionBlock[],
    container: HTMLElement,
  ) => BlockDropImportSourceUpdate[];
  beginPreparedMutation?: () => (
    result: DragTransferOperation | "cancel",
    sourceUpdates: BlockDropImportSourceUpdate[],
  ) => void;
  removeLiveBlocks?: (
    editor: EditorForExternalBlockDrop,
    blockIds: string[],
  ) => void;
}

export interface ExternalEditorDragSession {
  id: string;
  editor: EditorForExternalBlockDrop;
  container: HTMLElement;
  draggedBlockIds: string[];
  cards: CardCreateInput[];
  sourceUpdates: BlockDropImportSourceUpdate[];
  groupId: string;
  state: "dragging" | "claimed";
  releasePreparedMutation: ((
    result: DragTransferOperation | "cancel",
    sourceUpdates: BlockDropImportSourceUpdate[],
  ) => void) | null;
  removeLiveBlocks: ExternalDropAdapter["removeLiveBlocks"];
}

let activeSession: ExternalEditorDragSession | null = null;
let sourceResultSubscriptionInitialized = false;

function cloneDocument(document: DragSessionBlock[]): DragSessionBlock[] {
  if (typeof structuredClone === "function") {
    return structuredClone(document) as DragSessionBlock[];
  }
  return JSON.parse(JSON.stringify(document)) as DragSessionBlock[];
}

export function projectDocumentWithoutBlocks(
  document: DragSessionBlock[],
  blockIds: readonly string[],
): DragSessionBlock[] {
  const removedIds = new Set(blockIds);
  const project = (blocks: DragSessionBlock[]): DragSessionBlock[] => blocks.flatMap((block) => {
    if (removedIds.has(block.id)) return [];
    const children = Array.isArray(block.children) ? project(block.children) : block.children;
    return [{ ...block, ...(children ? { children } : {}) }];
  });
  return project(cloneDocument(document));
}

function ensureSourceResultSubscription(): void {
  if (sourceResultSubscriptionInitialized) return;
  sourceResultSubscriptionInitialized = true;
  subscribeCrossWindowDragResult((result) => {
    completeExternalEditorDragSession(result.sessionId, result.result);
  });
}

export function startExternalEditorDragSession(
  editor: EditorForExternalBlockDrop,
  container: HTMLElement,
  adapter: ExternalDropAdapter,
  draggedBlockIds: string[],
  cards: CardCreateInput[],
): ExternalEditorDragSession | null {
  if (draggedBlockIds.length === 0 || cards.length === 0) return null;
  endExternalEditorDragSession();

  const id = crypto.randomUUID();
  const sourceDocument = cloneDocument(editor.document);
  const projectedDocument = projectDocumentWithoutBlocks(sourceDocument, draggedBlockIds);
  const sourceUpdates = adapter.buildSourceUpdates(
    sourceDocument,
    projectedDocument,
    container,
  );
  const releasePreparedMutation = adapter.beginPreparedMutation?.() ?? null;
  activeSession = {
    id,
    editor,
    container,
    draggedBlockIds: [...draggedBlockIds],
    cards,
    sourceUpdates,
    groupId: crypto.randomUUID(),
    state: "dragging",
    releasePreparedMutation,
    removeLiveBlocks: adapter.removeLiveBlocks,
  };
  ensureSourceResultSubscription();
  void startCrossWindowDrag({
    version: CROSS_WINDOW_DRAG_TOKEN_VERSION,
    sessionId: id,
    kind: "blocks",
    payload: {
      cards,
      sourceUpdates,
      groupId: activeSession.groupId,
    },
  });
  return activeSession;
}

export function getActiveExternalEditorDragSession(): ExternalEditorDragSession | null {
  return activeSession;
}

export function endExternalEditorDragSession(sessionId?: string): void {
  if (!activeSession) return;
  if (sessionId && activeSession.id !== sessionId) return;
  const session = activeSession;
  activeSession = null;
  session.releasePreparedMutation?.("cancel", session.sourceUpdates);
}

export function claimExternalEditorDragSession(sessionId: string): ExternalEditorDragSession | null {
  if (!activeSession || activeSession.id !== sessionId) return null;
  if (activeSession.state !== "dragging") return null;
  activeSession.state = "claimed";
  return activeSession;
}

export function completeExternalEditorDragSession(
  sessionId: string,
  result: DragTransferOperation | "cancel",
): void {
  if (!activeSession || activeSession.id !== sessionId) return;
  const session = activeSession;
  activeSession = null;

  try {
    if (result === "move") {
      if (session.removeLiveBlocks) {
        session.removeLiveBlocks(session.editor, session.draggedBlockIds);
      } else {
        runInEditorTransaction(session.editor, () => {
          session.editor.removeBlocks(session.draggedBlockIds);
        });
      }
    }
  } finally {
    session.releasePreparedMutation?.(result, session.sourceUpdates);
  }
}

export function notifyExternalEditorDragEnded(sessionId: string): void {
  if (!activeSession || activeSession.id !== sessionId) return;
  if (activeSession.state === "claimed") return;
  if (!isElectronCrossWindowDragAvailable()) {
    completeExternalEditorDragSession(sessionId, "cancel");
    return;
  }
  void endCrossWindowDragSource(sessionId).then((retained) => {
    if (!retained) completeExternalEditorDragSession(sessionId, "cancel");
  });
}

export function discardExternalEditorDragSession(
  sessionId: string,
  result: DragTransferOperation | "cancel",
): void {
  completeExternalEditorDragSession(sessionId, result);
  void discardCrossWindowDrag(sessionId);
}

export function runInEditorTransaction<T>(
  editor: EditorForExternalBlockDrop,
  fn: () => T,
): T {
  if (!editor.transact) return fn();
  return editor.transact(fn);
}

export function snapshotEditorDocument(
  editor: EditorForExternalBlockDrop,
): DragSessionBlock[] {
  return cloneDocument(editor.document);
}

export function restoreEditorDocument(
  editor: EditorForExternalBlockDrop,
  snapshot: DragSessionBlock[],
): void {
  editor.replaceBlocks(editor.document, snapshot);
}
