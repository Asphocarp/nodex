import { describe, expect, test, vi } from "vitest";
import { render } from "@/test/dom";
import {
  prepareNfmEditorForMutation,
  prepareNfmEditorStructuralMutation,
  type NfmEditorMutationRuntime,
} from "./nfm-editor-relocation";

describe("NfmEditor mutation preparation", () => {
  test("blurs only its own editor and waits for the DOM boundary", async () => {
    const view = render(
      <>
        <div data-testid="surface-editor">
          <div contentEditable data-testid="editor-content" />
        </div>
        <input aria-label="Other surface" />
      </>,
    );
    const container = view.getByTestId("surface-editor");
    const content = view.getByTestId("editor-content");
    const other = view.getByRole("textbox", {
      name: "Other surface",
    }) as HTMLInputElement;
    let blurCalls = 0;
    const runtime: NfmEditorMutationRuntime = {
      isFocused: () => content.ownerDocument.activeElement === content,
      isWithinEditor: (element) => container.contains(element),
      blur: () => {
        blurCalls += 1;
        content.blur();
      },
    };

    content.focus();
    await prepareNfmEditorForMutation(runtime, container);
    expect(blurCalls).toBe(1);
    expect(content.ownerDocument.activeElement === content).toBe(false);
    other.focus();
    await prepareNfmEditorForMutation(runtime, container);
    expect(other.ownerDocument.activeElement === other).toBe(true);
    expect(blurCalls).toBe(1);
  });

  test("finishes native drag state before flushing the structural head", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const order: string[] = [];
    const editor = {
      prosemirrorView: {
        dragging: { slice: "dragged" },
        root: document,
      },
      getExtension: () => ({
        blockDragEnd: () => {
          order.push("drag-end");
        },
      }),
      blur: () => {
        order.push("blur");
      },
      isFocused: () => true,
    };
    const flushAndFence = vi.fn(async () => {
      order.push("flush");
      return {
        documentId: "document-1",
        storeEpoch: "epoch-1",
        generation: 1,
        expectedHeadSeq: 4,
      };
    });

    try {
      const fence = await prepareNfmEditorStructuralMutation(
        editor,
        container,
        { flushAndFence },
      );

      expect(editor.prosemirrorView.dragging).toBeNull();
      expect(order).toEqual(["drag-end", "blur", "flush"]);
      expect(fence.expectedHeadSeq).toBe(4);
    } finally {
      container.remove();
    }
  });
});
