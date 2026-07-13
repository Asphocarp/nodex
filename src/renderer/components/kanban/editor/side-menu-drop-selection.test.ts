import { describe, expect, test } from "vitest";
import {
  createSideMenuDroppedBlockSelection,
  getSideMenuDroppedBlockIdsFromSelection,
  getSideMenuDroppedBlockIdsFromSlice,
  MultipleNodeSelection,
  SideMenuExtension,
  SideMenuView,
} from "@blocknote/core/extensions";
import { Fragment, Schema, Slice } from "@tiptap/pm/model";
import { EditorState, NodeSelection, type Selection } from "@tiptap/pm/state";

const schema = new Schema({
  nodes: {
    doc: { content: "blockGroup" },
    blockGroup: { content: "block*" },
    block: {
      attrs: { id: {} },
      content: "text*",
      group: "bnBlock block",
      toDOM: (node) => ["div", { "data-id": node.attrs.id }, 0],
      parseDOM: [{ tag: "div[data-id]" }],
    },
    text: { group: "inline" },
  },
  marks: {},
});

function makeBlock(id: string, text = id) {
  return schema.node("block", { id }, schema.text(text));
}

function makeDoc() {
  return schema.node("doc", null, [
    schema.node("blockGroup", null, [
      makeBlock("a"),
      makeBlock("b"),
      makeBlock("c"),
    ]),
  ]);
}

function selectionIds(selection: Selection | undefined) {
  if (!selection) return "";
  const blockSelection = selection as Selection & {
    node?: { attrs?: { id?: string } };
    nodes?: Array<{ attrs?: { id?: string } }>;
  };
  if (Array.isArray(blockSelection.nodes)) {
    return blockSelection.nodes.map((node) => node.attrs?.id ?? "").join(",");
  }
  return blockSelection.node?.attrs?.id ?? "";
}

function setRect(element: Element, rect: DOMRect) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function makeEditorCandidate(id: string, rect: DOMRect) {
  const editor = document.createElement("div");
  const blockGroup = document.createElement("div");
  const block = document.createElement("div");
  editor.className = "bn-editor";
  blockGroup.className = "bn-block-group";
  block.dataset.nodeType = "blockContainer";
  block.dataset.id = id;
  blockGroup.appendChild(block);
  editor.appendChild(blockGroup);
  setRect(editor, rect);
  setRect(blockGroup, rect);
  setRect(block, rect);
  return { editor, blockGroup, block };
}

function installElementsFromPoint(
  root: Document | ShadowRoot,
  resolve: (clientX: number, clientY: number) => Element[],
) {
  const original = root.elementsFromPoint;
  Object.defineProperty(root, "elementsFromPoint", {
    configurable: true,
    value: resolve,
  });
  return () => {
    if (original) {
      Object.defineProperty(root, "elementsFromPoint", {
        configurable: true,
        value: original,
      });
      return;
    }
    Reflect.deleteProperty(root, "elementsFromPoint");
  };
}

function makeSideMenuView(
  active: ReturnType<typeof makeEditorCandidate>,
  root: Document | ShadowRoot = document,
) {
  const droppedSlice = new Slice(
    Fragment.from(makeBlock(active.block.dataset.id!)),
    0,
    0,
  );
  const pmView = {
    dom: active.editor,
    root,
    dragging: {
      slice: droppedSlice,
      move: true,
    },
    dispatch: () => {},
  };
  let hoveredBlockId = "";
  const view = new SideMenuView(
    {
      isEditable: true,
      isWithinEditor: (element: Element) => active.editor.contains(element),
      getBlock: (id: string) => ({ id }),
    } as never,
    pmView as never,
    (state) => {
      if (state.show) hoveredBlockId = state.block.id;
    },
    () => {},
  );

  return {
    view,
    getHoveredBlockId: () => hoveredBlockId,
  };
}

function makeDropEvent(type: string, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true }) as DragEvent;
  Object.defineProperties(event, {
    clientX: { configurable: true, value: clientX },
    clientY: { configurable: true, value: clientY },
    dataTransfer: {
      configurable: true,
      value: {
        types: ["blocknote/html"],
      },
    },
  });
  return event;
}

