import { ShowSelectionExtension } from "@blocknote/core/extensions";
import { useExtension } from "@blocknote/react";
import { useEffect } from "react";

export function useNfmShowSelection(enabled: boolean, key: string) {
  const { showSelection } = useExtension(ShowSelectionExtension);

  useEffect(() => {
    showSelection(enabled, key);
    return () => showSelection(false, key);
  }, [enabled, key, showSelection]);
}
