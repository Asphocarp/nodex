import { describe, expect, test } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import * as Y from "yjs";

import {
  createNfmEditorModeOptions,
  getNfmEditorInstanceKey,
  resolveNfmEditorBlockActionCapabilities,
  routeNfmEditorDocumentChange,
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
    const options = createNfmEditorModeOptions(source, [{ type: "paragraph" }]);
    const collaboration =
      "collaboration" in options ? options.collaboration : undefined;

    expect(
      Object.prototype.hasOwnProperty.call(options, "initialContent"),
    ).toBe(false);
    expect(collaboration !== undefined).toBe(true);
    expect(collaboration?.fragment ?? null).toBe(fragment);
    expect(collaboration?.user.name ?? "").toBe("Local editor");

    document.destroy();
  });

  test("routes a collaborative editor change only to its local invalidation hint", () => {
    const document = new Y.Doc();
    let hintCount = 0;
    let snapshotScheduleCount = 0;
    const source = createCollaborativeSource(
      document.getXmlFragment("body"),
      () => {
        hintCount += 1;
      },
    );

    const routed = routeNfmEditorDocumentChange(source, () => {
      snapshotScheduleCount += 1;
    });

    expect(routed).toBe("collaborative-document");
    expect(hintCount).toBe(1);
    expect(snapshotScheduleCount).toBe(0);

    document.destroy();
  });

  test("enables stable-ID Move To for collaborative Card documents", () => {
    const document = new Y.Doc();
    const collaborative = resolveNfmEditorBlockActionCapabilities(
      createCollaborativeSource(document.getXmlFragment("body")),
      true,
    );
    const withoutCardContext = resolveNfmEditorBlockActionCapabilities(
      createCollaborativeSource(document.getXmlFragment("body")),
      false,
    );
    const legacy = resolveNfmEditorBlockActionCapabilities(
      {
        kind: "legacy-snapshot",
        content: "Legacy body",
        onChange: () => undefined,
        onBlur: () => undefined,
      },
      true,
    );

    expect(collaborative.canMoveBlocks).toBe(true);
    expect(collaborative.canSendBlocksToThread).toBe(true);
    expect(withoutCardContext.canMoveBlocks).toBe(false);
    expect(withoutCardContext.canSendBlocksToThread).toBe(false);
    expect(legacy.canMoveBlocks).toBe(true);
    expect(legacy.canSendBlocksToThread).toBe(true);

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

  test("does not schedule snapshot persistence or replace blocks for a remote collaborative update", async () => {
    const document = new Y.Doc({ guid: "document-1" });
    const fragment = document.getXmlFragment("body");
    let hintCount = 0;
    let snapshotScheduleCount = 0;
    let replaceBlocksCount = 0;
    const source = createCollaborativeSource(fragment, () => {
      hintCount += 1;
    });
    const localOptions = createNfmEditorModeOptions(source, undefined);
    const remoteOptions = createNfmEditorModeOptions(
      {
        ...source,
        user: { name: "Remote editor", color: "#dc2626" },
      },
      undefined,
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
      routeNfmEditorDocumentChange(source, () => {
        snapshotScheduleCount += 1;
      });
    });

    const remoteBlock = remoteEditor.document[0];
    if (!remoteBlock)
      throw new Error("Expected the collaborative genesis block");
    remoteEditor.updateBlock(remoteBlock, { content: "Remote update" });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hintCount > 0).toBe(true);
    expect(snapshotScheduleCount).toBe(0);
    expect(replaceBlocksCount).toBe(0);

    unsubscribe();
    localEditor.unmount();
    remoteEditor.unmount();
    document.destroy();
  });
});
