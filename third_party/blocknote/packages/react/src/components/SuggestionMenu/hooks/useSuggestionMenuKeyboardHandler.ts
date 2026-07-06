import React, { useState } from "react";

// Hook which returns a handler for keyboard navigation of a suggestion menu. Up
// & down arrow keys are used to select an item, enter is used to execute it.
export function useSuggestionMenuKeyboardHandler<Item>(
  items: Item[],
  onItemClick?: (item: Item) => void,
  options: {
    itemsFresh?: () => boolean;
    onStaleAccept?: () => void;
  } = {},
) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  return {
    selectedIndex,
    setSelectedIndex,
    handler: (event: KeyboardEvent | React.KeyboardEvent) => {
      const itemsFresh = options.itemsFresh?.() ?? true;
      if (event.key === "ArrowUp") {
        event.preventDefault();

        if (itemsFresh && items.length) {
          setSelectedIndex((selectedIndex - 1 + items!.length) % items!.length);
        }

        return true;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();

        if (itemsFresh && items.length) {
          setSelectedIndex((selectedIndex + 1) % items!.length);
        }

        return true;
      }

      if (event.key === "PageUp") {
        event.preventDefault();

        if (itemsFresh && items.length) {
          setSelectedIndex(0);
        }

        return true;
      }

      if (event.key === "PageDown") {
        event.preventDefault();

        if (itemsFresh && items.length) {
          setSelectedIndex(items.length - 1);
        }

        return true;
      }

      const isComposing = isReactEvent(event)
        ? event.nativeEvent.isComposing
        : event.isComposing;
      if (event.key === "Enter" && !isComposing) {
        event.preventDefault();
        event.stopPropagation();

        if (!itemsFresh) {
          options.onStaleAccept?.();
          return true;
        }

        if (items.length) {
          onItemClick?.(items[selectedIndex]);
        }

        return true;
      }

      return false;
    },
  };
}

function isReactEvent(
  event: KeyboardEvent | React.KeyboardEvent,
): event is React.KeyboardEvent {
  return (event as React.KeyboardEvent).nativeEvent !== undefined;
}
