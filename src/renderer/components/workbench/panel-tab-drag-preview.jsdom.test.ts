import { describe, expect, test } from "vite-plus/test";
import { createPanelTabDragPreviewElement } from "./panel-tab-drag-preview";

describe("createPanelTabDragPreviewElement", () => {
  test("creates an inert measured preview without duplicating interactive tab identity", () => {
    const source = document.createElement("div");
    const surface = document.createElement("div");
    const label = document.createElement("button");
    const closeButton = document.createElement("button");

    surface.dataset.appShellTabSurface = "true";
    surface.dataset.tabId = "files";
    label.id = "tab-files";
    label.role = "tab";
    label.setAttribute("aria-controls", "panel-files");
    label.textContent = "files.ts";
    closeButton.dataset.appShellTabCloseButton = "true";
    closeButton.textContent = "Close";
    surface.append(label, closeButton);
    source.append(surface);
    surface.getBoundingClientRect = () => ({
      bottom: 40,
      height: 28,
      left: 20,
      right: 176,
      top: 12,
      width: 156,
      x: 20,
      y: 12,
      toJSON: () => undefined,
    });

    const preview = createPanelTabDragPreviewElement(source);

    expect(preview?.dataset.panelTabDragPreview).toBe("true");
    expect(preview?.getAttribute("aria-hidden")).toBe("true");
    expect(preview?.inert).toBe(true);
    expect(preview?.style.width).toBe("156px");
    expect(preview?.style.height).toBe("28px");
    expect(preview?.textContent).toBe("files.ts");
    expect(preview?.querySelector("[data-app-shell-tab-close-button]")).toBe(null);
    expect(preview?.querySelector("[id]")).toBe(null);
    expect(preview?.querySelector("[role]")).toBe(null);
    expect(preview?.querySelector("[data-tab-id]")).toBe(null);

    expect(source.querySelector("[data-app-shell-tab-close-button]")).toBe(closeButton);
    expect(source.querySelector("#tab-files")).toBe(label);
  });

  test("returns null when the draggable does not expose a tab surface", () => {
    expect(createPanelTabDragPreviewElement(document.createElement("div"))).toBe(null);
  });
});
