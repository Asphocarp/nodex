const PANEL_TAB_SURFACE_SELECTOR = "[data-app-shell-tab-surface='true']";
const PANEL_TAB_CLOSE_BUTTON_SELECTOR = "[data-app-shell-tab-close-button='true']";

function removeClonedTabIdentity(element: HTMLElement): void {
  const identityElements = [
    element,
    ...element.querySelectorAll<HTMLElement>("[id], [role], [data-tab-id], [data-panel-tab-id]"),
  ];
  for (const identityElement of identityElements) {
    identityElement.removeAttribute("id");
    identityElement.removeAttribute("role");
    identityElement.removeAttribute("aria-controls");
    identityElement.removeAttribute("aria-selected");
    identityElement.removeAttribute("data-tab-id");
    identityElement.removeAttribute("data-panel-tab-id");
  }
}

export function createPanelTabDragPreviewElement(source: HTMLElement): HTMLElement | null {
  const surface = source.querySelector<HTMLElement>(PANEL_TAB_SURFACE_SELECTOR);
  if (!surface) return null;

  const rect = surface.getBoundingClientRect();
  const preview = source.ownerDocument.createElement("div");
  const surfaceClone = surface.cloneNode(true);
  if (!(surfaceClone instanceof HTMLElement)) return null;

  preview.dataset.panelTabDragPreview = "true";
  preview.setAttribute("aria-hidden", "true");
  preview.inert = true;
  preview.className =
    "pointer-events-none overflow-hidden rounded-lg border border-token-border bg-token-bg-primary opacity-70 shadow-lg";
  preview.style.boxSizing = "content-box";
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;

  surfaceClone.removeAttribute("data-app-shell-tab-surface");
  surfaceClone.querySelector(PANEL_TAB_CLOSE_BUTTON_SELECTOR)?.remove();
  removeClonedTabIdentity(surfaceClone);
  surfaceClone.style.backgroundColor = "transparent";
  preview.append(surfaceClone);

  return preview;
}
