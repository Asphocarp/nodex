import type { NfmPopoverReference } from "./nfm-floating-popover";

export interface NfmSideMenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const NFM_SIDE_MENU_WIDTH = 265;
export const NFM_SIDE_MENU_GAP = 5;
export const NFM_SIDE_MENU_VIEWPORT_MARGIN = 12;
export const NFM_SIDE_MENU_MAX_HEIGHT_VH = 0.7;
export const NFM_SIDE_MENU_BLOCK_ANCHOR_OFFSET_X = 8;
export const NFM_SIDE_MENU_BLOCK_ANCHOR_WIDTH = 18;
export const NFM_SIDE_MENU_BLOCK_ANCHOR_MIN_HEIGHT = 24;
export const NFM_SIDE_MENU_BLOCK_ANCHOR_MAX_HEIGHT = 40;

function clamp(value: number, min: number, max: number) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toDOMRect(rect: NfmSideMenuRect) {
  return new DOMRect(rect.left, rect.top, rect.width, rect.height);
}

function cssEscape(value: string) {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/["\\]/g, "\\$&");
}

export function createNfmSideMenuStaticReference(rect: NfmSideMenuRect): NfmPopoverReference {
  const staticRect = toDOMRect(rect);
  return {
    element: undefined,
    getBoundingClientRect: () => staticRect,
  };
}

export function createNfmSideMenuElementReference(element: HTMLElement): NfmPopoverReference {
  return {
    element,
    cacheMountedBoundingClientRect: true,
  };
}

export function getNfmSideMenuBlockAnchorRect(blockElement: HTMLElement): DOMRect {
  const blockRect = blockElement.getBoundingClientRect();
  return new DOMRect(
    blockRect.left - NFM_SIDE_MENU_BLOCK_ANCHOR_OFFSET_X,
    blockRect.top,
    NFM_SIDE_MENU_BLOCK_ANCHOR_WIDTH,
    clamp(
      blockRect.height,
      NFM_SIDE_MENU_BLOCK_ANCHOR_MIN_HEIGHT,
      NFM_SIDE_MENU_BLOCK_ANCHOR_MAX_HEIGHT,
    ),
  );
}

export function createNfmSideMenuBlockReference(blockElement: HTMLElement): NfmPopoverReference {
  return {
    element: blockElement,
    cacheMountedBoundingClientRect: true,
    getBoundingClientRect: () => getNfmSideMenuBlockAnchorRect(blockElement),
  };
}

export function resolveNfmSideMenuBlockReference(
  root: ParentNode | null | undefined,
  blockId: string | null | undefined,
): NfmPopoverReference | null {
  if (!root || !blockId) return null;

  const blockElement = root.querySelector<HTMLElement>(
    `.bn-block[data-id="${cssEscape(blockId)}"]`,
  );
  if (!blockElement) return null;

  return createNfmSideMenuBlockReference(blockElement);
}

export function resolveNfmSideMenuReference({
  root,
  blockId,
  fallbackRect,
}: {
  root: ParentNode | null | undefined;
  blockId: string | null | undefined;
  fallbackRect?: NfmSideMenuRect | null;
}): NfmPopoverReference | null {
  return (
    resolveNfmSideMenuBlockReference(root, blockId) ??
    (fallbackRect ? createNfmSideMenuStaticReference(fallbackRect) : null)
  );
}
