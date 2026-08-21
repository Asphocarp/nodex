export const CODEX_ELECTRON_OPAQUE_LONG_EDGE_PHYSICAL_PX = 3840;
export const CODEX_ELECTRON_OPAQUE_SHORT_EDGE_PHYSICAL_PX = 2160;
export const CODEX_ELECTRON_TRANSPARENT_BACKGROUND_COLOR = "#00000000";
export const CODEX_ELECTRON_OPAQUE_DARK_BACKGROUND_COLOR = "#000000";
export const CODEX_ELECTRON_OPAQUE_LIGHT_BACKGROUND_COLOR = "#f9f9f9";

export interface ElectronWindowBackdropBounds {
  width: number;
  height: number;
}

export interface ShouldUseOpaqueElectronWindowSurfaceInput {
  bounds: ElectronWindowBackdropBounds;
  forceOpaque?: boolean;
  isFocused: boolean;
  platform: NodeJS.Platform;
  scaleFactor: number;
}

export interface ResolveElectronWindowBackdropInput {
  opaqueWindowSurfaceEnabled: boolean;
  platform: NodeJS.Platform;
  prefersDarkColors: boolean;
}

export interface ElectronWindowBackdrop {
  backgroundColor: string;
  backgroundMaterial: "mica" | "none" | null;
  vibrancy: "menu" | null;
}

function supportsOpaqueSurface(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32";
}

export function shouldUseOpaqueElectronWindowSurface(
  input: ShouldUseOpaqueElectronWindowSurfaceInput,
): boolean {
  if (!supportsOpaqueSurface(input.platform)) return false;
  if (input.forceOpaque === true) return true;
  if (!input.isFocused) return true;
  if (input.platform !== "darwin") return false;

  const physicalWidth = input.bounds.width * input.scaleFactor;
  const physicalHeight = input.bounds.height * input.scaleFactor;
  const longEdge = Math.max(physicalWidth, physicalHeight);
  const shortEdge = Math.min(physicalWidth, physicalHeight);

  return (
    longEdge >= CODEX_ELECTRON_OPAQUE_LONG_EDGE_PHYSICAL_PX &&
    shortEdge >= CODEX_ELECTRON_OPAQUE_SHORT_EDGE_PHYSICAL_PX
  );
}

export function resolveElectronWindowBackdrop(
  input: ResolveElectronWindowBackdropInput,
): ElectronWindowBackdrop {
  if (input.opaqueWindowSurfaceEnabled) {
    return {
      backgroundColor: input.prefersDarkColors
        ? CODEX_ELECTRON_OPAQUE_DARK_BACKGROUND_COLOR
        : CODEX_ELECTRON_OPAQUE_LIGHT_BACKGROUND_COLOR,
      backgroundMaterial: input.platform === "win32" ? "none" : null,
      vibrancy: null,
    };
  }

  if (input.platform === "win32") {
    return {
      backgroundColor: CODEX_ELECTRON_TRANSPARENT_BACKGROUND_COLOR,
      backgroundMaterial: "mica",
      vibrancy: null,
    };
  }

  return {
    backgroundColor: CODEX_ELECTRON_TRANSPARENT_BACKGROUND_COLOR,
    backgroundMaterial: null,
    vibrancy: input.platform === "darwin" ? "menu" : null,
  };
}
