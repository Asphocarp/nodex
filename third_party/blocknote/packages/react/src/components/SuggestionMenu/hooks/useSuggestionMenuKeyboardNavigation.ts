import { BlockNoteEditor } from "@blocknote/core";
import { useCallback, useEffect, useRef } from "react";
import { useEditorDOMElement } from "../../../hooks/useEditorDomElement.js";
import { useSuggestionMenuKeyboardHandler } from "./useSuggestionMenuKeyboardHandler.js";

// Hook which handles keyboard navigation of a suggestion menu. Up & down arrow
// keys are used to select a menu item, enter is used to execute it.
export function useSuggestionMenuKeyboardNavigation<Item>(
  _editor: BlockNoteEditor<any, any, any>,
  query: string,
  items: Item[],
  usedQuery: string | undefined,
  onItemClick?: (item: Item) => void,
  getLiveQuery?: () => string | undefined,
  element?: HTMLElement,
) {
  const editorDOMElement = useEditorDOMElement();
  const pendingAcceptQuery = useRef<string | undefined>(undefined);
  const getResolvedLiveQuery = useCallback(
    () => getLiveQuery?.() ?? query,
    [getLiveQuery, query],
  );
  const itemsFresh = useCallback(
    () => usedQuery !== undefined && usedQuery === getResolvedLiveQuery(),
    [getResolvedLiveQuery, usedQuery],
  );
  const markStaleAccept = useCallback(() => {
    pendingAcceptQuery.current = getResolvedLiveQuery();
  }, [getResolvedLiveQuery]);
  const { selectedIndex, setSelectedIndex, handler } =
    useSuggestionMenuKeyboardHandler(items, onItemClick, {
      itemsFresh,
      onStaleAccept: markStaleAccept,
    });

  useEffect(() => {
    const el = element || editorDOMElement;
    el?.addEventListener("keydown", handler, true);

    return () => {
      el?.removeEventListener("keydown", handler, true);
    };
  }, [editorDOMElement, items, selectedIndex, onItemClick, element, handler]);

  useEffect(() => {
    const pendingQuery = pendingAcceptQuery.current;
    if (pendingQuery === undefined) {
      return;
    }

    const liveQuery = getResolvedLiveQuery();
    if (liveQuery !== pendingQuery) {
      pendingAcceptQuery.current = undefined;
      return;
    }

    if (usedQuery !== pendingQuery) {
      return;
    }

    pendingAcceptQuery.current = undefined;
    if (items.length) {
      onItemClick?.(items[0]!);
    }
  }, [getResolvedLiveQuery, items, onItemClick, usedQuery]);

  // Resets index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, setSelectedIndex]);

  return {
    selectedIndex: items.length === 0 ? undefined : selectedIndex,
  };
}
