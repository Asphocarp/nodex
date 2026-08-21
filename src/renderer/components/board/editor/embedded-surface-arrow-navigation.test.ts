import { describe, expect, test, vi } from "vite-plus/test";
import {
  findVisibleNeighborBlock,
  focusEmbeddedEditorBoundary,
  focusRegisteredEmbeddedSurfaceBoundary,
  handleArrowIntoEmbeddedSurface,
  isEditorAtVisibleBoundary,
  moveFromEmbeddedSurfaceToHostNeighbor,
  registerEmbeddedSurfaceBoundaryHandle,
  type EmbeddedSurfaceHostEditor,
} from "./embedded-surface-arrow-navigation";

interface TestBlock {
  readonly id: string;
  readonly type: string;
  readonly children?: readonly TestBlock[];
}

const paragraph = (id: string, children: readonly TestBlock[] = []): TestBlock => ({
  id,
  type: "paragraph",
  children,
});

const card = (id: string): TestBlock => ({ id, type: "page", children: [] });

function makeEditor({
  document = [paragraph("before"), card("shell"), paragraph("after")],
  currentBlockId = "before",
  selection = { empty: true },
  atVisualBoundary = true,
  expanded = () => true,
}: {
  readonly document?: readonly TestBlock[];
  readonly currentBlockId?: string;
  readonly selection?: { readonly empty: boolean; readonly node?: unknown };
  readonly atVisualBoundary?: boolean;
  readonly expanded?: (blockId: string) => boolean;
} = {}) {
  const cursorMoves: Array<{ id: string; placement: "start" | "end" }> = [];
  let focused = false;
  const editor: EmbeddedSurfaceHostEditor = {
    document,
    prosemirrorView: {
      state: { selection },
      endOfTextblock: () => atVisualBoundary,
      dom: {
        querySelector: (selector: string) => {
          const match = selector.match(/data-id="([^"]+)"/);
          if (!match) return null;
          const blockId = match[1];
          return {
            querySelector: () => ({
              getAttribute: (name: string) =>
                name === "data-show-children" ? (expanded(blockId) ? "true" : "false") : null,
            }),
          } as unknown as Element;
        },
      } as unknown as HTMLElement,
    },
    getTextCursorPosition: () => ({
      block: { id: currentBlockId, type: "paragraph" },
    }),
    setTextCursorPosition: (id, placement = "start") => {
      cursorMoves.push({ id, placement });
    },
    focus: () => {
      focused = true;
    },
  };
  return {
    editor,
    cursorMoves,
    get focused() {
      return focused;
    },
  };
}

