import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteViewRaw } from "@blocknote/react";
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test } from "vitest";
import * as Y from "yjs";

import { createCardDocumentGenesis } from "../../../../shared/block-documents/block-document-codec";
import { createNfmEditorModeOptions } from "./nfm-editor-source";

const settleEditor = async () => {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await Promise.resolve();
};

describe("collaborative NFM undo in Chromium", () => {
  test("survives the StrictMode EditorView remount and leaves remote Blocks intact", async () => {
    const genesis = createCardDocumentGenesis({
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
