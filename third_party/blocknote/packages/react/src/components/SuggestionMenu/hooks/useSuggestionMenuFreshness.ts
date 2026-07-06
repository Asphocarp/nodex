import { SuggestionMenu as SuggestionMenuExtension } from "@blocknote/core/extensions";
import { useCallback } from "react";
import { useExtension } from "../../../hooks/useExtension.js";

export function useSuggestionMenuFreshness({
  triggerCharacter,
  usedQuery,
}: {
  triggerCharacter: string;
  usedQuery: string | undefined;
}) {
  const suggestionMenu = useExtension(SuggestionMenuExtension);

  const getLiveQuery = useCallback(() => {
    const liveState = suggestionMenu.getMenuState?.();

    if (
      !liveState?.show ||
      liveState.triggerCharacter !== triggerCharacter
    ) {
      return undefined;
    }

    return liveState.query;
  }, [suggestionMenu, triggerCharacter]);

  const itemsFresh = useCallback(() => {
    const liveQuery = getLiveQuery();

    return (
      liveQuery !== undefined &&
      usedQuery !== undefined &&
      usedQuery === liveQuery
    );
  }, [getLiveQuery, usedQuery]);

  return { getLiveQuery, itemsFresh };
}