describe("embedded surface arrow navigation", () => {
  test("scopes identical shell ids to their concrete host editor", () => {
    const firstEditor = makeEditor().editor;
    const secondEditor = makeEditor().editor;
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);

    const unregisterFirst = registerEmbeddedSurfaceBoundaryHandle(firstEditor, "shell", {
      focusBoundary: first,
    });
    registerEmbeddedSurfaceBoundaryHandle(secondEditor, "shell", {
      focusBoundary: second,
    });

    expect(focusRegisteredEmbeddedSurfaceBoundary(firstEditor, "shell", "down")).toBe(true);
    expect(focusRegisteredEmbeddedSurfaceBoundary(secondEditor, "shell", "up")).toBe(true);
    expect(first).toHaveBeenCalledWith("down");
    expect(second).toHaveBeenCalledWith("up");

    unregisterFirst();
    expect(focusRegisteredEmbeddedSurfaceBoundary(firstEditor, "shell", "down")).toBe(false);
    expect(focusRegisteredEmbeddedSurfaceBoundary(secondEditor, "shell", "down")).toBe(true);
  });

  test("does not let stale cleanup remove a newer handle", () => {
    const editor = makeEditor().editor;
    const oldHandle = { focusBoundary: vi.fn(() => true) };
    const newHandle = { focusBoundary: vi.fn(() => true) };
    const unregisterOld = registerEmbeddedSurfaceBoundaryHandle(editor, "shell", oldHandle);
    registerEmbeddedSurfaceBoundaryHandle(editor, "shell", newHandle);

    unregisterOld();

    expect(focusRegisteredEmbeddedSurfaceBoundary(editor, "shell", "down")).toBe(true);
    expect(oldHandle.focusBoundary).not.toHaveBeenCalled();
    expect(newHandle.focusBoundary).toHaveBeenCalledWith("down");
  });

  test("finds visible depth-first neighbors and prunes collapsed descendants", () => {
    const blocks = [
      paragraph("parent", [paragraph("child-a"), paragraph("child-b")]),
      card("shell"),
      paragraph("tail"),
    ];

    expect(findVisibleNeighborBlock(blocks, "child-a", "down", () => true)?.id).toBe("child-b");
    expect(findVisibleNeighborBlock(blocks, "shell", "up", () => true)?.id).toBe("child-b");
    expect(findVisibleNeighborBlock(blocks, "shell", "up", (id) => id !== "parent")?.id).toBe(
      "parent",
    );
    expect(findVisibleNeighborBlock(blocks, "child-b", "down", () => true)?.id).toBe("shell");
  });

  test("enters an adjacent surface only at a visual textblock boundary", () => {
    const atBoundary = makeEditor({ atVisualBoundary: true });
    const insideWrappedLine = makeEditor({ atVisualBoundary: false });
    const focus = vi.fn(() => true);
    registerEmbeddedSurfaceBoundaryHandle(atBoundary.editor, "shell", { focusBoundary: focus });
    registerEmbeddedSurfaceBoundaryHandle(insideWrappedLine.editor, "shell", {
      focusBoundary: focus,
    });

    expect(handleArrowIntoEmbeddedSurface(atBoundary.editor, "down")).toBe(true);
    expect(atBoundary.cursorMoves).toEqual([{ id: "shell", placement: "start" }]);
    expect(handleArrowIntoEmbeddedSurface(insideWrappedLine.editor, "down")).toBe(false);
    expect(insideWrappedLine.cursorMoves).toEqual([]);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test("enters a selected childless shell without requiring a text boundary", () => {
    const selected = makeEditor({
      currentBlockId: "shell",
      selection: { empty: false, node: {} },
      atVisualBoundary: false,
    });
    const focus = vi.fn(() => true);
    registerEmbeddedSurfaceBoundaryHandle(selected.editor, "shell", { focusBoundary: focus });

    expect(handleArrowIntoEmbeddedSurface(selected.editor, "up")).toBe(true);
    expect(focus).toHaveBeenCalledWith("up");
  });

  test("does not intercept a range selection on the same block", () => {
    const selected = makeEditor({
      currentBlockId: "before",
      selection: { empty: false },
      atVisualBoundary: true,
    });
    registerEmbeddedSurfaceBoundaryHandle(selected.editor, "shell", {
      focusBoundary: () => true,
    });

    expect(handleArrowIntoEmbeddedSurface(selected.editor, "down")).toBe(false);
  });

  test("moves from a surface to a structural host neighbor or directly into the next surface", () => {
    const normalNeighbor = makeEditor();
    expect(moveFromEmbeddedSurfaceToHostNeighbor(normalNeighbor.editor, "shell", "down")).toBe(
      true,
    );
    expect(normalNeighbor.cursorMoves).toEqual([{ id: "after", placement: "start" }]);
    expect(normalNeighbor.focused).toBe(true);

    const consecutive = makeEditor({
      document: [paragraph("before"), card("shell"), card("second"), paragraph("after")],
    });
    const focusSecond = vi.fn(() => true);
    registerEmbeddedSurfaceBoundaryHandle(consecutive.editor, "second", {
      focusBoundary: focusSecond,
    });
    expect(moveFromEmbeddedSurfaceToHostNeighbor(consecutive.editor, "shell", "down")).toBe(true);
    expect(focusSecond).toHaveBeenCalledWith("down");
    expect(consecutive.cursorMoves).toEqual([{ id: "second", placement: "start" }]);
  });

  test("focuses the first or last visible boundary of an embedded editor", () => {
    const editor = makeEditor({
      document: [paragraph("parent", [paragraph("hidden")]), paragraph("tail")],
      expanded: (id) => id !== "parent",
    });

    expect(focusEmbeddedEditorBoundary(editor.editor, "down")).toBe(true);
    expect(focusEmbeddedEditorBoundary(editor.editor, "up")).toBe(true);
    expect(editor.cursorMoves).toEqual([
      { id: "parent", placement: "start" },
      { id: "tail", placement: "end" },
    ]);
  });

  test("reports an embedded editor boundary only at its first or last visible block", () => {
    const first = makeEditor({ currentBlockId: "before" });
    const middle = makeEditor({ currentBlockId: "shell" });
    const last = makeEditor({ currentBlockId: "after" });
    const notVisual = makeEditor({ currentBlockId: "after", atVisualBoundary: false });

    expect(isEditorAtVisibleBoundary(first.editor, "up")).toBe(true);
    expect(isEditorAtVisibleBoundary(first.editor, "down")).toBe(false);
    expect(isEditorAtVisibleBoundary(middle.editor, "up")).toBe(false);
    expect(isEditorAtVisibleBoundary(last.editor, "down")).toBe(true);
    expect(isEditorAtVisibleBoundary(notVisual.editor, "down")).toBe(false);
  });
});
