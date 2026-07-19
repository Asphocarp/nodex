import {
  BlockNoteEditor,
  captureCollaborativeSelection,
  restoreCollaborativeSelection,
  type CollaborativeSelectionBookmark,
} from "@blocknote/core";
import { TextSelection } from "@tiptap/pm/state";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test, vi } from "vitest";
import * as Y from "yjs";

import { createPageDocumentGenesis } from "../../../../shared/block-documents/block-document-codec";
import { createNfmEditorModeOptions } from "./nfm-editor-source";

const settleEditor = async () => {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await Promise.resolve();
};

function ExternalEditorHookOwner({
  editor,
}: {
  readonly editor: BlockNoteEditor;
}) {
  useCreateBlockNote({}, [], editor);
  return null;
}

describe("collaborative NFM undo in Chromium", () => {
  test("leaves an externally owned editor alive after its React owner unmounts", async () => {
    const editor = BlockNoteEditor.create();
    const destroy = vi.spyOn(editor._tiptapEditor, "destroy");
    const view = render(
      <StrictMode>
        <ExternalEditorHookOwner editor={editor} />
      </StrictMode>,
    );

    try {
      view.unmount();
      await act(async () => {
        await Promise.resolve();
      });
      expect(destroy).not.toHaveBeenCalled();
    } finally {
      editor._tiptapEditor.destroy();
    }

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("restores the inline cursor after remote edits while the EditorView is unmounted", async () => {
    const genesis = createPageDocumentGenesis({
      documentId: "document:relative-cursor-browser",
      title: "Relative cursor",
      nfm: "alpha omega",
      allocateBlockId: () => "block-relative-cursor",
    });
    const document = genesis.document;
    const localEditor = BlockNoteEditor.create(
      createNfmEditorModeOptions({
        kind: "collaborative-document",
        documentId: document.guid,
        storeEpoch: "epoch-relative-cursor",
        generation: 1,
        clientSessionId: "local-relative-cursor",
        fragment: document.getXmlFragment("body"),
        user: { name: "Local", color: "#2563eb" },
      }),
    );
    const remoteEditor = BlockNoteEditor.create(
      createNfmEditorModeOptions({
        kind: "collaborative-document",
        documentId: document.guid,
        storeEpoch: "epoch-relative-cursor",
        generation: 1,
        clientSessionId: "remote-relative-cursor",
        fragment: document.getXmlFragment("body"),
        user: { name: "Remote", color: "#16a34a" },
      }),
    );
    const remoteHost = globalThis.document.createElement("div");
    globalThis.document.body.append(remoteHost);
    remoteEditor.mount(remoteHost);
    let bookmark: CollaborativeSelectionBookmark | null = null;
    const viewProps = {
      editor: localEditor,
      formattingToolbar: false as const,
      linkToolbar: false as const,
      slashMenu: false as const,
      sideMenu: false as const,
      tableHandles: false as const,
      onEditorViewMount: () => {
        if (bookmark) restoreCollaborativeSelection(localEditor, bookmark);
      },
      onEditorViewUnmount: () => {
        bookmark = captureCollaborativeSelection(localEditor);
      },
    };
    const firstView = render(<BlockNoteViewRaw {...viewProps} />);

    try {
      await act(settleEditor);
      let omegaPosition: number | null = null;
      localEditor.prosemirrorState.doc.descendants((node, position) => {
        if (omegaPosition !== null || !node.isText || !node.text) return;
        const offset = node.text.indexOf("omega");
        if (offset >= 0) omegaPosition = position + offset;
      });
      if (omegaPosition === null) throw new Error("Expected omega text");
      const initialCursor = omegaPosition;
      await act(async () => {
        localEditor.prosemirrorView.dispatch(
          localEditor.prosemirrorState.tr.setSelection(
            TextSelection.create(localEditor.prosemirrorState.doc, initialCursor),
          ),
        );
      });
      firstView.unmount();
      expect(bookmark).not.toBeNull();

      let alphaPosition: number | null = null;
      remoteEditor.prosemirrorState.doc.descendants((node, position) => {
        if (alphaPosition !== null || !node.isText || !node.text) return;
        const offset = node.text.indexOf("alpha");
        if (offset >= 0) alphaPosition = position + offset;
      });
      if (alphaPosition === null) throw new Error("Expected alpha text");
      const remoteInsertPosition = alphaPosition;
      await act(async () => {
        remoteEditor.prosemirrorView.dispatch(
          remoteEditor.prosemirrorState.tr.insertText(
            "REMOTE ",
            remoteInsertPosition,
          ),
        );
        await settleEditor();
      });

      const secondView = render(<BlockNoteViewRaw {...viewProps} />);
      try {
        await act(settleEditor);
        expect(localEditor.prosemirrorState.selection.head).toBe(
          initialCursor + "REMOTE ".length,
        );
      } finally {
        secondView.unmount();
      }
    } finally {
      remoteEditor.unmount();
      remoteHost.remove();
      localEditor._tiptapEditor.destroy();
      remoteEditor._tiptapEditor.destroy();
      document.destroy();
    }
  });

  test("survives the StrictMode EditorView remount and leaves remote Blocks intact", async () => {
    const genesis = createPageDocumentGenesis({
      documentId: "document:strict-undo-browser",
      title: "Strict undo",
      nfm: "Base paragraph",
      allocateBlockId: () => "block-base",
    });
    const localDocument = genesis.document;
    const remoteDocument = new Y.Doc({ guid: localDocument.guid });
    Y.applyUpdate(remoteDocument, Y.encodeStateAsUpdate(localDocument));
    const remoteBaseVector = Y.encodeStateVector(remoteDocument);

    const localEditor = BlockNoteEditor.create(
      createNfmEditorModeOptions({
        kind: "collaborative-document",
        documentId: localDocument.guid,
        storeEpoch: "epoch-strict-undo",
        generation: 1,
        clientSessionId: "local-browser",
        fragment: localDocument.getXmlFragment("body"),
        user: { name: "Local", color: "#2563eb" },
      }),
    );
    const remoteEditor = BlockNoteEditor.create(
      createNfmEditorModeOptions({
        kind: "collaborative-document",
        documentId: remoteDocument.guid,
        storeEpoch: "epoch-strict-undo",
        generation: 1,
        clientSessionId: "remote-browser",
        fragment: remoteDocument.getXmlFragment("body"),
        user: { name: "Remote", color: "#16a34a" },
      }),
    );
    const remoteHost = document.createElement("div");
    document.body.append(remoteHost);
    remoteEditor.mount(remoteHost);

    const view = render(
      <StrictMode>
        <BlockNoteViewRaw
          editor={localEditor}
          formattingToolbar={false}
          linkToolbar={false}
          slashMenu={false}
          sideMenu={false}
          tableHandles={false}
        />
      </StrictMode>,
    );

    try {
      await act(settleEditor);
      const localBase = localEditor.getBlock("block-base");
      const remoteBase = remoteEditor.getBlock("block-base");
      if (!localBase || !remoteBase) {
        throw new Error("Expected the collaborative genesis Block");
      }

      await act(async () => {
        localEditor.updateBlock(localBase, { content: "Local paragraph" });
        remoteEditor.insertBlocks(
          [
            {
              id: "block-remote",
              type: "paragraph",
              content: "Remote paragraph",
            },
          ],
          remoteBase,
          "after",
        );
        Y.applyUpdate(
          localDocument,
          Y.encodeStateAsUpdate(remoteDocument, remoteBaseVector),
          "remote-provider",
        );
        await settleEditor();
      });

      expect(localEditor.getBlock("block-base")?.content).not.toEqual(
        remoteBase.content,
      );
      expect(localEditor.getBlock("block-remote")).toBeDefined();

      let handled = false;
      await act(async () => {
        handled = localEditor.undo();
        await settleEditor();
      });

      expect(handled).toBe(true);
      expect(localEditor.getBlock("block-base")?.content).toEqual(
        remoteBase.content,
      );
      expect(localEditor.getBlock("block-remote")).toBeDefined();

      const undoPlugin = localEditor.prosemirrorState.plugins.find((plugin) =>
        (plugin as unknown as { readonly key: string }).key.startsWith(
          "y-undo$",
        ),
      );
      const undoState = undoPlugin?.getState(localEditor.prosemirrorState) as
        | { readonly undoManager: Y.UndoManager }
        | undefined;
      if (!undoState) throw new Error("Expected the collaborative undo plugin");
      const stackLengthBeforeUnregister = undoState.undoManager.undoStack.length;

      await act(async () => {
        localEditor.unregisterExtension("yUndo");
        const baseAfterUndo = localEditor.getBlock("block-base");
        if (!baseAfterUndo) throw new Error("Expected the local base Block");
        localEditor.updateBlock(baseAfterUndo, {
          content: "Edit after undo extension removal",
        });
        await settleEditor();
      });
      expect(undoState.undoManager.undoStack).toHaveLength(
        stackLengthBeforeUnregister,
      );
    } finally {
      view.unmount();
      remoteEditor.unmount();
      remoteHost.remove();
      localEditor._tiptapEditor.destroy();
      remoteEditor._tiptapEditor.destroy();
      localDocument.destroy();
      remoteDocument.destroy();
    }
  });
});
