import { describe, expect, test } from "vite-plus/test";
import {
  browserViewportPointToLogical,
  computeBrowserViewportLayout,
} from "./browser-viewport-layout";

function layout(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return computeBrowserViewportLayout({
    containerWidth: width,
    containerHeight: height,
    deviceToolbarVisible: true,
    composerReserve: 0,
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
      presetId: "responsive",
      zoomPercent: 100,
    },
    windowZoom: 1,
  });
}

describe("computeBrowserViewportLayout", () => {
  test("enforces 240x160 and 4096x4096 logical boundaries", () => {
    expect(layout(800, 700, 239, 159)).toMatchObject({
      logicalWidth: 240,
      logicalHeight: 160,
    });
    expect(layout(800, 700, 4_097, 4_097)).toMatchObject({
      logicalWidth: 4_096,
      logicalHeight: 4_096,
    });
  });

  test("fits fixed viewport within toolbar and composer reserves", () => {
    const result = computeBrowserViewportLayout({
      containerWidth: 460,
      containerHeight: 600,
      deviceToolbarVisible: true,
      composerReserve: 118,
      viewport: {
        width: 1_024,
        height: 768,
        presetId: "laptop",
        zoomPercent: 100,
      },
      windowZoom: 1,
    });
    expect(result.visualWidth).toBeLessThanOrEqual(460 - 48);
    expect(result.visualHeight).toBeLessThanOrEqual(600 - 34 - 118 - 48);
    expect(result.scale).toBeLessThan(1);
  });

  test.each([
    [240, 160],
    [459, 599],
    [460, 600],
  ])("keeps point transforms reversible at %sx%s", (width, height) => {
    const result = layout(width, height, 390, 844);
    const visualPoint = {
      x: result.x + 100 * result.scale,
      y: result.y + 200 * result.scale,
    };
    const logicalPoint = browserViewportPointToLogical(result, visualPoint);
    expect(logicalPoint.x).toBeCloseTo(100);
    expect(logicalPoint.y).toBeCloseTo(200);
  });

  test("accounts for window zoom without changing logical viewport", () => {
    const result = computeBrowserViewportLayout({
      containerWidth: 1_000,
      containerHeight: 800,
      deviceToolbarVisible: true,
      composerReserve: 0,
      viewport: {
        width: 820,
        height: 1_180,
        presetId: "ipad-air",
        zoomPercent: 100,
      },
      windowZoom: 1.25,
    });
    expect(result.logicalWidth).toBe(820);
    expect(result.logicalHeight).toBe(1_180);
    expect(result.visualWidth).toBeCloseTo(result.logicalWidth * result.scale);
  });
});
