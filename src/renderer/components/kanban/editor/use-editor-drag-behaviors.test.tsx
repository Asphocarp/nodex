import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import type { ExternalDropAdapter } from "./external-block-drag-session";
import { getActiveExternalEditorDragSession } from "./external-block-drag-session";
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

function makeAdapter(): ExternalDropAdapter {
  return {
    buildSourceUpdates: () => [],
  };
}

function DragBehaviorHarness({
  editor,
  externalDropAdapter,
  containerRef,
}: {
  editor: DragBehaviorEditor;
  externalDropAdapter: ExternalDropAdapter;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  useEditorDragBehaviors({
    editor,
    containerRef,
    externalDropAdapter,
  });
  return <div ref={containerRef} data-testid="editor-container" />;
}

describe("useEditorDragBehaviors", () => {
  test("keeps side-menu drag state across equivalent adapter rerenders", async () => {
    let blockDragEndCount = 0;
    const editor = makeEditor(() => {
      blockDragEndCount += 1;
    });
    const containerRef = createRef<HTMLDivElement>();

    const view = render(
      <DragBehaviorHarness
        editor={editor}
        externalDropAdapter={makeAdapter()}
        containerRef={containerRef}
      />,
    );
    await settleAsyncRender();

    const container = view.getByTestId("editor-container");
    fireEvent.dragStart(container);

    view.rerender(
      <DragBehaviorHarness
        editor={editor}
        externalDropAdapter={makeAdapter()}
        containerRef={containerRef}
      />,
    );
    await settleAsyncRender();

    expect(editor.prosemirrorView?.dragging === null).toBeFalse();
    expect(blockDragEndCount).toBe(0);
    expect(getActiveExternalEditorDragSession() === null).toBeFalse();

    fireEvent.dragEnd(container);

    expect(editor.prosemirrorView?.dragging).toBe(null);
    expect(blockDragEndCount).toBe(1);
    expect(getActiveExternalEditorDragSession()).toBe(null);
  });
});
