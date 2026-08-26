import { BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";
import type { SuggestionMenuCloseReason } from "@blocknote/core/extensions";
import { FC, useCallback, useEffect } from "react";

import { useBlockNoteContext } from "../../../editor/BlockNoteContext.js";
import { useBlockNoteEditor } from "../../../hooks/useBlockNoteEditor.js";
import { useCloseSuggestionMenuNoItems } from "../hooks/useCloseSuggestionMenuNoItems.js";
import { useLoadSuggestionMenuItems } from "../hooks/useLoadSuggestionMenuItems.js";
import { useSuggestionMenuFreshness } from "../hooks/useSuggestionMenuFreshness.js";
import { useGridSuggestionMenuKeyboardNavigation } from "./hooks/useGridSuggestionMenuKeyboardNavigation.js";
import { GridSuggestionMenuProps } from "./types.js";

export function GridSuggestionMenuWrapper<Item>(props: {
  triggerCharacter: string;
  query: string;
  closeMenu: (reason?: SuggestionMenuCloseReason) => void;
  clearQuery: () => void;
  getItems: (query: string) => Promise<Item[]>;
  columns: number;
  onItemClick?: (item: Item) => void;
  gridSuggestionMenuComponent: FC<GridSuggestionMenuProps<Item>>;
  isComposing?: boolean;
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
    gridSuggestionMenuComponent,
    triggerCharacter,
    query,
    clearQuery,
    closeMenu,
    onItemClick,
    columns,
    isComposing,
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

      closeMenu("accepted");
      clearQuery();
      onItemClick?.(item);
    },
    [onItemClick, closeMenu, clearQuery, itemsFresh],
  );

  useCloseSuggestionMenuNoItems(
    items,
    usedQuery,
    closeMenu,
    3,
    itemsFresh,
    true,
    true,
    isComposing,
  );

  const { selectedIndex } = useGridSuggestionMenuKeyboardNavigation(
    editor,
    query,
    items,
    columns,
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

  const Component = gridSuggestionMenuComponent;

  return (
    <Component
      items={items}
      onItemClick={onItemClickCloseMenu}
      loadingState={loadingState}
      itemsStale={!itemsFresh()}
      selectedIndex={selectedIndex}
      columns={columns}
    />
  );
}
