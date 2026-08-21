import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("electron", () => ({
  desktopCapturer: { getSources: async () => [] },
  screen: { getDisplayMatching: () => ({ scaleFactor: 2 }) },
}));

const {
  createComposerAppshotImageName,
  findComposerAppshotSource,
  parseComposerAppshotHelperTarget,
  resolveComposerAppshotCaptureSize,
  resolveComposerAppshotWindowTitle,
} = await import("./composer-appshot-platform");

const externalTarget = {
  name: "Safari",
  bundleIdentifier: "com.apple.Safari",
  processIdentifier: 99,
  windowId: 42,
  windowTitle: "Nodex",
  bounds: { x: 10, y: 20, width: 800, height: 600 },
  axTree: "AXWindow title=Nodex\n  AXButton title=Continue",
} as const;

describe("composer Appshot platform policy", () => {
  test("validates helper output at the native boundary", () => {
    expect(parseComposerAppshotHelperTarget(externalTarget)).toEqual(externalTarget);
    expect(
      parseComposerAppshotHelperTarget({ ...externalTarget, bundleIdentifier: "" }),
    ).toBeNull();
    expect(
      parseComposerAppshotHelperTarget({
        ...externalTarget,
        bounds: { ...externalTarget.bounds, width: 0 },
      }),
    ).toBeNull();
    expect(parseComposerAppshotHelperTarget({ ...externalTarget, windowId: 1.5 })).toBeNull();
  });

  test("matches stable source identity before title fallback", () => {
    const exact = { id: "window:42:9", name: "Different title" };
    const titleFallback = { id: "window:8:9", name: "Nodex" };
    expect(findComposerAppshotSource([titleFallback, exact], externalTarget)).toBe(exact);
    expect(findComposerAppshotSource([titleFallback], externalTarget)).toBe(titleFallback);
  });

  test("bounds high-density captures without changing aspect ratio", () => {
    expect(
      resolveComposerAppshotCaptureSize({ bounds: externalTarget.bounds, scaleFactor: 2 }),
    ).toEqual({ width: 1600, height: 1200 });
    expect(
      resolveComposerAppshotCaptureSize({
        bounds: { ...externalTarget.bounds, width: 5000, height: 2500 },
        scaleFactor: 2,
      }),
    ).toEqual({ width: 4096, height: 2048 });
  });

  test("derives prompt and file names from validated target data", () => {
    expect(
      resolveComposerAppshotWindowTitle({
        axTree: 'Window: "Current tab", App: Safari\nAXWindow',
        fallback: "Stale CG title",
      }),
    ).toBe("Current tab");
    expect(
      resolveComposerAppshotWindowTitle({
        axTree: "AXWindow title=Current tab",
        fallback: "CG title",
      }),
    ).toBe("CG title");
    expect(createComposerAppshotImageName("Safari/Preview", 0)).toBe(
      "Safari-Preview Appshot 1970-01-01T00-00-00.000Z.png",
    );
  });
});
