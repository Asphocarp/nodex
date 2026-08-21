import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  canvasCreatePendingExtension,
  canvasCreatePendingPluginKey,
  setCanvasCreatePending,
} from "./canvas-create-pending-extension";

describe("Canvas create pending extension", () => {
  let editor: BlockNoteEditor | null = null;

  afterEach(() => {
    editor?._tiptapEditor.destroy();
    editor = null;
  });

  test("shows ephemeral pending state until the paragraph is authoritatively replaced", () => {
    editor = BlockNoteEditor.create({
      initialContent: [
        {
          id: "paragraph-1",
          type: "paragraph",
          content: "",
        },
      ],
      extensions: [canvasCreatePendingExtension()],
    });
    editor.mount(document.createElement("div"));

    setCanvasCreatePending(editor, "paragraph-1", true);

    const pending = canvasCreatePendingPluginKey.getState(editor.prosemirrorState);
    expect(pending?.blockIds.has("paragraph-1")).toBe(true);
    expect(pending?.decorations.find()).toHaveLength(1);
    expect(editor.document).toEqual([
      expect.objectContaining({
        id: "paragraph-1",
        type: "paragraph",
        content: [],
      }),
    ]);

    editor.updateBlock("paragraph-1", {
      type: "heading",
      props: { level: 1 },
    });

    const replaced = canvasCreatePendingPluginKey.getState(editor.prosemirrorState);
    expect(replaced?.blockIds.has("paragraph-1")).toBe(false);
    expect(replaced?.decorations.find()).toHaveLength(0);
  });
});
