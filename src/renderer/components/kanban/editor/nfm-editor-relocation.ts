export interface NfmEditorRelocationRuntime {
  readonly isFocused?: () => boolean;
  readonly isWithinEditor?: (element: Element) => boolean;
  readonly blur?: () => void;
  isEditable?: boolean;
}

export const prepareNfmEditorForRelocation = async (
  editor: NfmEditorRelocationRuntime,
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
  editor.isEditable = false;
  await Promise.resolve();
};

export const applyNfmEditorWriteFence = (
  editor: NfmEditorRelocationRuntime,
  frozen: boolean,
): void => {
  editor.isEditable = !frozen;
};
