import { describe, expect, test } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import * as Y from "yjs";

import {
  createCardDocumentGenesis,
  materializeCardDocument,
} from "../../../../shared/block-documents/block-document-codec";
import {
  createNfmEditorModeOptions,
  getNfmEditorInstanceKey,
  resolveNfmEditorBlockActionCapabilities,
  type NfmEditorCollaborativeDocumentSource,
} from "./nfm-editor-source";

function createCollaborativeSource(
  fragment: Y.XmlFragment,
  onDocumentChange?: () => void,
): NfmEditorCollaborativeDocumentSource {
  return {
    kind: "collaborative-document",
    documentId: fragment.doc?.guid ?? "document-1",
    storeEpoch: "store-1",
    generation: 1,
    clientSessionId: "surface-1",
    fragment,
    user: { name: "Local editor", color: "#2563eb" },
    onDocumentChange,
  };
}

describe("NfmEditor source boundary", () => {
  test("builds collaboration options with no initialContent field", () => {
    const document = new Y.Doc({ guid: "document-1" });
    const fragment = document.getXmlFragment("body");
    const source = createCollaborativeSource(fragment);
    const options = createNfmEditorModeOptions(source);
    const collaboration = options.collaboration;

    expect(
      Object.prototype.hasOwnProperty.call(options, "initialContent"),
    ).toBe(false);
    expect(collaboration !== undefined).toBe(true);
    expect(collaboration?.fragment ?? null).toBe(fragment);
    expect(collaboration?.user.name ?? "").toBe("Local editor");

    document.destroy();
  });

  test("enables stable-ID Move To for collaborative Card documents", () => {
    const document = new Y.Doc();
    const collaborative = resolveNfmEditorBlockActionCapabilities(true);
    const withoutCardContext = resolveNfmEditorBlockActionCapabilities(false);

    expect(collaborative.canMoveBlocks).toBe(true);
    expect(collaborative.canSendBlocksToThread).toBe(true);
    expect(withoutCardContext.canMoveBlocks).toBe(false);
    expect(withoutCardContext.canSendBlocksToThread).toBe(false);
    document.destroy();
  });

  test("uses source identity keys so document switches recreate instead of rehydrating", () => {
    const firstDocument = new Y.Doc({ guid: "document-1" });
    const secondDocument = new Y.Doc({ guid: "document-2" });
    const firstSource = createCollaborativeSource(
      firstDocument.getXmlFragment("body"),
    );
    const sameSourceKey = getNfmEditorInstanceKey({
      projectId: "project-1",
      source: firstSource,
    });
    const repeatedSourceKey = getNfmEditorInstanceKey({
      projectId: "project-1",
      source: firstSource,
    });
    const switchedSourceKey = getNfmEditorInstanceKey({
      projectId: "project-1",
      source: createCollaborativeSource(secondDocument.getXmlFragment("body")),
    });

    expect(repeatedSourceKey).toBe(sameSourceKey);
    expect(switchedSourceKey === sameSourceKey).toBe(false);

    firstDocument.destroy();
    secondDocument.destroy();
  });

  test("does not replace blocks for a remote collaborative update", async () => {
    const document = new Y.Doc({ guid: "document-1" });
    const genesis = createCardDocumentGenesis({
      documentId: "document-1-genesis",
      title: "Collaborative Card",
      nfm: "",
      allocateBlockId: () => "block-collaborative-root",
    });
    Y.applyUpdate(document, genesis.update);
    genesis.document.destroy();
    const fragment = document.getXmlFragment("body");
    let hintCount = 0;
    let replaceBlocksCount = 0;
    const source = createCollaborativeSource(fragment, () => {
      hintCount += 1;
    });
    const localOptions = createNfmEditorModeOptions(source);
    const remoteOptions = createNfmEditorModeOptions(
      {
        ...source,
        user: { name: "Remote editor", color: "#dc2626" },
      },
    );
    const localEditor = BlockNoteEditor.create(localOptions);
    const remoteEditor = BlockNoteEditor.create(remoteOptions);
    const localElement = globalThis.document.createElement("div");
    const remoteElement = globalThis.document.createElement("div");

    localEditor.mount(localElement);
    remoteEditor.mount(remoteElement);

    const replaceBlocks = localEditor.replaceBlocks.bind(localEditor);
    localEditor.replaceBlocks = ((
      ...args: Parameters<typeof localEditor.replaceBlocks>
    ) => {
      replaceBlocksCount += 1;
      return replaceBlocks(...args);
    }) as typeof localEditor.replaceBlocks;
    const unsubscribe = localEditor.onChange(() => {
      source.onDocumentChange?.();
    });

    const remoteBlock = remoteEditor.document[0];
    if (!remoteBlock)
      throw new Error("Expected the collaborative genesis block");
    remoteEditor.updateBlock(remoteBlock, { content: "Remote update" });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hintCount > 0).toBe(true);
    expect(replaceBlocksCount).toBe(0);

    unsubscribe();
    localEditor.unmount();
    remoteEditor.unmount();
    document.destroy();
  });

  test("mounts a title-only Card without inventing a placeholder identity", () => {
    const genesis = createCardDocumentGenesis({
      documentId: "document-title-only",
      title: "Title only",
      nfm: "",
      allocateBlockId: () => "block-title-only-root",
    });
    const source = createCollaborativeSource(
      genesis.document.getXmlFragment("body"),
    );
    const editor = BlockNoteEditor.create(createNfmEditorModeOptions(source));
    const element = globalThis.document.createElement("div");

    editor.mount(element);

    expect(editor.document).toMatchObject([
      { id: "block-title-only-root", type: "paragraph" },
    ]);
    expect(materializeCardDocument(genesis.document).blockTree).toMatchObject([
      { id: "block-title-only-root", type: "paragraph" },
    ]);
    expect(
      materializeCardDocument(genesis.document).blockTree.some(
        (block) => block.id === "initialBlockId",
      ),
    ).toBe(false);

    editor.unmount();
    genesis.document.destroy();
  });
});
