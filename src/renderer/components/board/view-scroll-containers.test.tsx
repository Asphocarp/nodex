import { describe, expect, test } from "vitest";
import {
  RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
} from "@/lib/right-panel-composer-overlay-reserve";
import {
  BOARD_SCROLL_CONTAINER_TEST_ID,
  BoardScrollContainer,
  TOGGLE_LIST_SCROLL_CONTAINER_TEST_ID,
  ToggleListScrollContainer,
} from "./view-scroll-containers";
import { render } from "../../test/dom";

describe("view scroll containers", () => {
  test("board wrapper provides bidirectional scroll semantics", () => {
    const { getByTestId } = render(
      <BoardScrollContainer>
        <div id="content" />
      </BoardScrollContainer>,
    );

    const wrapper = getByTestId(BOARD_SCROLL_CONTAINER_TEST_ID);
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
