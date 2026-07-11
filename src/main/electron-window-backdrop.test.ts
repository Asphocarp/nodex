import { describe, expect, test } from "vitest";
import {
  CODEX_ELECTRON_OPAQUE_DARK_BACKGROUND_COLOR,
  CODEX_ELECTRON_OPAQUE_LIGHT_BACKGROUND_COLOR,
  CODEX_ELECTRON_TRANSPARENT_BACKGROUND_COLOR,
  resolveElectronWindowBackdrop,
  shouldUseOpaqueElectronWindowSurface,
} from "./electron-window-backdrop";

describe("electron window backdrop", () => {
  test("keeps focused small macOS windows transparent", () => {
    expect(
      shouldUseOpaqueElectronWindowSurface({
        bounds: { width: 1474, height: 1078 },
        isFocused: true,
        platform: "darwin",
        scaleFactor: 2,
      }),
    ).toBe(false);
  });

  test("uses opaque surfaces for large physical macOS windows", () => {
    expect(
      shouldUseOpaqueElectronWindowSurface({
        bounds: { width: 1920, height: 1080 },
        isFocused: true,
        platform: "darwin",
        scaleFactor: 2,
      }),
    ).toBe(true);
  });

  test("uses opaque surfaces for unfocused supported windows", () => {
    expect(
      shouldUseOpaqueElectronWindowSurface({
        bounds: { width: 1200, height: 800 },
        isFocused: false,
        platform: "darwin",
        scaleFactor: 2,
      }),
    ).toBe(true);
    expect(
      shouldUseOpaqueElectronWindowSurface({
        bounds: { width: 1200, height: 800 },
        isFocused: false,
        platform: "win32",
        scaleFactor: 1,
      }),
    ).toBe(true);
  });

  test("keeps focused small Windows windows transparent", () => {
    expect(
      shouldUseOpaqueElectronWindowSurface({
        bounds: { width: 1200, height: 800 },
        isFocused: true,
        platform: "win32",
        scaleFactor: 1,
      }),
    ).toBe(false);
  });

  test("resolves transparent and opaque native backdrop settings", () => {
    const transparentMac = resolveElectronWindowBackdrop({
      opaqueWindowSurfaceEnabled: false,
      platform: "darwin",
      prefersDarkColors: false,
    });
    expect(transparentMac.backgroundColor).toBe(CODEX_ELECTRON_TRANSPARENT_BACKGROUND_COLOR);
    expect(transparentMac.backgroundMaterial).toBe(null);
    expect(transparentMac.vibrancy).toBe("menu");

    const transparentWindows = resolveElectronWindowBackdrop({
      opaqueWindowSurfaceEnabled: false,
      platform: "win32",
      prefersDarkColors: false,
    });
    expect(transparentWindows.backgroundColor).toBe(CODEX_ELECTRON_TRANSPARENT_BACKGROUND_COLOR);
    expect(transparentWindows.backgroundMaterial).toBe("mica");
    expect(transparentWindows.vibrancy).toBe(null);

    const opaqueLight = resolveElectronWindowBackdrop({
      opaqueWindowSurfaceEnabled: true,
      platform: "darwin",
      prefersDarkColors: false,
    });
    expect(opaqueLight.backgroundColor).toBe(CODEX_ELECTRON_OPAQUE_LIGHT_BACKGROUND_COLOR);
    expect(opaqueLight.vibrancy).toBe(null);

    const opaqueDark = resolveElectronWindowBackdrop({
      opaqueWindowSurfaceEnabled: true,
      platform: "darwin",
      prefersDarkColors: true,
    });
    expect(opaqueDark.backgroundColor).toBe(CODEX_ELECTRON_OPAQUE_DARK_BACKGROUND_COLOR);
    expect(opaqueDark.vibrancy).toBe(null);
  });
});
