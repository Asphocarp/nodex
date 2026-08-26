import { DOMParser, Slice } from "@tiptap/pm/model";
import {
  EditorState,
  Plugin,
  PluginKey,
  PluginView,
  TextSelection,
} from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

import { Block } from "../../blocks/defaultBlocks.js";
import type { BlockNoteEditor } from "../../editor/BlockNoteEditor.js";
import {
  createExtension,
  createStore,
} from "../../editor/BlockNoteExtension.js";
import { UiElementPosition } from "../../extensions-shared/UiElementPosition.js";
import {
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from "../../schema/index.js";
import { getDraggableBlockFromElement } from "../getDraggableBlockFromElement.js";
import {
  dragStart,
  type SideMenuBlockDragStartEvent,
  type SideMenuBlockDragStartResult,
  unsetDragImage,
} from "./dragging.js";
import {
  createSideMenuDroppedBlockSelection,
  getSideMenuDroppedBlockIdsFromSelection,
  getSideMenuDroppedBlockIdsFromSlice,
} from "./dropSelection.js";

export type SideMenuState<
  BSchema extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
> = UiElementPosition & {
  // The block that the side menu is attached to.
  block: Block<BSchema, I, S>;
};

const DISTANCE_TO_CONSIDER_EDITOR_BOUNDS = 250;

type SideMenuEditorCandidate = {
  element: Element;
  distance: number;
};

function getComposedParentElement(element: Element) {
  if (element.assignedSlot) {
    return element.assignedSlot;
  }
  if (element.parentElement) {
    return element.parentElement;
  }

  const view = element.ownerDocument.defaultView;
  const root = element.getRootNode();
  return view && root instanceof view.ShadowRoot ? root.host : null;
}

function isSideMenuEditorInteractionCandidate(editor: Element) {
  const blockGroup = editor.querySelector(".bn-block-group");
  if (!blockGroup) {
    return false;
  }

  for (
    let current: Element | null = blockGroup;
    current;
    current = getComposedParentElement(current)
  ) {
    if (current.hasAttribute("inert")) {
      return false;
    }
  }

  const view = editor.ownerDocument.defaultView;
  if (!view) {
    return true;
  }

  const style = view.getComputedStyle(blockGroup);
  if (
    style.pointerEvents === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse"
  ) {
    return false;
  }

  if (typeof blockGroup.checkVisibility === "function") {
    return blockGroup.checkVisibility({
      contentVisibilityAuto: true,
      visibilityProperty: true,
    });
  }

  for (
    let current: Element | null = blockGroup;
    current;
    current = getComposedParentElement(current)
  ) {
    const currentStyle = view.getComputedStyle(current);
    if (
      currentStyle.display === "none" ||
      currentStyle.contentVisibility === "hidden"
    ) {
      return false;
    }
  }

  return true;
}

function getDistanceFromRect(
  coords: { clientX: number; clientY: number },
  rect: DOMRect,
) {
  const distanceX =
    coords.clientX < rect.left
      ? rect.left - coords.clientX
      : coords.clientX > rect.right
        ? coords.clientX - rect.right
        : 0;
  const distanceY =
    coords.clientY < rect.top
      ? rect.top - coords.clientY
      : coords.clientY > rect.bottom
        ? coords.clientY - rect.bottom
        : 0;

  return Math.hypot(distanceX, distanceY);
}

function getSideMenuEditorCandidates(
  root: Document | ShadowRoot,
  coords: { clientX: number; clientY: number },
) {
  return Array.from(root.querySelectorAll(".bn-editor")).flatMap(
    (element): SideMenuEditorCandidate[] => {
      if (!isSideMenuEditorInteractionCandidate(element)) {
        return [];
      }

      const blockGroup = element.querySelector(".bn-block-group")!;

      return [
        {
          element,
          distance: getDistanceFromRect(
            coords,
            blockGroup.getBoundingClientRect(),
          ),
        },
      ];
    },
  );
}

function getHitTestedSideMenuEditor(
  root: Document | ShadowRoot,
  coords: { clientX: number; clientY: number },
  candidates: SideMenuEditorCandidate[],
) {
  if (typeof root.elementsFromPoint !== "function") {
    return undefined;
  }

  const candidatesByElement = new Map(
    candidates.map((candidate) => [candidate.element, candidate]),
  );

  for (const element of root.elementsFromPoint(
    coords.clientX,
    coords.clientY,
  )) {
    const editor = element.closest(".bn-editor");
    if (!editor) {
      continue;
    }

    const candidate = candidatesByElement.get(editor);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function getBlockFromCoords(
  view: EditorView,
  coords: { left: number; top: number },
  adjustForColumns = true,
) {
  const elements = view.root.elementsFromPoint(coords.left, coords.top);

  for (const element of elements) {
    if (!view.dom.contains(element)) {
      // probably a ui overlay like formatting toolbar etc
      continue;
    }
    if (adjustForColumns) {
      const column = element.closest("[data-node-type=columnList]");
      if (column) {
        return getBlockFromCoords(
          view,
          {
            // TODO can we do better than this?
            left: coords.left + 50, // bit hacky, but if we're inside a column, offset x position to right to account for the width of sidemenu itself
            top: coords.top,
          },
          false,
        );
      }
    }
    return getDraggableBlockFromElement(element, view);
  }
  return undefined;
}

function getBlockFromMousePos(
  mousePos: {
    x: number;
    y: number;
  },
  view: EditorView,
): { node: HTMLElement; id: string } | undefined {
  // Editor itself may have padding or other styling which affects
  // size/position, so we get the boundingRect of the first child (i.e. the
  // blockGroup that wraps all blocks in the editor) for more accurate side
  // menu placement.
  if (!view.dom.firstChild) {
    return;
  }

  const editorBoundingBox = (
    view.dom.firstChild as HTMLElement
  ).getBoundingClientRect();

  // Gets block at mouse cursor's position.
  const coords = {
    // Clamps the x position to the editor's bounding box.
    left: Math.min(
      Math.max(editorBoundingBox.left + 10, mousePos.x),
      editorBoundingBox.right - 10,
    ),
    top: mousePos.y,
  };

  const referenceBlock = getBlockFromCoords(view, coords);

  if (!referenceBlock) {
    // could not find the reference block
    return undefined;
  }

  /**
   * Because blocks may be nested, we need to check the right edge of the parent block:
   * ```
   * | BlockA        |
   * x | BlockB     y|
   * ```
   * Hovering at position x (left edge of BlockB) would return BlockA.
   * Instead, we check at position y (right edge of BlockA) to correctly identify BlockB.
   */
  const referenceBlocksBoundingBox =
    referenceBlock.node.getBoundingClientRect();
  return getBlockFromCoords(
    view,
    {
      left: referenceBlocksBoundingBox.right - 10,
      top: mousePos.y,
    },
    false,
  );
}

function eventTargetsEditorContent(event: Event, editorElement: Element) {
  const path = event.composedPath();
  if (path.length > 0) {
    return path.includes(editorElement);
  }
  return event.target instanceof Node && editorElement.contains(event.target);
}

/**
 * With the sidemenu plugin we can position a menu next to a hovered block.
 */
export class SideMenuView<
  BSchema extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
> implements PluginView {
  public state?: SideMenuState<BSchema, I, S>;
  public readonly emitUpdate: (state: SideMenuState<BSchema, I, S>) => void;

  private mousePos: { x: number; y: number } | undefined;

  private mousePositionOwnedByEditor = false;

  private hoveredBlock: HTMLElement | undefined;

  public menuFrozen = false;

  public isDragOrigin = false;

  private draggedBlockIdsForDropSelection: string[] = [];

  constructor(
    private readonly editor: BlockNoteEditor<BSchema, I, S>,
    private readonly pmView: EditorView,
    emitUpdate: (state: SideMenuState<BSchema, I, S>) => void,
    private readonly clearState: () => void,
    private readonly setPendingDroppedBlockIdsForSelection: (
      blockIds: string[],
    ) => void,
    private readonly isExternalDragManaged: (event: DragEvent) => boolean =
      () => false,
  ) {
    this.emitUpdate = () => {
      if (!this.state) {
        throw new Error("Attempting to update uninitialized side menu");
      }

      emitUpdate(this.state);
    };

    this.pmView.root.addEventListener(
      "dragstart",
      this.onDragStart as EventListener,
    );
    this.pmView.root.addEventListener(
      "dragover",
      this.onDragOver as EventListener,
    );
    this.pmView.root.addEventListener(
      "drop",
      this.onDrop as EventListener,
      true,
    );
    this.pmView.root.addEventListener(
      "dragend",
      this.onDragEnd as EventListener,
      true,
    );

    // Shows or updates menu position whenever the cursor moves, if the menu isn't frozen.
    this.pmView.root.addEventListener(
      "mousemove",
      this.onMouseMove as EventListener,
      true,
    );

    // Hides and unfreezes the menu whenever the user presses a key.
    this.pmView.root.addEventListener(
      "keydown",
      this.onKeyDown as EventListener,
      true,
    );
  }

  setDraggedBlockIdsForDropSelection(blockIds: string[]) {
    this.draggedBlockIdsForDropSelection = Array.from(new Set(blockIds));
  }

  private getDraggedBlockIdsForDropSelection() {
    return this.draggedBlockIdsForDropSelection.length > 0
      ? this.draggedBlockIdsForDropSelection
      : this.pmView.dragging
        ? getSideMenuDroppedBlockIdsFromSlice(this.pmView.dragging.slice)
        : [];
  }

  updateState = (state: SideMenuState<BSchema, I, S>) => {
    this.state = state;
    this.emitUpdate(this.state);
  };

  private hideMenu = () => {
    if (!this.state?.show) {
      return;
    }

    this.state.show = false;
    this.updateState(this.state);
  };

  updateStateFromMousePos = (
    editorIsInteractive = isSideMenuEditorInteractionCandidate(this.pmView.dom),
  ) => {
    if (!editorIsInteractive) {
      this.menuFrozen = false;
      this.hideMenu();
      return;
    }
    if (this.menuFrozen || !this.mousePos) {
      return;
    }

    const closestEditor = this.mousePositionOwnedByEditor
      ? { element: this.pmView.dom, distance: 0 }
      : this.findClosestEditorElement({
          clientX: this.mousePos.x,
          clientY: this.mousePos.y,
        });

    if (
      closestEditor?.element !== this.pmView.dom ||
      closestEditor.distance > DISTANCE_TO_CONSIDER_EDITOR_BOUNDS
    ) {
      this.hideMenu();
      return;
    }

    const block = getBlockFromMousePos(this.mousePos, this.pmView);

    // Closes the menu if the mouse cursor is beyond the editor vertically.
    if (!block || !this.editor.isEditable) {
      this.hideMenu();

      return;
    }

    // Doesn't update if the menu is already open and the mouse cursor is still hovering the same block.
    if (
      this.state?.show &&
      this.hoveredBlock?.hasAttribute("data-id") &&
      this.hoveredBlock?.getAttribute("data-id") === block.id
    ) {
      return;
    }

    this.hoveredBlock = block.node;

    // Shows or updates elements.
    if (this.editor.isEditable) {
      const blockContentBoundingBox = block.node.getBoundingClientRect();
      const column = block.node.closest("[data-node-type=column]");
      const sideMenuBlock = this.editor.getBlock(
        this.hoveredBlock!.getAttribute("data-id")!,
      );
      if (!sideMenuBlock) {
        if (this.state?.show) {
          this.state.show = false;
          this.hoveredBlock = undefined;
          this.emitUpdate(this.state);
        }
        return;
      }
      this.state = {
        show: true,
        referencePos: new DOMRect(
          column
            ? // We take the first child as column elements have some default
              // padding. This is a little weird since this child element will
              // be the first block, but since it's always non-nested and we
              // only take the x coordinate, it's ok.
              column.firstElementChild!.getBoundingClientRect().x
            : (
                this.pmView.dom.firstChild as HTMLElement
              ).getBoundingClientRect().x,
          blockContentBoundingBox.y,
          blockContentBoundingBox.width,
          blockContentBoundingBox.height,
        ),
        block: sideMenuBlock,
      };
      this.updateState(this.state);
    }
  };

  /**
   * If a block is being dragged, ProseMirror usually gets the context of what's
   * being dragged from `view.dragging`, which is automatically set when a
   * `dragstart` event fires in the editor. However, if the user tries to drag
   * and drop blocks between multiple editors, only the one in which the drag
   * began has that context, so we need to set it on the others manually. This
   * ensures that PM always drops the blocks in between other blocks, and not
   * inside them.
   *
   * After the `dragstart` event fires on the drag handle, it sets
   * `blocknote/html` data on the clipboard. This handler fires right after,
   * parsing the `blocknote/html` data into nodes and setting them on
   * `view.dragging`.
   *
   * Note: Setting `view.dragging` on `dragover` would be better as the user
   * could then drag between editors in different windows, but you can only
   * access `dataTransfer` contents on `dragstart` and `drop` events.
   */
  onDragStart = (event: DragEvent) => {
    if (this.isExternalDragManaged(event)) return;
    const html = event.dataTransfer?.getData("blocknote/html");
    if (!html) {
      return;
    }

    if (this.pmView.dragging) {
      this.setDraggedBlockIdsForDropSelection(
        getSideMenuDroppedBlockIdsFromSlice(this.pmView.dragging.slice),
      );
      // already dragging, so no-op
      return;
    }

    const element = document.createElement("div");
    element.innerHTML = html;

    const parser = DOMParser.fromSchema(this.pmView.state.schema);
    const node = parser.parse(element, {
      topNode: this.pmView.state.schema.nodes["blockGroup"].create(),
    });

    this.pmView.dragging = {
      slice: new Slice(node.content, 0, 0),
      move: true,
    };
    this.setDraggedBlockIdsForDropSelection(
      getSideMenuDroppedBlockIdsFromSlice(this.pmView.dragging.slice),
    );
  };

  /**
   * Finds the closest editor visually to the given coordinates
   */
  private findClosestEditorElement = (coords: {
    clientX: number;
    clientY: number;
  }) => {
    const candidates = getSideMenuEditorCandidates(this.pmView.root, coords);
    if (candidates.length === 0) {
      return null;
    }

    const closestEditor = candidates.reduce((closest, candidate) =>
      candidate.distance < closest.distance ? candidate : closest,
    );
    const equallyCloseEditors = candidates.filter(
      (candidate) => candidate.distance === closestEditor.distance,
    );
    if (equallyCloseEditors.length === 1) {
      return closestEditor;
    }

    return (
      getHitTestedSideMenuEditor(
        this.pmView.root,
        coords,
        equallyCloseEditors,
      ) ?? closestEditor
    );
  };

  /**
   * This dragover event handler listens at the document level,
   * and is trying to handle dragover events for all editors.
   *
   * It specifically is trying to handle the following cases:
   *  - If the dragover event is within the bounds of any editor, then it does nothing
   *  - If the dragover event is outside the bounds of any editor, but close enough (within DISTANCE_TO_CONSIDER_EDITOR_BOUNDS) to the closest editor,
   *    then it dispatches a synthetic dragover event to the closest editor (which will trigger the drop-cursor to be shown on that editor)
   *  - If the dragover event is outside the bounds of the current editor, then it will dispatch a synthetic dragleave event to the current editor
   *    (which will trigger the drop-cursor to be removed from the current editor)
   *
   * The synthetic event is a necessary evil because we do not control prosemirror-dropcursor to be able to show the drop-cursor within the range we want
   */
  onDragOver = (event: DragEvent) => {
    if ((event as any).synthetic) {
      return;
    }
    if (this.isExternalDragManaged(event)) {
      this.closeDropCursor();
      return;
    }

    // Relevance gate: Only handle drags that belong to BlockNote
    // This prevents interference with external drag-and-drop libraries
    // by avoiding calls to closeDropCursor() for non-BlockNote drags
    const isBlockNoteDrag =
      this.pmView.dragging !== null ||
      this.isDragOrigin ||
      event.dataTransfer?.types.includes("blocknote/html") ||
      (event.target instanceof Node && this.pmView.dom.contains(event.target));

    if (!isBlockNoteDrag) {
      // Not a BlockNote-related drag, return early without any processing
      return;
    }

    const dragEventContext = this.getDragEventContext(event);

    if (!dragEventContext || !dragEventContext.isDropPoint) {
      // This is not a drag event that we are interested in
      // so, we close the drop-cursor
      this.closeDropCursor();
      return;
    }

    if (
      dragEventContext.isDropPoint &&
      !dragEventContext.isDropWithinEditorBounds
    ) {
      // we are the drop point, but the drag over event is not within the bounds of this editor instance
      // so, we need to dispatch an event that is in the bounds of this editor instance
      this.dispatchSyntheticEvent(event);
    }
  };

  /**
   * Closes the drop-cursor for the current editor
   */
  private closeDropCursor = () => {
    const evt = new Event("dragleave", { bubbles: false });
    // It needs to be synthetic, so we don't accidentally think it is a real dragend event
    (evt as any).synthetic = true;
    // We dispatch the event to the current editor, so that the drop-cursor is removed for it
    this.pmView.dom.dispatchEvent(evt);
  };

  /**
   * It is surprisingly difficult to determine the information we need to know about a drag event
   *
   * This function is trying to determine the following:
   *  - Whether the current editor instance is the drop point
   *  - Whether the current editor instance is the drag origin
   *  - Whether the drop event is within the bounds of the current editor instance
   */
  getDragEventContext = (event: DragEvent) => {
    if (
      !this.isDragOrigin &&
      !isSideMenuEditorInteractionCandidate(this.pmView.dom)
    ) {
      return undefined;
    }

    // Relevance gate: Only handle drags that belong to BlockNote
    // Check if at least one of the following is true:
    // 1. ProseMirror drag started in an editor
    // 2. Side menu drag
    // 3. BlockNote-specific data type in the drag
    // 4. (optional stricter mode) Event target is inside this editor
    const isBlockNoteDrag =
      this.pmView.dragging !== null ||
      this.isDragOrigin ||
      event.dataTransfer?.types.includes("blocknote/html") ||
      (event.target instanceof Node && this.pmView.dom.contains(event.target));

    if (!isBlockNoteDrag) {
      // Not a BlockNote-related drag, return early
      return undefined;
    }

    // We need to check if there is text content that is being dragged (select some text & just drag it)
    const textContentIsBeingDragged =
      !event.dataTransfer?.types.includes("blocknote/html") &&
      !!this.pmView.dragging;
    // This is the side menu drag from this plugin
    const sideMenuIsBeingDragged = !!this.isDragOrigin;
    // Tells us that the current editor instance has a drag ongoing (either text or side menu)
    const isDragOrigin = textContentIsBeingDragged || sideMenuIsBeingDragged;

    const interactionOwnership = this.editor.getInteractionOwnership(event);
    if (interactionOwnership === "other") {
      return isDragOrigin
        ? {
            isDropPoint: false,
            isDropWithinEditorBounds: false,
            isDragOrigin: true,
          }
        : undefined;
    }
    if (
      interactionOwnership === "self" &&
      !eventTargetsEditorContent(event, this.pmView.dom)
    ) {
      return isDragOrigin
        ? {
            isDropPoint: false,
            isDropWithinEditorBounds: false,
            isDragOrigin: true,
          }
        : undefined;
    }

    // Tells us which editor instance is the closest to the drag event (whether or not it is actually reasonably close)
    const closestEditor =
      interactionOwnership === "self"
        ? { element: this.pmView.dom, distance: 0 }
        : this.findClosestEditorElement(event);

    // We arbitrarily decide how far is "too far" from the closest editor to be considered a drop point
    if (
      !closestEditor ||
      closestEditor.distance > DISTANCE_TO_CONSIDER_EDITOR_BOUNDS
    ) {
      // we are too far from the closest editor, or no editor was found
      return undefined;
    }

    // We check if the closest editor is the same as the current editor instance (which is the drop point)
    const isDropPoint = closestEditor.element === this.pmView.dom;
    // We check if the current editor instance is the same as the editor instance that the drag event is happening within
    const isDropWithinEditorBounds =
      isDropPoint && closestEditor.distance === 0;

    // We never want to handle drop events that are not related to us
    if (!isDropPoint && !isDragOrigin) {
      // we are not the drop point or drag origin, so not relevant to us
      return undefined;
    }

    return {
      isDropPoint,
      isDropWithinEditorBounds,
      isDragOrigin,
    };
  };

  /**
   * The drop event handler listens at the document level,
   * and handles drop events for all editors.
   *
   * It specifically handles the following cases:
   *  - If we are both the drag origin and drop point:
   *    - Let normal drop handling take over
   *  - If we are the drop point but not the drag origin:
   *    - Collapse selection to prevent PM from deleting unrelated content
   *    - If drop event is outside our editor bounds, dispatch synthetic drop event to our editor
   *  - If we are the drag origin but not the drop point:
   *    - Delete the dragged content from our editor after a delay
   */
  onDrop = (event: DragEvent) => {
    if ((event as any).synthetic) {
      return;
    }
    if (this.isExternalDragManaged(event)) {
      this.setPendingDroppedBlockIdsForSelection([]);
      this.closeDropCursor();
      return;
    }

    // Relevance gate: Only handle drags that belong to BlockNote
    // This prevents interference with external drag-and-drop libraries
    const isBlockNoteDrag =
      this.pmView.dragging !== null ||
      this.isDragOrigin ||
      event.dataTransfer?.types.includes("blocknote/html") ||
      (event.target instanceof Node && this.pmView.dom.contains(event.target));

    if (!isBlockNoteDrag) {
      // Not a BlockNote-related drag, return early without any processing
      return;
    }

    const context = this.getDragEventContext(event);
    if (!context) {
      this.closeDropCursor();
      // This is not a drag event that we are interested in
      return;
    }
    const { isDropPoint, isDropWithinEditorBounds, isDragOrigin } = context;

    const droppedBlockIdsForSelection =
      isDropPoint && this.pmView.dragging
        ? this.getDraggedBlockIdsForDropSelection()
        : [];
    if (droppedBlockIdsForSelection.length > 0) {
      this.setPendingDroppedBlockIdsForSelection(droppedBlockIdsForSelection);
    }

    if (!isDropWithinEditorBounds && isDropPoint) {
      // Any time that the drop event is outside of the editor bounds (but still close to an editor instance)
      // We dispatch a synthetic event that is in the bounds of the editor instance, to have the correct drop point
      this.dispatchSyntheticEvent(event);
      if (droppedBlockIdsForSelection.length > 0) {
        return;
      }
    }

    if (isDropPoint) {
      // The current instance is the drop point

      if (this.pmView.dragging) {
        // Let PM's normal drop transaction run first, then restore the block
        // selection to the dropped nodes when this is a side-menu block drag.
        return;
      }
      // Because the editor selection is unrelated to the dragged content, we
      // don't want PM to delete its content. Therefore, we collapse the
      // selection.
      this.pmView.dispatch(
        this.pmView.state.tr.setSelection(
          TextSelection.create(
            this.pmView.state.tr.doc,
            this.pmView.state.tr.selection.anchor,
          ),
        ),
      );
      return;
    } else if (isDragOrigin) {
      // The current instance is the drag origin, but not the drop point
      // our content got dropped somewhere else

      // Because the editor from which the block originates doesn't get a drop
      // event on it, PM doesn't delete its selected content. Therefore, we
      // need to do so manually.
      //
      // Note: Deleting the selected content from the editor from which the
      // block originates, may change its height. This can cause the position of
      // the editor in which the block is being dropping to shift, before it
      // can handle the drop event. That in turn can cause the drop to happen
      // somewhere other than the user intended. To get around this, we delay
      // deleting the selected content until all editors have had the chance to
      // handle the event.
      setTimeout(
        () => this.pmView.dispatch(this.pmView.state.tr.deleteSelection()),
        0,
      );
      return;
    }
  };

  onDragEnd = (event: DragEvent) => {
    if ((event as any).synthetic) {
      return;
    }
    // When the user starts dragging a block, `view.dragging` is set on all
    // BlockNote editors. However, when the drag ends, only the editor that the
    // drag originated in automatically clears `view.dragging`. Therefore, we
    // have to manually clear it on all editors.
    this.pmView.dragging = null;
    this.draggedBlockIdsForDropSelection = [];
    this.setPendingDroppedBlockIdsForSelection([]);
  };

  onKeyDown = (_event: KeyboardEvent) => {
    if (this.state?.show && this.editor.isFocused()) {
      // Typing in editor should hide side menu
      this.state.show = false;
      this.emitUpdate(this.state);
    }
  };

  onMouseMove = (event: MouseEvent) => {
    const editorIsInteractive = isSideMenuEditorInteractionCandidate(
      this.pmView.dom,
    );
    if (!editorIsInteractive) {
      this.updateStateFromMousePos(false);
      return;
    }
    if (this.menuFrozen) {
      return;
    }

    // Synthetic mousemove events created via `new Event("mousemove")` (e.g.
    // dispatched by browser extensions) have no `clientX`/`clientY`, which
    // would make `elementsFromPoint` throw on the resulting non-finite
    // coordinates.
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return;
    }

    const interactionOwnership = this.editor.getInteractionOwnership(event);
    if (interactionOwnership === "other") {
      this.mousePositionOwnedByEditor = false;
      this.hideMenu();
      return;
    }
    if (
      interactionOwnership === "self" &&
      !eventTargetsEditorContent(event, this.pmView.dom)
    ) {
      // The pointer moved from content onto this editor's portaled UI. Keep
      // the current block and mouse position so document updates cannot make
      // the side menu disappear while the user reaches for its drag handle.
      return;
    }

    this.mousePos = { x: event.clientX, y: event.clientY };
    this.mousePositionOwnedByEditor = interactionOwnership === "self";

    // We want the full area of the editor to check if the cursor is hovering
    // above it though.
    const editorOuterBoundingBox = this.pmView.dom.getBoundingClientRect();
    const cursorWithinEditor =
      this.mousePos.x > editorOuterBoundingBox.left &&
      this.mousePos.x < editorOuterBoundingBox.right &&
      this.mousePos.y > editorOuterBoundingBox.top &&
      this.mousePos.y < editorOuterBoundingBox.bottom;

    // Doesn't update if the mouse hovers an element that's over the editor but
    // isn't a part of it or the side menu.
    if (
      // Cursor is within the editor area
      cursorWithinEditor &&
      // An element is hovered
      event &&
      event.target &&
      // Element is outside this editor and its portaled UI
      !this.editor.isWithinEditor(event.target as HTMLElement)
    ) {
      this.hideMenu();

      return;
    }

    this.updateStateFromMousePos(true);
  };

  private dispatchSyntheticEvent(event: DragEvent) {
    const evt = new Event(event.type as "dragover", event) as any;
    const dropPointBoundingBox = (
      this.pmView.dom.firstChild as HTMLElement
    ).getBoundingClientRect();
    evt.clientX = event.clientX;
    evt.clientY = event.clientY;

    evt.clientX = Math.min(
      Math.max(event.clientX, dropPointBoundingBox.left),
      dropPointBoundingBox.left + dropPointBoundingBox.width,
    );
    evt.clientY = Math.min(
      Math.max(event.clientY, dropPointBoundingBox.top),
      dropPointBoundingBox.top + dropPointBoundingBox.height,
    );

    evt.dataTransfer = event.dataTransfer;
    evt.preventDefault = () => event.preventDefault();
    evt.synthetic = true; // prevent recursion
    this.pmView.dom.dispatchEvent(evt);
  }

  // Needed in cases where the editor state updates without the mouse cursor
  // moving, as some state updates can require a side menu update. For example,
  // adding a button to the side menu which removes the block can cause the
  // block below to jump up into the place of the removed block when clicked,
  // allowing the user to click the button again without moving the cursor. This
  // would otherwise not update the side menu, and so clicking the button again
  // would attempt to remove the same block again, causing an error.
  update(_view: EditorView, prevState: EditorState) {
    const docChanged = !prevState.doc.eq(this.pmView.state.doc);
    if (docChanged && this.state?.show) {
      this.updateStateFromMousePos();
    }
  }

  destroy() {
    this.state = undefined;
    this.clearState();
    unsetDragImage(this.pmView.root);
    this.pmView.root.removeEventListener(
      "mousemove",
      this.onMouseMove as EventListener,
      true,
    );
    this.pmView.root.removeEventListener(
      "dragstart",
      this.onDragStart as EventListener,
    );
    this.pmView.root.removeEventListener(
      "dragover",
      this.onDragOver as EventListener,
    );
    this.pmView.root.removeEventListener(
      "drop",
      this.onDrop as EventListener,
      true,
    );
    this.pmView.root.removeEventListener(
      "dragend",
      this.onDragEnd as EventListener,
      true,
    );
    this.pmView.root.removeEventListener(
      "keydown",
      this.onKeyDown as EventListener,
      true,
    );
    this.setPendingDroppedBlockIdsForSelection([]);
  }
}

export const sideMenuPluginKey = new PluginKey("SideMenuPlugin");

export const SideMenuExtension = createExtension(({ editor }) => {
  let view: SideMenuView<any, any, any> | undefined;
  let pendingDroppedBlockIdsForSelection: string[] = [];
  let preserveFocusAfterDroppedBlockSelection = false;
  let blockDragEndHandled = false;
  let externalDragOwnershipResolver = (_event: DragEvent) => false;
  const store = createStore<SideMenuState<any, any, any> | undefined>(
    undefined,
  );
  const setPendingDroppedBlockIdsForSelection = (blockIds: string[]) => {
    pendingDroppedBlockIdsForSelection = Array.from(new Set(blockIds));
  };

  return {
    key: "sideMenu",
    store,
    prosemirrorPlugins: [
      new Plugin({
        key: sideMenuPluginKey,
        appendTransaction(transactions, _oldState, newState) {
          if (pendingDroppedBlockIdsForSelection.length === 0) {
            return undefined;
          }
          if (!transactions.some((tr) => tr.getMeta("uiEvent") === "drop")) {
            return undefined;
          }

          const selection = createSideMenuDroppedBlockSelection(
            newState.doc,
            pendingDroppedBlockIdsForSelection,
          );
          pendingDroppedBlockIdsForSelection = [];
          if (!selection) {
            return undefined;
          }

          preserveFocusAfterDroppedBlockSelection = true;
          if (selection.eq(newState.selection)) {
            return undefined;
          }
          return newState.tr.setSelection(selection);
        },
        view: (editorView) => {
          view = new SideMenuView(
            editor,
            editorView,
            (state) => {
              // TODO: Without spreading the state, in some cases like toggling
              // `show`, this doesn't trigger an update.
              store.setState({ ...state });
            },
            () => {
              view = undefined;
              store.setState(undefined);
            },
            setPendingDroppedBlockIdsForSelection,
            (event) => externalDragOwnershipResolver(event),
          );
          return view;
        },
      }),
    ],

    /**
     * Handles drag & drop events for blocks.
     */
    blockDragStart(
      event: SideMenuBlockDragStartEvent,
      block: Block<any, any, any>,
    ): SideMenuBlockDragStartResult | undefined {
      blockDragEndHandled = false;
      preserveFocusAfterDroppedBlockSelection = false;
      if (view) {
        view.isDragOrigin = true;
      }
      const dragStartResult = dragStart(event, block, editor);
      const editorView = editor.prosemirrorView;
      if (view && editorView && dragStartResult) {
        const selectionBlockIds = getSideMenuDroppedBlockIdsFromSelection(
          editorView.state.selection,
        );
        const draggedBlockIds =
          dragStartResult.blockIds.length > 0
            ? dragStartResult.blockIds
            : selectionBlockIds.length > 0
              ? selectionBlockIds
              : [block.id];
        view.setDraggedBlockIdsForDropSelection(draggedBlockIds);
        editorView.dragging = {
          slice: dragStartResult.slice,
          move: true,
        };
      }
      return dragStartResult;
    },

    setExternalDragOwnershipResolver(
      resolver: (event: DragEvent) => boolean,
    ): () => void {
      externalDragOwnershipResolver = resolver;
      return () => {
        if (externalDragOwnershipResolver !== resolver) return;
        externalDragOwnershipResolver = () => false;
      };
    },

    /**
     * Handles drag & drop events for blocks.
     */
    blockDragEnd() {
      unsetDragImage();
      if (view) {
        view.isDragOrigin = false;
      }

      if (blockDragEndHandled) {
        return;
      }
      blockDragEndHandled = true;

      const shouldPreserveFocus = preserveFocusAfterDroppedBlockSelection;
      preserveFocusAfterDroppedBlockSelection = false;
      if (!shouldPreserveFocus) {
        editor.blur();
      }
    },

    /**
     * Whether the side menu is currently frozen (e.g. because the drag handle
     * menu is open).
     */
    get menuFrozen() {
      return view!.menuFrozen;
    },

    /**
     * Freezes the side menu. When frozen, the side menu will stay
     * attached to the same block regardless of which block is hovered by the
     * mouse cursor.
     */
    freezeMenu() {
      if (!view?.state) return;
      view.menuFrozen = true;
      view.state.show = true;
      view.emitUpdate(view.state);
    },

    /**
     * Unfreezes the side menu. When frozen, the side menu will stay
     * attached to the same block regardless of which block is hovered by the
     * mouse cursor.
     */
    unfreezeMenu() {
      if (!view?.state) return;
      view.menuFrozen = false;
      view.state.show = false;
      view.emitUpdate(view.state);
    },

    /**
     * Hides the side menu unless it is currently frozen (e.g. the drag
     * handle menu is open). Used to dismiss the menu on scroll without
     * interfering with open submenus.
     */
    hideMenuIfNotFrozen() {
      if (view && !view.menuFrozen && view.state?.show) {
        view.state.show = false;
        view.emitUpdate(view.state);
      }
    },
  } as const;
});
