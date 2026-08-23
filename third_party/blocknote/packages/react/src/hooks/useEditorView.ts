import type { BlockNoteEditor } from "@blocknote/core";
import { useCallback, useSyncExternalStore } from "react";

import { useBlockNoteContext } from "../editor/BlockNoteContext.js";

/**
 * Returns the mounted ProseMirror view and reacts to BlockNote mount cycles.
 *
 * A BlockNote editor can remain alive while its DOM view is absent. React UI
 * that reads layout, DOM nodes, or browser selection must acquire the view
 * through this hook rather than reading `editor.prosemirrorView` during render.
 */
export function useEditorView(editor?: BlockNoteEditor<any, any, any>) {
  const editorContext = useBlockNoteContext();
  const resolvedEditor = editor ?? editorContext?.editor;

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!resolvedEditor) return () => undefined;
      const unsubscribeMount = resolvedEditor.onMount(notify);
      const unsubscribeUnmount = resolvedEditor.onUnmount(notify);
      return () => {
        unsubscribeMount();
        unsubscribeUnmount();
      };
    },
    [resolvedEditor],
  );

  const getSnapshot = useCallback(
    () => resolvedEditor?.prosemirrorView,
    [resolvedEditor],
  );
  const getServerSnapshot = useCallback(() => undefined, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
