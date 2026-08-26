import { BlockNoteEditor } from "@blocknote/core";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

function selectText(editor: BlockNoteEditor, from = 1, to = 4) {
  editor.setTextCursorPosition("paragraph-0", "start");
  editor.transact((transaction) => {
    const start = transaction.selection.$from.start();
    transaction.setSelection(TextSelection.create(transaction.doc, start + from, start + to));
  });
  editor.focus();
}

function getEditorDom(editor: BlockNoteEditor): HTMLElement {
  const view = editor.prosemirrorView;
  if (!view) throw new Error("Expected the test editor to be mounted");
  return view.dom;
}

describe("NFM formatting-toolbar gesture ownership", () => {
  let editor: BlockNoteEditor;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    editor = BlockNoteEditor.create({
      initialContent: [{ id: "paragraph-0", type: "paragraph", content: "hello" }],
    });
    editor.mount(host);
    selectText(editor);
  });

  afterEach(() => {
    editor._tiptapEditor.destroy();
    host.remove();
  });

  test("settles ordinary pointer completion and cancellation", () => {
    const store = editor.getExtension(FormattingToolbarExtension)!.store;
    const editorDom = getEditorDom(editor);

    editorDom.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(store.state).toBe(false);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(store.state).toBe(true);

    editorDom.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    expect(store.state).toBe(true);
  });

  test("stays hidden through drag cancellation and settles on drag end", () => {
    const store = editor.getExtension(FormattingToolbarExtension)!.store;
    const editorDom = getEditorDom(editor);
    editorDom.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    editorDom.dispatchEvent(new Event("dragstart", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    expect(store.state).toBe(false);

    editorDom.dispatchEvent(new Event("dragend", { bubbles: true }));

    expect(store.state).toBe(true);
  });

  test("ignores drag gestures owned by an unrelated surface", () => {
    const store = editor.getExtension(FormattingToolbarExtension)!.store;
    const unrelatedSurface = document.createElement("div");
    document.body.append(unrelatedSurface);

    try {
      unrelatedSurface.dispatchEvent(new Event("dragstart", { bubbles: true }));
      unrelatedSurface.dispatchEvent(new Event("dragend", { bubbles: true }));

      expect(store.state).toBe(true);
    } finally {
      unrelatedSurface.remove();
    }
  });

  test("window blur and editor unmount clear transient presentation", () => {
    const formattingToolbar = editor.getExtension(FormattingToolbarExtension)!;
    window.dispatchEvent(new Event("blur"));
    expect(formattingToolbar.store.state).toBe(false);

    editor.unmount();
    expect(formattingToolbar.store.state).toBe(false);
  });

  test("nested editor focus and gestures cannot reopen the ancestor toolbar", () => {
    const outerStore = editor.getExtension(FormattingToolbarExtension)!.store;
    expect(outerStore.state).toBe(true);

    const innerHost = document.createElement("div");
    getEditorDom(editor).append(innerHost);
    const innerEditor = BlockNoteEditor.create({
      initialContent: [{ id: "inner-0", type: "paragraph", content: "inner" }],
    });
    innerEditor.mount(innerHost);
    try {
      innerEditor.setTextCursorPosition("inner-0", "start");
      innerEditor.focus();
      expect(outerStore.state).toBe(false);

      const innerEditorDom = getEditorDom(innerEditor);
      innerEditorDom.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      innerEditorDom.dispatchEvent(new Event("dragstart", { bubbles: true }));
      document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
      innerEditorDom.dispatchEvent(new Event("dragend", { bubbles: true }));
      expect(outerStore.state).toBe(false);
    } finally {
      innerEditor._tiptapEditor.destroy();
      innerHost.remove();
    }
  });
});
