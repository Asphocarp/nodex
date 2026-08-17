import { describe, expect, test } from "vitest";

import { createDatabaseListPageDragPreviewElement } from "./database-view-page-drag";

describe("Database View Page drag preview", () => {
  test("keeps List source presentation and adds a multi-Page count badge", () => {
    const source = document.createElement("div");
    source.style.boxShadow = "0 0 0 1px blue";
    source.textContent = "List Page";
    source.getBoundingClientRect = () => ({
      bottom: 56,
      height: 44,
      left: 12,
      right: 252,
      top: 12,
      width: 240,
      x: 12,
      y: 12,
      toJSON: () => undefined,
    });

    const preview = createDatabaseListPageDragPreviewElement({
      element: source,
      itemCount: 3,
    });
    const clone = preview.firstElementChild as HTMLElement;

    expect(clone.style.boxShadow).toBe("0 0 0 1px blue");
    expect(preview.lastElementChild?.textContent).toBe("3");
  });
});
