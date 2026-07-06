import { BlockNoteEditor } from "@blocknote/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorDOMElement } from "../../../../hooks/useEditorDomElement.js";

// Hook which handles keyboard navigation of a grid suggestion menu. Arrow keys
// are used to select a menu item, enter is used to execute it.
export function useGridSuggestionMenuKeyboardNavigation<Item>(
  editor: BlockNoteEditor<any, any, any>,
  query: string,
  items: Item[],
  columns: number,
  usedQuery: string | undefined,
  onItemClick?: (item: Item) => void,
  getLiveQuery?: () => string | undefined,
) {
  const editorDOMElement = useEditorDOMElement(editor);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
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

  useEffect(() => {
    const handleMenuNavigationKeys = (event: KeyboardEvent) => {
      const canUseItems = itemsFresh();

      if (event.key === "ArrowLeft") {
        event.preventDefault();

        if (canUseItems && items.length) {
          setSelectedIndex((selectedIndex - 1 + items!.length) % items!.length);
        }
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();

        if (canUseItems && items.length) {
          setSelectedIndex((selectedIndex + 1 + items!.length) % items!.length);
        }
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();

        if (canUseItems && items.length) {
          setSelectedIndex(
            (selectedIndex - columns + items!.length) % items!.length,
          );
        }

        return true;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();

        if (canUseItems && items.length) {
          setSelectedIndex((selectedIndex + columns) % items!.length);
        }

        return true;
      }

      if (event.key === "Enter" && !event.isComposing) {
        event.stopPropagation();
        event.preventDefault();

        if (!canUseItems) {
          markStaleAccept();
          return true;
        }

        if (items.length) {
          onItemClick?.(items[selectedIndex]);
        }

        return true;
      }

      return false;
    };

    editorDOMElement?.addEventListener(
      "keydown",
      handleMenuNavigationKeys,
      true,
    );

    return () => {
      editorDOMElement?.removeEventListener(
        "keydown",
        handleMenuNavigationKeys,
        true,
      );
    };
  }, [
    columns,
    editorDOMElement,
    items,
    itemsFresh,
    markStaleAccept,
    onItemClick,
    selectedIndex,
  ]);

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
  }, [query]);

  return {
    selectedIndex: items.length === 0 ? undefined : selectedIndex,
  };
}
