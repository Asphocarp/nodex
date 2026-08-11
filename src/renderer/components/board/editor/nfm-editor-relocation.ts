export interface NfmEditorMutationRuntime {
  readonly isFocused?: () => boolean;
  readonly isWithinEditor?: (element: Element) => boolean;
  readonly blur?: () => void;
}

export const prepareNfmEditorForMutation = async (
  editor: NfmEditorMutationRuntime,
  container: HTMLElement,
): Promise<void> => {
  const activeElement = container.ownerDocument.activeElement;
  const ownsFocus =
    activeElement instanceof Element &&
    (container.contains(activeElement) ||
      editor.isWithinEditor?.(activeElement) === true);
  if (ownsFocus && activeElement instanceof HTMLElement) activeElement.blur();
  if (ownsFocus || editor.isFocused?.()) editor.blur?.();
  await Promise.resolve();
};
