import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function mountThemeSurfaceStyle() {
  const styleElement = document.createElement("style");
  styleElement.textContent = readFileSync(new URL("./theme-surface.css", import.meta.url), "utf8");
  document.head.append(styleElement);
}

function mountAppShellFrame(layout: string) {
  const viewport = document.createElement("div");
  viewport.className = "app-shell-main-content-viewport";
  viewport.setAttribute("data-app-shell-main-content-layout", layout);
  viewport.style.setProperty("--height-toolbar", "46px");
  viewport.style.setProperty("--spacing", "0.25rem");

  const frame = document.createElement("div");
  frame.className = "app-shell-main-content-frame";
  viewport.append(frame);
  document.body.append(viewport);

  return { frame, viewport };
}

describe("theme surface app shell layout", () => {
  test("thread edge-scroll frames keep the guarded toolbar-height offset before the wide container query applies", () => {
    mountThemeSurfaceStyle();

    const { viewport } = mountAppShellFrame("thread-edge-scroll");

    expect(
      getComputedStyle(viewport).getPropertyValue("--app-shell-main-content-frame-top-offset").trim(),
    ).toBe("46px");
  });

  test("thread edge-scroll uses the base floating inset before the wide container query applies", () => {
    mountThemeSurfaceStyle();

    const { viewport } = mountAppShellFrame("thread-edge-scroll");

    expect(
      getComputedStyle(viewport).getPropertyValue("--thread-floating-content-top-inset").trim(),
    ).toBe("calc(0.25rem * 3)");
  });

  test("full-bleed frames clear the toolbar-height top offset", () => {
    mountThemeSurfaceStyle();

    const { frame } = mountAppShellFrame("full-bleed");

    expect(
      getComputedStyle(frame).getPropertyValue("--app-shell-main-content-frame-top-offset").trim(),
    ).toBe("0px");
  });
});
