import type { BrowserSidebarViewport } from "../../../shared/browser-sidebar";

export const BROWSER_DEVICE_TOOLBAR_HEIGHT = 34;
export const BROWSER_VIEWPORT_MIN_WIDTH = 240;
export const BROWSER_VIEWPORT_MIN_HEIGHT = 160;
export const BROWSER_VIEWPORT_MAX_DIMENSION = 4_096;
const FIXED_VIEWPORT_PADDING = 24;

export interface BrowserViewportLayoutInput {
  containerHeight: number;
  containerWidth: number;
  deviceToolbarVisible: boolean;
  composerReserve: number;
  viewport: BrowserSidebarViewport;
  windowZoom: number;
}

export interface BrowserViewportLayout {
  logicalHeight: number;
  logicalWidth: number;
  scale: number;
  visualHeight: number;
  visualWidth: number;
  x: number;
  y: number;
}

function clampDimension(
  value: number,
  minimum: number,
): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(
    BROWSER_VIEWPORT_MAX_DIMENSION,
    Math.max(minimum, Math.round(value)),
  );
}

export function computeBrowserViewportLayout(
  input: BrowserViewportLayoutInput,
): BrowserViewportLayout {
  const containerWidth = Math.max(0, input.containerWidth);
  const toolbarReserve = input.deviceToolbarVisible
    ? BROWSER_DEVICE_TOOLBAR_HEIGHT
    : 0;
  const containerHeight = Math.max(
    0,
    input.containerHeight - toolbarReserve - Math.max(0, input.composerReserve),
  );
  if (!input.deviceToolbarVisible) {
    return {
      logicalHeight: containerHeight,
      logicalWidth: containerWidth,
      scale: 1,
      visualHeight: containerHeight,
      visualWidth: containerWidth,
      x: 0,
      y: toolbarReserve,
    };
  }

  const logicalWidth = clampDimension(
    input.viewport.width,
    BROWSER_VIEWPORT_MIN_WIDTH,
  );
  const logicalHeight = clampDimension(
    input.viewport.height,
    BROWSER_VIEWPORT_MIN_HEIGHT,
  );
  const availableWidth = Math.max(1, containerWidth - FIXED_VIEWPORT_PADDING * 2);
  const availableHeight = Math.max(1, containerHeight - FIXED_VIEWPORT_PADDING * 2);
  const fitScale = Math.min(
    1,
    availableWidth / logicalWidth,
    availableHeight / logicalHeight,
  );
  const windowZoom = Number.isFinite(input.windowZoom) && input.windowZoom > 0
    ? input.windowZoom
    : 1;
  const scale = Math.max(0.01, fitScale / windowZoom);
  const visualWidth = logicalWidth * scale;
  const visualHeight = logicalHeight * scale;
  return {
    logicalHeight,
    logicalWidth,
    scale,
    visualHeight,
    visualWidth,
    x: Math.max(0, (containerWidth - visualWidth) / 2),
    y: toolbarReserve + Math.max(0, (containerHeight - visualHeight) / 2),
  };
}

export function browserViewportPointToLogical(
  layout: BrowserViewportLayout,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (point.x - layout.x) / layout.scale,
    y: (point.y - layout.y) / layout.scale,
  };
}
