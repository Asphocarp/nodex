import { describe, expect, test } from "vitest";
import {
  RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
} from "@/lib/right-panel-composer-overlay-reserve";
import {
  KANBAN_BOARD_SCROLL_CONTAINER_TEST_ID,
  KanbanBoardScrollContainer,
  TOGGLE_LIST_SCROLL_CONTAINER_TEST_ID,
  ToggleListScrollContainer,
} from "./view-scroll-containers";
import { render } from "../../test/dom";

describe("view scroll containers", () => {
  test("kanban wrapper provides bidirectional scroll semantics", () => {
    const { getByTestId } = render(
      <KanbanBoardScrollContainer>
        <div id="content" />
      </KanbanBoardScrollContainer>,
    );

    const wrapper = getByTestId(KANBAN_BOARD_SCROLL_CONTAINER_TEST_ID);
    expect(wrapper.style.scrollPaddingBottom).toBe(RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE);
  });

  test("toggle-list wrapper provides vertical scroll semantics", () => {
    const { getByTestId } = render(
      <ToggleListScrollContainer>
        <div id="content" />
      </ToggleListScrollContainer>,
    );

    const wrapper = getByTestId(TOGGLE_LIST_SCROLL_CONTAINER_TEST_ID);
    expect(wrapper.style.scrollPaddingBottom).toBe(RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE);
  });
});
