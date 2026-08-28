import { describe, expect, test, vi } from "vitest";
import {
  configureGlobalDictationNativeWindow,
  GlobalDictationPresentationGate,
  createGlobalDictationWindowOptions,
  resolveGlobalDictationBounds,
  withGlobalDictationRoute,
} from "./global-dictation-window-controller";

describe("GlobalDictationWindowController", () => {
  test("invalidates renderer-ready presentation work when visibility intent changes", () => {
    const gate = new GlobalDictationPresentationGate();
    const idle = gate.begin();
    gate.invalidate();

    expect(gate.isCurrent(idle)).toBe(false);

    const nextIdle = gate.begin();
    const listening = gate.begin();
    expect(gate.isCurrent(nextIdle)).toBe(false);
    expect(gate.isCurrent(listening)).toBe(true);
  });

  test("places the 720 by 84 bar bottom-center inside the cursor display work area", () => {
    expect(resolveGlobalDictationBounds({ x: -1_920, y: 23, width: 1_920, height: 1_057 })).toEqual(
      { x: -1_320, y: 980, width: 720, height: 84 },
    );
  });

  test("keeps the helper inside very short display work areas", () => {
    expect(resolveGlobalDictationBounds({ x: 10, y: 42, width: 1_000, height: 60 })).toEqual({
      x: 150,
      y: 42,
      width: 720,
      height: 84,
    });
  });

  test("uses a non-activating macOS panel with first-click support", () => {
    const options = createGlobalDictationWindowOptions("/tmp/global-dictation.js", "darwin");
    expect(options).toMatchObject({
      title: "Dictation",
      width: 720,
      height: 84,
      type: "panel",
      frame: false,
      transparent: true,
      focusable: false,
      acceptFirstMouse: true,
      show: false,
      skipTaskbar: true,
      hasShadow: false,
    });
  });

  test("adds only the compact auxiliary route to the renderer URL", () => {
    const routed = new URL(withGlobalDictationRoute("app://-/index.html?theme=dark"));
    expect(routed.protocol).toBe("app:");
    expect(routed.hostname).toBe("-");
    expect(routed.pathname).toBe("/index.html");
    expect(routed.searchParams.get("theme")).toBe("dark");
    expect(routed.searchParams.get("initialRoute")).toBe("/global-dictation");
  });

  test("keeps the foreground application identity while spanning macOS workspaces", () => {
    const window = {
      setAlwaysOnTop: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
    };

    configureGlobalDictationNativeWindow(window);

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      skipTransformProcessType: true,
      visibleOnFullScreen: true,
    });
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: false });
  });
});
