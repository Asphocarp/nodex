import { describe, expect, test } from "bun:test";
import {
  computeNfmSideMenuPosition,
  NFM_SIDE_MENU_GAP,
  NFM_SIDE_MENU_WIDTH,
} from "./nfm-side-menu-position";

describe("nfm side menu position", () => {
  test("places the menu to the left of the side-menu handle with a five pixel gap", () => {
    const position = computeNfmSideMenuPosition({
      anchorRect: {
        left: 338,
        top: 489.5,
        width: 18,
        height: 24,
      },
      menuHeight: 320,
      viewport: {
        width: 1200,
        height: 900,
      },
    });

    expect(position.left).toBe(338 - NFM_SIDE_MENU_WIDTH - NFM_SIDE_MENU_GAP);
    expect(position.top).toBe(489.5 + 12 - 160);
    expect(position.transformOrigin).toBe("50% right");
  });

  test("clamps to the viewport margin on small screens", () => {
    const position = computeNfmSideMenuPosition({
      anchorRect: {
        left: 80,
        top: 10,
        width: 18,
        height: 24,
      },
      menuHeight: 500,
      viewport: {
        width: 300,
        height: 400,
      },
    });

    expect(position.left).toBe(12);
    expect(position.top).toBe(12);
    expect(position.maxHeight).toBe(280);
  });
});
