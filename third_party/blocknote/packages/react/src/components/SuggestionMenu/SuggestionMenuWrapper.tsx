import { BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";
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
  closeMenu: () => void;
  clearQuery: () => void;
  getItems: (query: string) => Promise<Item[]>;
  onItemClick?: (item: Item) => void;
  shouldCloseOnItemClick?: (item: Item) => boolean;
  autoCloseWhenNoItems?: boolean;
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
    suggestionMenuComponent,
    triggerCharacter,
    query,
    clearQuery,
    closeMenu,
    onItemClick,
    shouldCloseOnItemClick,
    autoCloseWhenNoItems,
  } = props;

  const { items, usedQuery, loadingState } = useLoadSuggestionMenuItems(
    query,
    getItems,
  );
  const { getLiveQuery, itemsFresh } = useSuggestionMenuFreshness({
    triggerCharacter,
    usedQuery,
  });

  const onItemClickCloseMenu = useCallback(
    (item: Item) => {
      if (!itemsFresh()) {
        return;
      }

      if (shouldCloseOnItemClick?.(item) !== false) {
        closeMenu();
        clearQuery();
      }
      onItemClick?.(item);
    },
    [onItemClick, closeMenu, clearQuery, itemsFresh, shouldCloseOnItemClick],
  );

  useCloseSuggestionMenuNoItems(
    items,
    usedQuery,
    closeMenu,
    3,
    itemsFresh,
    autoCloseWhenNoItems,
  );

  const { selectedIndex } = useSuggestionMenuKeyboardNavigation(
    editor,
    query,
    items,
    usedQuery,
    onItemClickCloseMenu,
    getLiveQuery,
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
