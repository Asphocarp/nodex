import type { EditorView } from "@tiptap/pm/view";

interface ProseMirrorShortcutEditor {
  readonly prosemirrorView?: EditorView;
}

interface ProseMirrorShortcutOptions {
  readonly key: string;
  readonly code?: string;
  readonly modKey?: boolean;
  readonly shiftKey?: boolean;
}

/** Routes a platform-correct keyboard shortcut through ProseMirror's keymap boundary. */
export function pressProseMirrorShortcut(
  editor: ProseMirrorShortcutEditor,
  options: ProseMirrorShortcutOptions,
): boolean {
  const view = editor.prosemirrorView;
  if (!view) throw new Error("Expected a mounted editor view");

  const applePlatform = /Mac|iP(?:hone|ad|od)/u.test(navigator.platform);
  const event = new KeyboardEvent("keydown", {
    key: options.key,
    code: options.code,
    ctrlKey: options.modKey === true && !applePlatform,
    metaKey: options.modKey === true && applePlatform,
    shiftKey: options.shiftKey,
  });
  return !!view.someProp("handleKeyDown", (handler) => handler(view, event));
}
