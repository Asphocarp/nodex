export interface NfmSideMenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NfmSideMenuViewport {
  width: number;
  height: number;
}

export interface NfmSideMenuPositionInput {
  anchorRect: NfmSideMenuRect;
  menuWidth?: number;
  menuHeight?: number;
  viewport: NfmSideMenuViewport;
  gap?: number;
  margin?: number;
}

export interface NfmSideMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
  transformOrigin: string;
}

export const NFM_SIDE_MENU_WIDTH = 265;
export const NFM_SIDE_MENU_MIN_WIDTH = 180;
export const NFM_SIDE_MENU_GAP = 5;
export const NFM_SIDE_MENU_VIEWPORT_MARGIN = 12;
export const NFM_SIDE_MENU_MAX_HEIGHT_VH = 0.7;

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function computeNfmSideMenuPosition({
  anchorRect,
  menuWidth = NFM_SIDE_MENU_WIDTH,
  menuHeight,
  viewport,
  gap = NFM_SIDE_MENU_GAP,
  margin = NFM_SIDE_MENU_VIEWPORT_MARGIN,
}: NfmSideMenuPositionInput): NfmSideMenuPosition {
  const maxHeight = Math.max(0, viewport.height * NFM_SIDE_MENU_MAX_HEIGHT_VH);
  const effectiveMenuHeight = Math.min(menuHeight ?? maxHeight, maxHeight);
  const unclampedLeft = anchorRect.left - menuWidth - gap;
  const unclampedTop = anchorRect.top + (anchorRect.height / 2) - (effectiveMenuHeight / 2);
  const left = clamp(unclampedLeft, margin, viewport.width - margin - menuWidth);
  const top = clamp(unclampedTop, margin, viewport.height - margin - effectiveMenuHeight);

  return {
    left,
    top,
    maxHeight,
    transformOrigin: "50% right",
  };
}
