import { BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";
import type { SuggestionMenuCloseReason } from "@blocknote/core/extensions";
import { FC, useCallback, useEffect } from "react";

import { useBlockNoteContext } from "../../editor/BlockNoteContext.js";
import { useBlockNoteEditor } from "../../hooks/useBlockNoteEditor.js";
import { useCloseSuggestionMenuNoItems } from "./hooks/useCloseSuggestionMenuNoItems.js";
import { useLoadSuggestionMenuItems } from "./hooks/useLoadSuggestionMenuItems.js";
import { useSuggestionMenuFreshness } from "./hooks/useSuggestionMenuFreshness.js";
import { useSuggestionMenuKeyboardNavigation } from "./hooks/useSuggestionMenuKeyboardNavigation.js";
import { SuggestionMenuProps } from "./types.js";

export function SuggestionMenuWrapper<Item>(props: {
  triggerCharacter: string;
  query: string;
  closeMenu: (reason?: SuggestionMenuCloseReason) => void;
  acceptMenu: () => boolean;
  getItems: (query: string) => Promise<Item[]>;
  getImmediateItems?: (query: string) => Item[];
  requestScopeKey?: string;
  onItemClick?: (item: Item) => void;
  shouldCloseOnItemClick?: (item: Item) => boolean;
  autoCloseWhenNoItems?: boolean;
  shouldCloseOnQuery?: (query: string) => boolean;
  isComposing?: boolean;
  suggestionMenuComponent: FC<SuggestionMenuProps<Item>>;
}) {
  const ctx = useBlockNoteContext();
  const setContentEditableProps = ctx!.setContentEditableProps!;
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >();

  const {
    getItems,
    getImmediateItems,
    requestScopeKey,
    suggestionMenuComponent,
    triggerCharacter,
    query,
    acceptMenu,
    closeMenu,
    onItemClick,
    shouldCloseOnItemClick,
    autoCloseWhenNoItems,
    shouldCloseOnQuery,
    isComposing,
  } = props;

  const { items, usedQuery, usedRequestScopeKey, loadingState } = useLoadSuggestionMenuItems(
    query,
    getItems,
    getImmediateItems,
    requestScopeKey,
  );
  const { getLiveQuery, itemsFresh } = useSuggestionMenuFreshness({
    triggerCharacter,
    usedQuery,
    requestScopeKey,
    usedRequestScopeKey,
  });

  const onItemClickCloseMenu = useCallback(
    (item: Item) => {
      if (!itemsFresh()) {
        return;
      }

      if (shouldCloseOnItemClick?.(item) !== false) {
        if (!acceptMenu()) return;
      }
      onItemClick?.(item);
    },
    [acceptMenu, itemsFresh, onItemClick, shouldCloseOnItemClick],
  );

  useCloseSuggestionMenuNoItems(
    items,
    usedQuery,
    closeMenu,
    3,
    itemsFresh,
    autoCloseWhenNoItems,
    loadingState === "loaded",
    isComposing,
  );

  useEffect(() => {
    if (isComposing || !shouldCloseOnQuery?.(query)) return;
    closeMenu("invalid-query");
  }, [closeMenu, isComposing, query, shouldCloseOnQuery]);

  const { selectedIndex } = useSuggestionMenuKeyboardNavigation(
    editor,
    query,
    items,
    usedQuery,
    onItemClickCloseMenu,
    getLiveQuery,
    undefined,
    requestScopeKey,
    usedRequestScopeKey,
  );

  // set basic aria attributes when the menu is open
  useEffect(() => {
    setContentEditableProps((p) => ({
      ...p,
      "aria-expanded": true,
      "aria-controls": "bn-suggestion-menu",
    }));
    return () => {
      setContentEditableProps((p) => ({
        ...p,
        "aria-expanded": false,
        "aria-controls": undefined,
      }));
    };
  }, [setContentEditableProps]);

  // set selected item (activedescendent) attributes when selected item changes
  useEffect(() => {
    setContentEditableProps((p) => ({
      ...p,
      "aria-activedescendant": selectedIndex
        ? "bn-suggestion-menu-item-" + selectedIndex
        : undefined,
    }));
    return () => {
      setContentEditableProps((p) => ({
        ...p,
        "aria-activedescendant": undefined,
      }));
    };
  }, [setContentEditableProps, selectedIndex]);

  const Component = suggestionMenuComponent;

  return (
    <Component
      items={items}
      onItemClick={onItemClickCloseMenu}
      loadingState={loadingState}
      itemsStale={!itemsFresh()}
      selectedIndex={selectedIndex}
    />
  );
}
