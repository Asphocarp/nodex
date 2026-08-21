export const CODEX_TOOLBAR_HEIGHT_PX = 46;
export const CODEX_TRAFFIC_LIGHT_CONTROL_SIZE_PX = 14;
export const CODEX_TRAFFIC_LIGHT_X_PX = 16;
export const CODEX_WINDOWS_TITLEBAR_OVERLAY_HEIGHT_PX = 36;
export const CODEX_TITLEBAR_OVERLAY_COLOR = "#00000000";
export const CODEX_TITLEBAR_OVERLAY_DARK_SYMBOL_COLOR = "#ffffff";
export const CODEX_TITLEBAR_OVERLAY_LIGHT_SYMBOL_COLOR = "#1f1f1f";

export interface CodexTrafficLightPosition {
  x: number;
  y: number;
}

export interface CodexTitleBarOverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}

export type CodexTitleBarOptions =
  | {
      titleBarStyle: "hiddenInset";
      trafficLightPosition: CodexTrafficLightPosition;
    }
  | {
      titleBarStyle: "hidden";
      titleBarOverlay: CodexTitleBarOverlayOptions;
    }
  | {
      titleBarStyle: "default";
    };

export function resolveCodexTrafficLightPosition(windowZoom = 1): CodexTrafficLightPosition {
  return {
    x: CODEX_TRAFFIC_LIGHT_X_PX,
    y: Math.round((CODEX_TOOLBAR_HEIGHT_PX * windowZoom - CODEX_TRAFFIC_LIGHT_CONTROL_SIZE_PX) / 2),
  };
}

export function resolveCodexTitleBarOverlay(
  windowZoom = 1,
  isDark = false,
): CodexTitleBarOverlayOptions {
  return {
    color: CODEX_TITLEBAR_OVERLAY_COLOR,
    symbolColor: isDark
      ? CODEX_TITLEBAR_OVERLAY_DARK_SYMBOL_COLOR
      : CODEX_TITLEBAR_OVERLAY_LIGHT_SYMBOL_COLOR,
    height: Math.round(CODEX_WINDOWS_TITLEBAR_OVERLAY_HEIGHT_PX * windowZoom),
  };
}

export function resolveCodexTitleBarOptions({
  platform,
  windowZoom = 1,
  isDark = false,
}: {
  platform: NodeJS.Platform;
  windowZoom?: number;
  isDark?: boolean;
}): CodexTitleBarOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: resolveCodexTrafficLightPosition(windowZoom),
    };
  }

  if (platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: resolveCodexTitleBarOverlay(windowZoom, isDark),
    };
  }

  return {
    titleBarStyle: "default",
  };
}
