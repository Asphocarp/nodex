import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE,
  claimEditorSelectionSurface,
  clearActiveEditorSelectionSurface,
  EDITOR_SELECTION_SURFACE_ATTRIBUTE,
  releaseEditorSelectionSurface,
} from "./editor-selection-presentation";

const mounted: HTMLElement[] = [];

function createSurface(): HTMLElement {
  const surface = document.createElement("div");
  surface.setAttribute(EDITOR_SELECTION_SURFACE_ATTRIBUTE, "");
  document.body.append(surface);
  mounted.push(surface);
  return surface;
}

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
});

describe("editor selection presentation ownership", () => {
  test("repairs stale duplicate owners from the DOM root", () => {
    const staleSurface = createSurface();
    const nextSurface = createSurface();
    staleSurface.setAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE, "");
    nextSurface.setAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE, "");

    claimEditorSelectionSurface(nextSurface);

    expect(staleSurface.hasAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE)).toBe(false);
    expect(nextSurface.hasAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE)).toBe(true);
    expect(
      document.querySelectorAll(`[${ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE}]`),
    ).toHaveLength(1);
  });

  test("clears every owner and releases only the requested surface", () => {
    const firstSurface = createSurface();
    const secondSurface = createSurface();
    firstSurface.setAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE, "");
    secondSurface.setAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE, "");

    clearActiveEditorSelectionSurface(firstSurface);
    expect(
      document.querySelectorAll(`[${ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE}]`),
    ).toHaveLength(0);

    claimEditorSelectionSurface(secondSurface);
    releaseEditorSelectionSurface(firstSurface);
    expect(secondSurface.hasAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE)).toBe(true);
  });
});
