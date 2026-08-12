import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

function simulateTextInput(editor: BlockNoteEditor, text: string) {
  const view = editor.prosemirrorView;
  const { from, to } = view.state.selection;
  const defaultTransaction = () => view.state.tr.insertText(text, from, to);
  const handled = view.someProp("handleTextInput", (handler) =>
    handler(view, from, to, text, defaultTransaction),
  );

  if (!handled) {
    view.dispatch(defaultTransaction());
  }
}

function typeString(editor: BlockNoteEditor, text: string) {
  for (const character of text) {
    simulateTextInput(editor, character);
  }
}

function setCursorBefore(editor: BlockNoteEditor, character: string) {
  const view = editor.prosemirrorView;
  let position: number | undefined;

  view.state.doc.descendants((node, nodePosition) => {
    if (position !== undefined || !node.isText || node.text === undefined) {
      return;
    }

    const offset = node.text.indexOf(character);
    if (offset >= 0) {
      position = nodePosition + offset;
    }
  });

  if (position === undefined) {
    throw new Error(`Could not find ${character} in the editor document`);
  }

  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, position)),
  );
}

describe("inline code input rule", () => {
  let editor: BlockNoteEditor;
  const mount = document.createElement("div");

  beforeAll(() => {
    editor = BlockNoteEditor.create();
    editor.mount(mount);
  });

  afterAll(() => {
    editor._tiptapEditor.destroy();
  });

  beforeEach(() => {
    const document: PartialBlock[] = [
      {
        id: "test-paragraph",
        type: "paragraph",
        content: "",
      },
    ];
    editor.replaceBlocks(editor.document, document);
    editor.setTextCursorPosition("test-paragraph", "start");
  });

  it("keeps an adjacent-word backtick span literal without deleting its left neighbor", () => {
    typeString(editor, "123`456`");

    expect(editor.document[0].content).toEqual([
      { type: "text", text: "123`456`", styles: {} },
    ]);
  });

  it("formats a boundary-delimited span and preserves spaces inside it", () => {
    typeString(editor, "12 `34 56`");

    expect(editor.document[0].content).toEqual([
      { type: "text", text: "12 ", styles: {} },
      { type: "text", text: "34 56", styles: { code: true } },
    ]);
  });

  it("keeps a span with trailing whitespace inside the delimiters literal", () => {
    typeString(editor, "12 `34 56 `");

    expect(editor.document[0].content).toEqual([
      { type: "text", text: "12 `34 56 `", styles: {} },
    ]);
  });

  it("does not retroactively format a literal span when a later space is typed", () => {
    editor.replaceBlocks(editor.document, [
      {
        id: "test-paragraph",
        type: "paragraph",
        content: "12 `34 56 `",
      },
    ]);
    editor.setTextCursorPosition("test-paragraph", "end");

    simulateTextInput(editor, " ");

    expect(editor.document[0].content).toEqual([
      { type: "text", text: "12 `34 56 ` ", styles: {} },
    ]);
  });

  it("does not format before a non-boundary character", () => {
    editor.replaceBlocks(editor.document, [
      {
        id: "test-paragraph",
        type: "paragraph",
        content: "12 `codeX",
      },
    ]);
    setCursorBefore(editor, "X");

    simulateTextInput(editor, "`");

    expect(editor.document[0].content).toEqual([
      { type: "text", text: "12 `code`X", styles: {} },
    ]);
  });
});