describe("side-menu drop selection helpers", () => {
  test("creates a block-range selection for one dropped block id", () => {
    const selection = createSideMenuDroppedBlockSelection(makeDoc(), ["b"]);

    expect(selection instanceof MultipleNodeSelection).toBe(true);
    expect(selectionIds(selection)).toBe("b");
  });

  test("creates a MultipleNodeSelection for adjacent dropped block ids", () => {
    const selection = createSideMenuDroppedBlockSelection(makeDoc(), ["c", "b"]);

    expect(selection instanceof MultipleNodeSelection).toBe(true);
    expect(selectionIds(selection)).toBe("b,c");
  });

  test("extracts dropped block ids from node-level selections and slices", () => {
    const doc = makeDoc();
    const selection = createSideMenuDroppedBlockSelection(doc, ["b", "c"]);
    const slice = new Slice(
      Fragment.fromArray([makeBlock("x"), makeBlock("y")]),
      0,
      0,
    );

    expect(getSideMenuDroppedBlockIdsFromSelection(selection!).join(",")).toBe("b,c");
    expect(getSideMenuDroppedBlockIdsFromSlice(slice).join(",")).toBe("x,y");
  });

  test("extracts the dragged block id from a single node selection slice", () => {
    const doc = makeDoc();
    const selection = createSideMenuDroppedBlockSelection(doc, ["b"]);

    expect(getSideMenuDroppedBlockIdsFromSlice(selection!.content()).join(",")).toBe("b");
  });

  test("returns undefined when dropped ids are not in the new document", () => {
    expect(createSideMenuDroppedBlockSelection(makeDoc(), ["missing"]) === undefined).toBe(true);
  });

  test("ignores non-interactive editor geometry for side-menu hover and drop routing", () => {
    const excludedRect = new DOMRect(100, 100, 300, 300);
    const activeRect = new DOMRect(120, 100, 300, 300);
    const hidden = makeEditorCandidate("hidden", excludedRect);
    hidden.editor.style.visibility = "hidden";

    const inert = makeEditorCandidate("inert", excludedRect);
    const inertHost = document.createElement("div");
    inertHost.setAttribute("inert", "");
    inertHost.appendChild(inert.editor);

    const pointerDisabled = makeEditorCandidate(
      "pointer-disabled",
      excludedRect,
    );
    pointerDisabled.editor.style.pointerEvents = "none";

    const incomplete = document.createElement("div");
    incomplete.className = "bn-editor";

    const active = makeEditorCandidate("active", activeRect);
    document.body.append(
      hidden.editor,
      inertHost,
      pointerDisabled.editor,
      incomplete,
      active.editor,
    );

    const restoreElementsFromPoint = installElementsFromPoint(
      document,
      (clientX) => (clientX >= activeRect.left ? [active.block] : []),
    );
    const runtime = makeSideMenuView(active);

    try {
      runtime.view.onMouseMove(
        new MouseEvent("mousemove", { clientX: 90, clientY: 150 }),
      );
      const dragContext = runtime.view.getDragEventContext(
        makeDropEvent("dragover", 90, 150),
      );

      expect(runtime.getHoveredBlockId()).toBe("active");
      expect(dragContext).toMatchObject({
        isDropPoint: true,
        isDropWithinEditorBounds: false,
      });
    } finally {
      runtime.view.destroy();
      restoreElementsFromPoint();
      hidden.editor.remove();
      inertHost.remove();
      pointerDisabled.editor.remove();
      incomplete.remove();
      active.editor.remove();
    }
  });

  test("prefers the browser hit-tested editor when visible editors overlap", () => {
    const rect = new DOMRect(100, 100, 300, 300);
    const lower = makeEditorCandidate("lower", rect);
    const top = makeEditorCandidate("top", rect);
    top.editor.style.pointerEvents = "none";
    top.blockGroup.style.pointerEvents = "auto";
    document.body.append(lower.editor, top.editor);

    const restoreElementsFromPoint = installElementsFromPoint(
      document,
      () => [top.block, lower.block],
    );
    const runtime = makeSideMenuView(top);

    try {
      runtime.view.onMouseMove(
        new MouseEvent("mousemove", { clientX: 150, clientY: 150 }),
      );
      const dragContext = runtime.view.getDragEventContext(
        makeDropEvent("dragover", 150, 150),
      );

      expect(runtime.getHoveredBlockId()).toBe("top");
      expect(dragContext).toMatchObject({
        isDropPoint: true,
        isDropWithinEditorBounds: true,
      });
    } finally {
      runtime.view.destroy();
      restoreElementsFromPoint();
      lower.editor.remove();
      top.editor.remove();
    }
  });

  test("ignores an editor made inert outside its ShadowRoot", () => {
    const rect = new DOMRect(100, 100, 300, 300);
    const host = document.createElement("div");
    host.setAttribute("inert", "");
    const root = host.attachShadow({ mode: "open" });
    const active = makeEditorCandidate("shadowed", rect);
    root.appendChild(active.editor);
    document.body.appendChild(host);
    const runtime = makeSideMenuView(active, root);

    try {
      runtime.view.onMouseMove(
        new MouseEvent("mousemove", { clientX: 150, clientY: 150 }),
      );
      const dragContext = runtime.view.getDragEventContext(
        makeDropEvent("dragover", 150, 150),
      );

      expect(runtime.getHoveredBlockId()).toBe("");
      expect(dragContext).toBeUndefined();
    } finally {
      runtime.view.destroy();
      host.remove();
    }
  });

  test("sets pending dropped ids before dispatching a synthetic gutter drop", () => {
    const editorElement = document.createElement("div");
    const blockGroup = document.createElement("div");
    editorElement.className = "bn-editor";
    blockGroup.className = "bn-block-group";
    editorElement.appendChild(blockGroup);
    document.body.appendChild(editorElement);
    setRect(blockGroup, new DOMRect(100, 100, 300, 300));

    const droppedSlice = new Slice(Fragment.from(makeBlock("b")), 0, 0);
    const pmView: {
      dom: HTMLDivElement;
      root: Document;
      dragging: { slice: Slice; move: boolean } | null;
      dispatch: () => void;
    } = {
      dom: editorElement,
      root: document,
      dragging: {
        slice: droppedSlice,
        move: true,
      },
      dispatch: () => {
        throw new Error("outer drop handler should not collapse selection after synthetic drop");
      },
    };
    let pendingIds = "";
    let pendingIdsSeenBySyntheticDrop = "";
    editorElement.addEventListener("drop", () => {
      pendingIdsSeenBySyntheticDrop = pendingIds;
      pmView.dragging = null;
    });

    const view = new SideMenuView(
      { isEditable: true } as never,
      pmView as never,
      () => {},
      (blockIds) => {
        pendingIds = blockIds.join(",");
      },
    );

    try {
      view.onDrop(makeDropEvent("drop", 90, 120));

      expect(pendingIdsSeenBySyntheticDrop).toBe("b");
      expect(pendingIds).toBe("b");
      expect(pmView.dragging).toBe(null);
    } finally {
      view.destroy();
      editorElement.remove();
    }
  });

  test("replaces ProseMirror single-node drop selection with a non-draggable block range", () => {
    const editorElement = document.createElement("div");
    const blockGroup = document.createElement("div");
    editorElement.className = "bn-editor";
    blockGroup.className = "bn-block-group";
    editorElement.appendChild(blockGroup);
    document.body.appendChild(editorElement);
    setRect(blockGroup, new DOMRect(100, 100, 300, 300));

    const droppedSlice = new Slice(Fragment.from(makeBlock("b")), 0, 0);
    const pmView: {
      dom: HTMLDivElement;
      root: Document;
      dragging: { slice: Slice; move: boolean } | null;
      dispatch: () => void;
    } = {
      dom: editorElement,
      root: document,
      dragging: {
        slice: droppedSlice,
        move: true,
      },
      dispatch: () => {},
    };
    let blurred = false;
    const extension = SideMenuExtension()({
      editor: {
        isEditable: true,
        prosemirrorView: pmView,
        blur: () => {
          blurred = true;
        },
      },
    } as never);
    const plugin = extension.prosemirrorPlugins[0];
    const pluginView = plugin.spec.view?.(pmView as never);
    const doc = makeDoc();
    const prosemirrorDropSelection = NodeSelection.create(doc, 4);
    const newState = EditorState.create({
      schema,
      doc,
      selection: prosemirrorDropSelection,
    });
    const dropTransaction = newState.tr.setMeta("uiEvent", "drop");

    try {
      (pluginView as SideMenuView<never, never, never>).onDrop(
        makeDropEvent("drop", 150, 150),
      );

      const appended = plugin.spec.appendTransaction?.(
        [dropTransaction],
        newState,
        newState,
      );
      const nextState = appended ? newState.apply(appended) : newState;
      extension.blockDragEnd();
      extension.blockDragEnd();

      expect(appended === undefined).toBe(false);
      expect(nextState.selection instanceof MultipleNodeSelection).toBe(true);
      expect(selectionIds(nextState.selection)).toBe("b");
      expect(blurred).toBe(false);
    } finally {
      pluginView?.destroy?.();
      editorElement.remove();
    }
  });
});
