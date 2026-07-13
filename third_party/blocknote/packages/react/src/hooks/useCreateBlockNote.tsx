import {
  BlockNoteEditor,
  BlockNoteEditorOptions,
  CustomBlockNoteSchema,
  DefaultBlockSchema,
  DefaultInlineContentSchema,
  DefaultStyleSchema,
} from "@blocknote/core";
import { DependencyList, useEffect, useMemo } from "react";

interface EditorRetention {
  count: number;
  generation: number;
}

const editorRetentions = new WeakMap<
  BlockNoteEditor<any, any, any>,
  EditorRetention
>();

function retainEditor(editor: BlockNoteEditor<any, any, any>): () => void {
  const retention = editorRetentions.get(editor) ?? {
    count: 0,
    generation: 0,
  };
  retention.count += 1;
  editorRetentions.set(editor, retention);

  return () => {
    retention.count = Math.max(0, retention.count - 1);
    retention.generation += 1;
    const releaseGeneration = retention.generation;
    queueMicrotask(() => {
      if (retention.count !== 0) return;
      if (retention.generation !== releaseGeneration) return;
      editor._tiptapEditor.destroy();
      editorRetentions.delete(editor);
    });
  };
}

/**
 * Hook to instantiate a BlockNote Editor instance in React
 */
export const useCreateBlockNote = <
  Options extends Partial<BlockNoteEditorOptions<any, any, any>> | undefined,
>(
  options: Options = {} as Options,
  deps: DependencyList = [],
): Options extends {
  schema: CustomBlockNoteSchema<infer BSchema, infer ISchema, infer SSchema>;
}
  ? BlockNoteEditor<BSchema, ISchema, SSchema>
  : BlockNoteEditor<
      DefaultBlockSchema,
      DefaultInlineContentSchema,
      DefaultStyleSchema
    > => {
  const editor = useMemo(() => {
    const editor = BlockNoteEditor.create(options) as any;
    if (window) {
      // for testing / dev purposes
      (window as any).ProseMirror = editor._tiptapEditor;
    }
    return editor;
  }, deps); //eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => retainEditor(editor), [editor]);

  return editor;
};
