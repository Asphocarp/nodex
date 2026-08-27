import { Schema } from "@tiptap/pm/model";
import { AllSelection, EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, test } from "vite-plus/test";
import { selectCurrentBlockContent } from "./select-block-shortcut";

const pmSchema = new Schema({
  nodes: {
    doc: { content: "textBlock+" },
    textBlock: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});

function editorFor(contentType: string) {
  const doc = pmSchema.node("doc", null, [
    pmSchema.node("textBlock", null, pmSchema.text("Alpha")),
  ]);
  let state = EditorState.create({
    schema: pmSchema,
    doc,
    selection: TextSelection.create(doc, 3),
  });
  return {
    editor: {
      schema: { blockSchema: { editableBlock: { content: contentType } } },
      prosemirrorView: {
        get state() {
          return state;
        },
        dispatch(transaction: Transaction) {
          state = state.apply(transaction);
        },
      },
      getTextCursorPosition: () => ({ block: { id: "editable-1", type: "editableBlock" } }),
    },
    getState: () => state,
  };
}

describe("select block shortcut", () => {
  test.each(["inline", "plain"])(
    "progressively selects %s text content in the ProseMirror model",
    (contentType) => {
      const { editor, getState } = editorFor(contentType);
      const browserSelection = {} as Selection;

      expect(selectCurrentBlockContent(editor, browserSelection)).toBe(true);
      expect(getState().selection).toBeInstanceOf(TextSelection);
      expect(getState().selection.from).toBe(1);
      expect(getState().selection.to).toBe(6);

      expect(selectCurrentBlockContent(editor, browserSelection)).toBe(true);
      expect(getState().selection).toBeInstanceOf(AllSelection);
    },
  );

  test.each(["none", "table"])("leaves %s selection to its structural owner", (contentType) => {
    const { editor, getState } = editorFor(contentType);

    expect(selectCurrentBlockContent(editor, {} as Selection)).toBe(false);
    expect(getState().selection.empty).toBe(true);
  });
});
