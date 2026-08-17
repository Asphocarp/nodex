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
  requestScopeKey?: string,
  usedRequestScopeKey?: string,
) {
  const editorDOMElement = useEditorDOMElement();
  const pendingAcceptQuery = useRef<string | undefined>(undefined);
  const pendingAcceptScopeKey = useRef<string | undefined>(undefined);
  const getResolvedLiveQuery = useCallback(
    () => getLiveQuery?.() ?? query,
    [getLiveQuery, query],
  );
  const itemsFresh = useCallback(
    () => usedQuery !== undefined
      && usedQuery === getResolvedLiveQuery()
      && usedRequestScopeKey === requestScopeKey,
    [getResolvedLiveQuery, requestScopeKey, usedQuery, usedRequestScopeKey],
  );
  const markStaleAccept = useCallback(() => {
    pendingAcceptQuery.current = getResolvedLiveQuery();
    pendingAcceptScopeKey.current = requestScopeKey;
  }, [getResolvedLiveQuery, requestScopeKey]);
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
    if (
      liveQuery !== pendingQuery
      || usedRequestScopeKey !== pendingAcceptScopeKey.current
    ) {
      pendingAcceptQuery.current = undefined;
      pendingAcceptScopeKey.current = undefined;
      return;
    }

    if (usedQuery !== pendingQuery) {
      return;
    }

    pendingAcceptQuery.current = undefined;
    pendingAcceptScopeKey.current = undefined;
    if (items.length) {
      onItemClick?.(items[0]!);
    }
  }, [
    getResolvedLiveQuery,
    items,
    onItemClick,
    requestScopeKey,
    usedQuery,
    usedRequestScopeKey,
  ]);

  // Resets index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, requestScopeKey, setSelectedIndex]);

  return {
    selectedIndex: items.length === 0 ? undefined : selectedIndex,
  };
}
