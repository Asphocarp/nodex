import { BlockNoteEditor } from "@blocknote/core";
import { useEditorView } from "./useEditorView.js";

// Returns the editor's DOM element reactively.
export function useEditorDOMElement(editor?: BlockNoteEditor<any, any, any>) {
  return useEditorView(editor)?.dom;
}
