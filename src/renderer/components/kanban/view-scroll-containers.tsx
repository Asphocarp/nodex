import { forwardRef, type ReactNode } from "react";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";

export const KANBAN_BOARD_SCROLL_CONTAINER_TEST_ID = "kanban-board-scroll-container";
export const TOGGLE_LIST_SCROLL_CONTAINER_TEST_ID = "toggle-list-scroll-container";

export const KanbanBoardScrollContainer = forwardRef<HTMLDivElement, { children: ReactNode }>(
  function KanbanBoardScrollContainer({ children }, ref) {
    return (
      <div
        ref={ref}
        className="scrollbar-token min-h-0 flex-1 overflow-auto"
        data-testid={KANBAN_BOARD_SCROLL_CONTAINER_TEST_ID}
        style={RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE}
      >
        {children}
      </div>
    );
  },
);

export function ToggleListScrollContainer({ children }: { children: ReactNode }) {
  return (
    <div
      className="scrollbar-token h-full min-h-0 overflow-y-auto"
      data-testid={TOGGLE_LIST_SCROLL_CONTAINER_TEST_ID}
      style={RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE}
    >
      {children}
    </div>
  );
}
