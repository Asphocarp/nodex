export type VerticalArrowDirection = "up" | "down";

export interface EmbeddedSurfaceBlock {
  readonly id: string;
  readonly type: string;
  readonly children?: readonly EmbeddedSurfaceBlock[];
}

interface EmbeddedSurfaceSelection {
  readonly empty: boolean;
  readonly node?: unknown;
}

export interface EmbeddedSurfaceHostEditor {
  readonly document: readonly EmbeddedSurfaceBlock[];
  readonly prosemirrorView?: {
    readonly state: {
      readonly selection: EmbeddedSurfaceSelection;
    };
    readonly dom: HTMLElement;
    endOfTextblock(direction: VerticalArrowDirection): boolean;
  };
  getTextCursorPosition(): {
    readonly block: {
      readonly id: string;
      readonly type: string;
    };
  };
  setTextCursorPosition(targetBlock: string, placement?: "start" | "end"): void;
  focus(): void;
}

export interface EmbeddedSurfaceBoundaryHandle {
  focusBoundary(direction: VerticalArrowDirection): boolean;
}

type BlockDisclosurePredicate = (blockId: string) => boolean;

const handlesByEditor = new WeakMap<object, Map<string, EmbeddedSurfaceBoundaryHandle>>();

const escapeSelector = (value: string): string =>
  globalThis.CSS?.escape?.(value) ?? value.replace(/["\\]/g, "\\$&");

const directionPlacement = (direction: VerticalArrowDirection): "start" | "end" =>
  direction === "down" ? "start" : "end";

function getRegisteredHandle(
  editor: object,
  shellBlockId: string,
): EmbeddedSurfaceBoundaryHandle | null {
  if (!shellBlockId) return null;
  return handlesByEditor.get(editor)?.get(shellBlockId) ?? null;
}

function isNodeSelection(selection: EmbeddedSurfaceSelection): boolean {
  return !selection.empty && selection.node !== undefined;
}

function isBlockExpandedInEditor(editor: EmbeddedSurfaceHostEditor, blockId: string): boolean {
  const blockElement = editor.prosemirrorView?.dom.querySelector<HTMLElement>(
    `.bn-block[data-id="${escapeSelector(blockId)}"]`,
  );
  if (!blockElement) return true;

  const toggle = blockElement.querySelector<HTMLElement>(
    ":scope > .bn-block-content .bn-toggle-wrapper",
  );
  return toggle?.getAttribute("data-show-children") !== "false";
}

export function flattenVisibleBlocks(
  blocks: readonly EmbeddedSurfaceBlock[],
  isBlockExpanded: BlockDisclosurePredicate,
): readonly EmbeddedSurfaceBlock[] {
  const visible: EmbeddedSurfaceBlock[] = [];

  const visit = (block: EmbeddedSurfaceBlock): void => {
    visible.push(block);
    if (!block.children || block.children.length === 0) return;
    if (!isBlockExpanded(block.id)) return;
    block.children.forEach(visit);
  };

  blocks.forEach(visit);
  return visible;
}

export function findVisibleNeighborBlock(
  blocks: readonly EmbeddedSurfaceBlock[],
  blockId: string,
  direction: VerticalArrowDirection,
  isBlockExpanded: BlockDisclosurePredicate,
): EmbeddedSurfaceBlock | null {
  if (!blockId) return null;
  const visible = flattenVisibleBlocks(blocks, isBlockExpanded);
  const currentIndex = visible.findIndex((block) => block.id === blockId);
  if (currentIndex === -1) return null;
  const neighborIndex = direction === "down" ? currentIndex + 1 : currentIndex - 1;
  return visible[neighborIndex] ?? null;
}

function visibleBlocksForEditor(
  editor: EmbeddedSurfaceHostEditor,
): readonly EmbeddedSurfaceBlock[] {
  return flattenVisibleBlocks(editor.document, (blockId) =>
    isBlockExpandedInEditor(editor, blockId),
  );
}

function focusRegisteredNeighbor(
  editor: EmbeddedSurfaceHostEditor,
  blockId: string,
  direction: VerticalArrowDirection,
): boolean {
  const handle = getRegisteredHandle(editor, blockId);
  if (!handle?.focusBoundary(direction)) return false;
  editor.setTextCursorPosition(blockId, directionPlacement(direction));
  return true;
}

export function registerEmbeddedSurfaceBoundaryHandle(
  editor: object,
  shellBlockId: string,
  handle: EmbeddedSurfaceBoundaryHandle,
): () => void {
  if (!shellBlockId) return () => undefined;

  const existing = handlesByEditor.get(editor);
  const handles = existing ?? new Map<string, EmbeddedSurfaceBoundaryHandle>();
  if (!existing) handlesByEditor.set(editor, handles);
  handles.set(shellBlockId, handle);

  return () => {
    const currentHandles = handlesByEditor.get(editor);
    if (currentHandles?.get(shellBlockId) !== handle) return;
    currentHandles.delete(shellBlockId);
    if (currentHandles.size === 0) handlesByEditor.delete(editor);
  };
}

export function focusRegisteredEmbeddedSurfaceBoundary(
  editor: object,
  shellBlockId: string,
  direction: VerticalArrowDirection,
): boolean {
  return getRegisteredHandle(editor, shellBlockId)?.focusBoundary(direction) ?? false;
}

export function handleArrowIntoEmbeddedSurface(
  editor: EmbeddedSurfaceHostEditor,
  direction: VerticalArrowDirection,
): boolean {
  const view = editor.prosemirrorView;
  if (!view) return false;

  const selection = view.state.selection;
  const currentBlockId = editor.getTextCursorPosition().block.id;
  if (isNodeSelection(selection)) {
    return focusRegisteredEmbeddedSurfaceBoundary(editor, currentBlockId, direction);
  }

  if (!selection.empty || !view.endOfTextblock(direction)) return false;
  const neighbor = findVisibleNeighborBlock(editor.document, currentBlockId, direction, (blockId) =>
    isBlockExpandedInEditor(editor, blockId),
  );
  if (!neighbor) return false;
  return focusRegisteredNeighbor(editor, neighbor.id, direction);
}

export function moveFromEmbeddedSurfaceToHostNeighbor(
  editor: EmbeddedSurfaceHostEditor,
  shellBlockId: string,
  direction: VerticalArrowDirection,
): boolean {
  const neighbor = findVisibleNeighborBlock(editor.document, shellBlockId, direction, (blockId) =>
    isBlockExpandedInEditor(editor, blockId),
  );
  if (!neighbor) return false;
  if (focusRegisteredNeighbor(editor, neighbor.id, direction)) return true;

  editor.setTextCursorPosition(neighbor.id, directionPlacement(direction));
  editor.focus();
  return true;
}

export function focusEmbeddedEditorBoundary(
  editor: EmbeddedSurfaceHostEditor,
  direction: VerticalArrowDirection,
): boolean {
  const visible = visibleBlocksForEditor(editor);
  const boundary = direction === "down" ? visible[0] : visible.at(-1);
  if (!boundary) return false;
  if (focusRegisteredNeighbor(editor, boundary.id, direction)) return true;

  editor.setTextCursorPosition(boundary.id, directionPlacement(direction));
  editor.focus();
  return true;
}

export function isEditorAtVisibleBoundary(
  editor: EmbeddedSurfaceHostEditor,
  direction: VerticalArrowDirection,
): boolean {
  const view = editor.prosemirrorView;
  if (!view?.state.selection.empty) return false;
  if (!view.endOfTextblock(direction)) return false;

  const visible = visibleBlocksForEditor(editor);
  const boundary = direction === "down" ? visible.at(-1) : visible[0];
  return boundary?.id === editor.getTextCursorPosition().block.id;
}

export function selectEmbeddedSurfaceShell(
  editor: EmbeddedSurfaceHostEditor,
  shellBlockId: string,
): boolean {
  if (!shellBlockId) return false;
  editor.setTextCursorPosition(shellBlockId, "start");
  editor.focus();
  return true;
}
