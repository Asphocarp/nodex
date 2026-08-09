import { BlockNoteEditor } from "@blocknote/core";
import { DropCursorExtension } from "@blocknote/core/extensions";
import { BlockNoteViewRaw } from "@blocknote/react";
import { TextSelection } from "@tiptap/pm/state";
import { act, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { NfmFormattingToolbarController } from "./nfm-formatting-toolbar-controller";
import { NfmSideMenuOpenProvider } from "./nfm-side-menu";

const settleEditor = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
};

describe("BlockNote view lifecycle in Chromium", () => {
  test("mounts the NFM side-menu provider before the editor view is available", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ id: "block-1", type: "paragraph", content: "One" }],
    });
    expect(editor.headless).toBe(true);

    const view = render(
      <BlockNoteViewRaw
        editor={editor}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      >
        <NfmSideMenuOpenProvider>
          <div data-testid="nfm-editor-child" />
        </NfmSideMenuOpenProvider>
      </BlockNoteViewRaw>,
    );

    try {
      await act(settleEditor);
      expect(view.getByTestId("nfm-editor-child")).not.toBeNull();
      expect(editor.headless).toBe(false);
    } finally {
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });

  test("changes editability without replacing the mounted EditorView or its NodeViews", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ id: "block-1", type: "paragraph", content: "One" }],
    });
    const renderView = (editable: boolean) => (
      <BlockNoteViewRaw
        editor={editor}
        editable={editable}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      />
    );
    const view = render(renderView(true));

    try {
      await act(settleEditor);
      const mountedView = editor.prosemirrorView;
      const mountedDom = mountedView.dom;

      await act(async () => {
        view.rerender(renderView(false));
        await settleEditor();
      });

      expect(editor.prosemirrorView).toBe(mountedView);
      expect(editor.prosemirrorView.dom).toBe(mountedDom);
      expect(editor.isEditable).toBe(false);
      expect(mountedDom.getAttribute("tabindex")).toBe("0");

      await act(async () => {
        view.rerender(renderView(true));
        await settleEditor();
      });
      expect(editor.prosemirrorView).toBe(mountedView);
      expect(editor.isEditable).toBe(true);
    } finally {
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });

  test("lets an external drag owner suppress BlockNote's native drop cursor", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ id: "block-1", type: "paragraph", content: "One" }],
    });
    const resolveExternalOwnership = vi.fn(() => true);
    const dropCursorExtension = editor.getExtension(
      DropCursorExtension,
    ) as unknown as {
      setExternalDragOwnershipResolver: (
        resolver: (event: DragEvent) => boolean,
      ) => () => void;
    };
    const releaseOwnership =
      dropCursorExtension.setExternalDragOwnershipResolver(
        resolveExternalOwnership,
      );
    const view = render(
      <BlockNoteViewRaw
        editor={editor}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      />,
    );

    try {
      await act(settleEditor);
      await act(async () => {
        editor.prosemirrorView.dom.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: 0,
            clientY: 0,
            dataTransfer: new DataTransfer(),
          }),
        );
        await Promise.resolve();
      });

      expect(resolveExternalOwnership).toHaveBeenCalledOnce();
      expect(document.querySelector(".prosemirror-dropcursor-block")).toBeNull();
    } finally {
      releaseOwnership();
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });

  test("portals the formatting toolbar outside the editor clipping container", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ id: "block-1", type: "paragraph", content: "Select me" }],
    });
    const view = render(
      <BlockNoteViewRaw
        editor={editor}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        tableHandles={false}
      >
        <NfmSideMenuOpenProvider>
          <NfmFormattingToolbarController
            formattingToolbar={() => <div data-testid="formatting-toolbar-portal-probe" />}
          />
        </NfmSideMenuOpenProvider>
      </BlockNoteViewRaw>,
    );

    try {
      await act(settleEditor);
      await act(async () => {
        const transaction = editor.prosemirrorState.tr.setSelection(
          TextSelection.create(editor.prosemirrorState.doc, 2, 8),
        );
        editor.prosemirrorView.dispatch(transaction);
        editor.focus();
        await settleEditor();
      });

      const toolbar = await view.findByTestId("formatting-toolbar-portal-probe");
      expect(document.body.contains(toolbar)).toBe(true);
      expect(view.container.contains(toolbar)).toBe(false);
    } finally {
      view.unmount();
      editor._tiptapEditor.destroy();
    }
  });
});
