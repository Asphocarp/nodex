import { describe, expect, test, vi } from "vitest";
import type { DesktopCapturerSource } from "electron";
import type { ComposerAppshotServiceDependencies } from "./composer-appshot-service";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/repo",
    isPackaged: false,
  },
  desktopCapturer: {
    getSources: async () => [],
  },
  screen: {
    getDisplayMatching: () => ({ scaleFactor: 2 }),
  },
}));

const {
  ComposerAppshotService,
  findComposerAppshotSource,
  parseComposerAppshotHelperTarget,
  resolveComposerAppshotCaptureSize,
  resolveComposerAppshotWindowTitle,
} = await import("./composer-appshot-service");

const externalTarget = {
  name: "Safari",
  bundleIdentifier: "com.apple.Safari",
  processIdentifier: 99,
  windowId: 42,
  windowTitle: "Nodex",
  bounds: {
    x: 10,
    y: 20,
    width: 800,
    height: 600,
  },
  axTree: "AXWindow title=Nodex\n  AXButton title=Continue",
} as const;

function fakeImage(dataUrl: string, empty = false) {
  return {
    isEmpty: () => empty,
    resize: () => fakeImage(dataUrl, empty),
    toDataURL: () => dataUrl,
  };
}

function fakeSource(input: {
  readonly id?: string;
  readonly name?: string;
  readonly thumbnail?: ReturnType<typeof fakeImage>;
  readonly appIcon?: ReturnType<typeof fakeImage> | null;
} = {}): DesktopCapturerSource {
  return {
    id: input.id ?? "window:42:0",
    name: input.name ?? "Nodex",
    thumbnail: input.thumbnail ?? fakeImage("data:image/png;base64,d2luZG93"),
    appIcon: input.appIcon === undefined
      ? fakeImage("data:image/png;base64,aWNvbg==")
      : input.appIcon,
    display_id: "",
  } as unknown as DesktopCapturerSource;
}

function createDependencies(
  overrides: Partial<ComposerAppshotServiceDependencies> = {},
): ComposerAppshotServiceDependencies {
  let id = 0;
  const inertTimer = {
    unref: () => inertTimer,
  } as unknown as NodeJS.Timeout;
  return {
    platform: "darwin",
    processIdentifier: 7,
    helperAvailable: () => true,
    readFrontmostWindow: async () => externalTarget,
    listWindowSources: async () => [fakeSource()],
    displayScaleFactor: () => 2,
    createId: () => `id-${++id}`,
    scheduleInterval: () => inertTimer,
    scheduleTimeout: () => inertTimer,
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    ...overrides,
  };
}

describe("composer Appshot service", () => {
  test("validates helper output at the main-process boundary", () => {
    expect(parseComposerAppshotHelperTarget(externalTarget)).toEqual(
      externalTarget,
    );
    expect(parseComposerAppshotHelperTarget({
      ...externalTarget,
      bundleIdentifier: "",
    })).toBeNull();
    expect(parseComposerAppshotHelperTarget({
      ...externalTarget,
      bounds: { ...externalTarget.bounds, width: 0 },
    })).toBeNull();
    expect(parseComposerAppshotHelperTarget({
      ...externalTarget,
      windowId: 1.5,
    })).toBeNull();
  });

  test("matches the stable Electron window source id before title fallback", () => {
    const exact = { id: "window:42:9", name: "Different title" };
    const titleFallback = { id: "window:8:9", name: "Nodex" };
    expect(findComposerAppshotSource(
      [titleFallback, exact],
      externalTarget,
    )).toBe(exact);
    expect(findComposerAppshotSource(
      [titleFallback],
      externalTarget,
    )).toBe(titleFallback);
  });

  test("preserves aspect ratio while bounding high-density captures", () => {
    expect(resolveComposerAppshotCaptureSize({
      bounds: externalTarget.bounds,
      scaleFactor: 2,
    })).toEqual({ width: 1600, height: 1200 });
    expect(resolveComposerAppshotCaptureSize({
      bounds: { ...externalTarget.bounds, width: 5000, height: 2500 },
      scaleFactor: 2,
    })).toEqual({ width: 4096, height: 2048 });
  });

  test("prefers the accessibility window header used by prompt serialization", () => {
    expect(resolveComposerAppshotWindowTitle({
      axTree: "Window: \"Current tab\", App: Safari\nAXWindow",
      fallback: "Stale CG title",
    })).toBe("Current tab");
    expect(resolveComposerAppshotWindowTitle({
      axTree: "AXWindow title=Current tab",
      fallback: "CG title",
    })).toBe("CG title");
    expect(resolveComposerAppshotWindowTitle({
      axTree: "Window: \"\", App: Safari",
      fallback: null,
    })).toBeNull();
  });

  test("captures screenshot, accessibility tree, identity, and app icon together", async () => {
    const sourceRequests: Array<{ width: number; height: number }> = [];
    const service = new ComposerAppshotService(createDependencies({
      listWindowSources: async (thumbnailSize) => {
        sourceRequests.push({ ...thumbnailSize });
        return [fakeSource()];
      },
    }));

    const targetResult = await service.readTarget();
    expect(targetResult).toEqual({
      available: true,
      target: {
        id: "id-1",
        appName: "Safari",
        bundleIdentifier: "com.apple.Safari",
        windowTitle: "Nodex",
        iconSmallDataUrl: "data:image/png;base64,aWNvbg==",
      },
    });
    if (!targetResult.target) throw new Error("Expected Appshot target");

    const context = await service.capture(targetResult.target.id);
    expect(sourceRequests).toEqual([
      { width: 0, height: 0 },
      { width: 1600, height: 1200 },
    ]);
    expect(context).toMatchObject({
      id: "id-2",
      appName: "Safari",
      bundleIdentifier: "com.apple.Safari",
      windowTitle: "Nodex",
      axTree: externalTarget.axTree,
      imageDataUrl: "data:image/png;base64,d2luZG93",
      appIconDataUrl: "data:image/png;base64,aWNvbg==",
    });
    expect(context.imageName).toMatch(/^Safari Appshot .+\.png$/u);
  });

  test("retains the last external window while Nodex itself is frontmost", async () => {
    let readCount = 0;
    const service = new ComposerAppshotService(createDependencies({
      readFrontmostWindow: async () => {
        readCount += 1;
        return readCount === 1
          ? externalTarget
          : {
              ...externalTarget,
              name: "Nodex",
              bundleIdentifier: "com.nodex.app",
              processIdentifier: 7,
              windowId: 77,
            };
      },
    }));

    const first = await service.readTarget();
    const second = await service.readTarget();
    expect(second.target).toEqual(first.target);
  });

  test("fails closed when the native capability is unavailable", async () => {
    const service = new ComposerAppshotService(createDependencies({
      platform: "linux",
    }));
    await expect(service.readTarget()).resolves.toEqual({
      available: false,
      target: null,
    });
    await expect(service.capture("id-1")).rejects.toThrow(
      "Appshots are unavailable",
    );
  });
});
