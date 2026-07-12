import { describe, expect, test } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { useEditorDragBehaviors } from "./use-editor-drag-behaviors";
import {
  NODEX_BLOCK_TRANSFER_DRAG_MIME,
  parseBlockTransferDragPayload,
  shouldHandleNativeCrossSurfaceDrag,
} from "../cross-surface-drag";

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
  crossSurface = false,
}: {
  editor: DragBehaviorEditor;
  containerRef: RefObject<HTMLDivElement | null>;
  crossSurface?: boolean;
}) {
  useEditorDragBehaviors({
    editor,
    containerRef,
    ...(crossSurface
      ? {
          crossSurface: {
            projectId: "project-a",
            documentId: "document-a",
            storeEpoch: "epoch-a",
            blockTransferDrop: {
              projectId: "project-1",
              documentId: "document-a",
              storeEpoch: "epoch-a",
              hostCardId: "card-host",
              ancestorCardIds: [],
              createOperationId: () => "operation-a",
              transfer: async () => ({
                ok: false,
                error: {
                  code: "unknown",
                  message: "not used",
                  retryable: false,
                  reloadRequired: false,
                },
              }),
              reportError: () => undefined,
            },
          },
        }
      : {}),
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

  test("publishes stable Block identities and current parent authority", async () => {
    const editor = makeEditor(() => undefined);
    const containerRef = createRef<HTMLDivElement>();
    const view = render(
      <DragBehaviorHarness
        editor={editor}
        containerRef={containerRef}
        crossSurface
      />,
    );
    await settleAsyncRender();
    const container = view.getByTestId("editor-container");
    container.classList.add("nfm-editor");
    const data = new Map<string, string>();
    const types: string[] = [];
    const dataTransfer = {
      types,
      effectAllowed: "uninitialized",
      setData: (type: string, value: string) => {
        if (!types.includes(type)) types.push(type);
        data.set(type, value);
      },
    } as unknown as DataTransfer;
    const dragStart = new Event("dragstart", { bubbles: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });

    await act(async () => {
      container.dispatchEvent(dragStart);
      await Promise.resolve();
    });

    const payload = parseBlockTransferDragPayload(
      data.get(NODEX_BLOCK_TRANSFER_DRAG_MIME) ?? "",
    );
    expect(payload?.projectId).toBe("project-a");
    expect(payload?.source).toEqual({
      kind: "document",
      documentId: "document-a",
    });
    expect(payload?.rootBlockIds).toEqual(["block-1"]);
    expect(dataTransfer.effectAllowed).toBe("copyMove");
    expect(shouldHandleNativeCrossSurfaceDrag(dataTransfer)).toBe(true);

    await act(async () => {
      fireEvent.dragEnd(container);
      await Promise.resolve();
    });
    expect(shouldHandleNativeCrossSurfaceDrag(dataTransfer)).toBe(false);
  });
});
