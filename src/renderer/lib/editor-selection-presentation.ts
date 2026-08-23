import { NESTED_EDITOR_EVENT_BOUNDARY_ATTRIBUTE } from "@blocknote/core";

export const EDITOR_SELECTION_SURFACE_ATTRIBUTE = "data-nodex-editor-selection-surface";
export const ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE =
  "data-nodex-active-editor-selection-surface";
export const EMBEDDED_EDITOR_SELECTION_CONTEXT_ATTRIBUTE =
  "data-nodex-embedded-editor-selection-context";

export const embeddedEditorSelectionContextAttributes = {
  [EMBEDDED_EDITOR_SELECTION_CONTEXT_ATTRIBUTE]: "",
  [NESTED_EDITOR_EVENT_BOUNDARY_ATTRIBUTE]: "",
} as const;

const ACTIVE_EDITOR_SELECTION_SURFACE_SELECTOR = `[${ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE}]`;

function surfaceRoot(surface: HTMLElement): Node {
  return surface.getRootNode();
}

function activeSurfaces(root: Node): HTMLElement[] {
  if (!("querySelectorAll" in root)) return [];
  const descendants = Array.from(
    (root as ParentNode).querySelectorAll<HTMLElement>(ACTIVE_EDITOR_SELECTION_SURFACE_SELECTOR),
  );
  if (!(root instanceof HTMLElement)) return descendants;
  if (!root.hasAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE)) return descendants;
  return [root, ...descendants];
}

/** Makes one editor the sole owner of Block-selection presentation in its DOM root. */
export function claimEditorSelectionSurface(surface: HTMLElement): void {
  const root = surfaceRoot(surface);
  for (const activeSurface of activeSurfaces(root)) {
    if (activeSurface === surface) continue;
    activeSurface.removeAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE);
  }
  surface.setAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE, "");
}

/** Clears ownership when interaction enters a non-editor part of an embedded surface. */
export function clearActiveEditorSelectionSurface(reference: HTMLElement): void {
  for (const activeSurface of activeSurfaces(surfaceRoot(reference))) {
    activeSurface.removeAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE);
  }
}

/** Releases a mounted editor without disturbing a newer active surface. */
export function releaseEditorSelectionSurface(surface: HTMLElement): void {
  surface.removeAttribute(ACTIVE_EDITOR_SELECTION_SURFACE_ATTRIBUTE);
}
