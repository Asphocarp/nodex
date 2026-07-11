import { describe, expect, test } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { useEditorDragBehaviors } from "./use-editor-drag-behaviors";

type DragBehaviorEditor = Parameters<typeof useEditorDragBehaviors>[0]["editor"];

function makeEditor(onBlockDragEnd: () => void): DragBehaviorEditor {
  const block = { id: "block-1", type: "paragraph", content: [{ type: "text", text: "Block" }] };
  return {
    document: [block],
    prosemirrorView: {
      dragging: { id: "active-drag" },
      state: { selection: {} },
      root: {
        querySelectorAll: () => [],
      },
    },
    getBlock: (id: string) => id === block.id ? block : undefined,
    getParentBlock: () => undefined,
    getSelection: () => ({ blocks: [block] }),
    removeBlocks: () => undefined,
    replaceBlocks: () => undefined,
    transact: <T,>(fn: () => T) => fn(),
    getExtension: () => ({
      blockDragEnd: onBlockDragEnd,
    }),
    insertBlocks: () => undefined,
  } as unknown as DragBehaviorEditor;
}

function DragBehaviorHarness({
  editor,
  containerRef,
}: {
  editor: DragBehaviorEditor;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  useEditorDragBehaviors({
    editor,
    containerRef,
  });
  return <div ref={containerRef} data-testid="editor-container" />;
}

describe("useEditorDragBehaviors", () => {
  test("keeps side-menu drag state across ordinary editor rerenders", async () => {
    let blockDragEndCount = 0;
    const editor = makeEditor(() => {
      blockDragEndCount += 1;
    });
    const containerRef = createRef<HTMLDivElement>();

    const view = render(
      <DragBehaviorHarness
        editor={editor}
        containerRef={containerRef}
      />,
    );
    await settleAsyncRender();

    const container = view.getByTestId("editor-container");
    await act(async () => {
      fireEvent.dragStart(container);
      await Promise.resolve();
    });

    view.rerender(
      <DragBehaviorHarness
        editor={editor}
        containerRef={containerRef}
      />,
    );
    await settleAsyncRender();

    expect(editor.prosemirrorView?.dragging === null).toBe(false);
    expect(blockDragEndCount).toBe(0);

    await act(async () => {
      fireEvent.dragEnd(container);
      await Promise.resolve();
    });

    expect(editor.prosemirrorView?.dragging).toBe(null);
    expect(blockDragEndCount).toBe(1);
  });
});
