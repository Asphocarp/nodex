import {
  modifyCurrentBlock,
  type ModifyShortcutActions,
  type ModifyShortcutEditor,
} from "./modify-block-shortcut";
import {
  resolveShortcutBlockId,
  type ThreadSectionCursorLookup,
} from "./thread-section";

export interface NfmEditorModEnterShortcutActions extends ModifyShortcutActions {
  sendThreadSectionByBlockId: (blockId: string) => boolean;
  showMissingThreadSectionHint: () => void;
}

export function handleNfmEditorModEnterShortcut(
  editor: ModifyShortcutEditor,
  actions: NfmEditorModEnterShortcutActions,
): boolean {
  if (modifyCurrentBlock(editor, actions)) return true;

  const cursorLookup: ThreadSectionCursorLookup = {
    getSelection: editor.getSelection
      ? () => ({ blocks: editor.getSelection?.()?.blocks ?? [] })
      : undefined,
    getTextCursorPosition: editor.getTextCursorPosition,
  };
  const blockId = resolveShortcutBlockId(cursorLookup);
  if (!blockId) {
    actions.showMissingThreadSectionHint();
    return true;
  }

  return actions.sendThreadSectionByBlockId(blockId);
}
