import { BlockNoteEditor, createExtension } from "@blocknote/core";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { act } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { selectCurrentBlockContent } from "./select-block-shortcut";

const selectAllShortcut = async (): Promise<void> => {
  const modifier = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Meta" : "Control";
  await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`);
};

const settleEditor = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
};

describe("progressive block select-all in Chromium", () => {
  test("selects the current inline block before the complete editor", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [
        { id: "alpha", type: "paragraph", content: "Alpha" },
        { id: "omega", type: "paragraph", content: "Omega" },
      ],
      extensions: [
        createExtension({
          key: "progressive-select-all-test",
          keyboardShortcuts: {
            "Mod-a": ({ editor }) => selectCurrentBlockContent(editor),
          },
        }),
      ],
    });
    const host = document.createElement("div");
    document.body.append(host);
    editor.mount(host);

    try {
      await act(settleEditor);
      await act(async () => {
        editor.setTextCursorPosition("alpha", "end");
        editor.focus();
        await selectAllShortcut();
      });

      expect(document.getSelection()?.toString()).toBe("Alpha");

      await act(async () => {
        await selectAllShortcut();
        await settleEditor();
      });

      expect(editor.prosemirrorState.selection).toBeInstanceOf(AllSelection);
      expect(document.getSelection()?.toString()).toContain("Alpha");
      expect(document.getSelection()?.toString()).toContain("Omega");
    } finally {
      editor.unmount();
      host.remove();
      editor._tiptapEditor.destroy();
    }
  });

  test("selects a plain-text Code Block before the complete editor", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [
        { id: "source", type: "codeBlock", content: "const answer = 42;" },
        { id: "after", type: "paragraph", content: "After" },
      ],
      extensions: [
        createExtension({
          key: "progressive-plain-select-all-test",
          keyboardShortcuts: {
            "Mod-a": ({ editor }) => selectCurrentBlockContent(editor),
          },
        }),
      ],
    });
    const host = document.createElement("div");
    document.body.append(host);
    editor.mount(host);

    try {
      await act(settleEditor);
      await act(async () => {
        editor.setTextCursorPosition("source", "end");
        editor.focus();
        await selectAllShortcut();
        await settleEditor();
      });

      const blockSelection = editor.prosemirrorState.selection;
      expect(blockSelection).toBeInstanceOf(TextSelection);
      expect(blockSelection.$from.parent.type.name).toBe("codeBlock");
      expect(blockSelection.from).toBe(blockSelection.$from.start());
      expect(blockSelection.to).toBe(blockSelection.$from.end());
      expect(editor.prosemirrorState.doc.textBetween(blockSelection.from, blockSelection.to)).toBe(
        "const answer = 42;",
      );

      await act(async () => {
        await selectAllShortcut();
        await settleEditor();
      });

      expect(editor.prosemirrorState.selection).toBeInstanceOf(AllSelection);
    } finally {
      editor.unmount();
      host.remove();
      editor._tiptapEditor.destroy();
    }
  });
});
