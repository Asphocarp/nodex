import type { GlobalDictationDeclineReason } from "../../../../../shared/global-dictation";

/** A mounted composer may claim global dictation only while it is the user's actual edit target. */
export function resolveComposerGlobalDictationAdmission(input: {
  readonly floating: boolean;
  readonly visible: boolean;
  readonly expanded: boolean;
  readonly editor: HTMLElement | null;
}): GlobalDictationDeclineReason | null {
  if (input.floating && (!input.visible || !input.expanded)) return "hidden";
  const activeElement = input.editor?.ownerDocument.activeElement;
  if (
    !input.editor ||
    !activeElement ||
    (activeElement !== input.editor && !input.editor.contains(activeElement))
  ) {
    return "focus-not-owned";
  }
  return null;
}
