import { describe, expect, test } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import {
  DropCursorExtension,
  SideMenuExtension,
} from "@blocknote/core/extensions";
import { render, settleAsyncRender } from "@/test/dom";
import { useEditorDragBehaviors } from "./use-editor-drag-behaviors";
import {
  beginLocalBlockDragSession,
  endLocalBlockDragSession,
  shouldHandleNativeCrossSurfaceDrag,
} from "../../workbench/block-transfer/cross-surface-drag";

type DragBehaviorEditor = Parameters<typeof useEditorDragBehaviors>[0]["editor"];

function makeEditor(
  onBlockDragEnd: () => void,
  onExternalDragOwnershipResolver?: (
    extension: unknown,
    resolver: (event: DragEvent) => boolean,
  ) => void,
): DragBehaviorEditor {
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
    getExtension: (extension: unknown) => ({
      blockDragEnd: onBlockDragEnd,
      setExternalDragOwnershipResolver: (
        resolver: (event: DragEvent) => boolean,
      ) => {
        onExternalDragOwnershipResolver?.(extension, resolver);
        return () => undefined;
      },
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
            surfaceId: "surface-a",
            projectId: "project-a",
            documentId: "document-a",
            storeEpoch: "epoch-a",
            blockTransferDrop: {
              surfaceId: "surface-a",
              projectId: "project-1",
              documentId: "document-a",
              storeEpoch: "epoch-a",
              hostPageId: "card-host",
              ancestorPageIds: [],
              prepareAndFence: async () => ({
                documentId: "document-a",
                storeEpoch: "epoch-a",
                generation: 1,
                expectedHeadSeq: 0,
              }),
              prepareSourceAndFence: async () => ({
                documentId: "document-source",
                storeEpoch: "epoch-a",
                generation: 1,
                expectedHeadSeq: 0,
              }),
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

  test("does not infer a managed Block session from an arbitrary container drag", async () => {
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
    const types: string[] = [];
    const dataTransfer = {
      types,
      effectAllowed: "uninitialized",
      setData: (type: string, value: string) => {
        void value;
        if (!types.includes(type)) types.push(type);
      },
    } as unknown as DataTransfer;
    const dragStart = new Event("dragstart", { bubbles: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });

    await act(async () => {
      container.dispatchEvent(dragStart);
      await Promise.resolve();
    });

    expect(types).toEqual([]);
    expect(dataTransfer.effectAllowed).toBe("uninitialized");
    expect(shouldHandleNativeCrossSurfaceDrag(dataTransfer)).toBe(false);

    await act(async () => {
      fireEvent.dragEnd(container);
      await Promise.resolve();
    });
    expect(shouldHandleNativeCrossSurfaceDrag(dataTransfer)).toBe(false);
  });

  test("makes both BlockNote native drag paths yield to a cross-surface session", async () => {
    const resolvers = new Map<unknown, (event: DragEvent) => boolean>();
    const editor = makeEditor(
      () => undefined,
      (extension, resolver) => resolvers.set(extension, resolver),
    );
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
    const types: string[] = [];
    const values = new Map<string, string>();
    const dataTransfer = {
      types,
      effectAllowed: "uninitialized",
      setData: (type: string, value: string) => {
        if (!types.includes(type)) types.push(type);
        values.set(type, value);
      },
      getData: (type: string) => values.get(type) ?? "",
    } as unknown as DataTransfer;
    beginLocalBlockDragSession(
      {
        sourceSurfaceId: "surface-b",
        projectId: "project-a",
        storeEpoch: "epoch-a",
        source: { kind: "document", documentId: "document-b" },
        rootBlockIds: ["block-b"],
        displayHints: ["paragraph"],
      },
      dataTransfer,
    );
    const dragOver = new Event("dragover", {
      bubbles: true,
      cancelable: true,
    }) as DragEvent;
    Object.defineProperties(dragOver, {
      dataTransfer: { value: dataTransfer },
      target: { value: container },
    });

    try {
      expect(resolvers.get(SideMenuExtension)?.(dragOver)).toBe(true);
      expect(resolvers.get(DropCursorExtension)?.(dragOver)).toBe(true);
    } finally {
      endLocalBlockDragSession();
    }
  });
});
