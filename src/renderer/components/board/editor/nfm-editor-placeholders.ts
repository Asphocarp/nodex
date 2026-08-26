export const NFM_QUOTE_PLACEHOLDER = "Empty quote";

export function createNfmEditorPlaceholders(defaultPlaceholder: string) {
  return {
    default: defaultPlaceholder,
    quote: NFM_QUOTE_PLACEHOLDER,
  };
}
