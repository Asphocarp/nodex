import { afterEach, describe, expect, test } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import "@/globals.css";

interface ChromiumMediaEmulationSession {
  send(
    method: "Emulation.setEmulatedMedia",
    params: {
      features: Array<{
        name: "prefers-reduced-motion";
        value: "no-preference" | "reduce";
      }>;
    },
  ): Promise<unknown>;
}

const mountRole = (className: string): HTMLDivElement => {
  const element = document.createElement("div");
  element.className = className;
  document.body.append(element);
  return element;
};

const setWindowTheme = (windowType: "browser" | "electron", scheme: "light" | "dark") => {
  const root = document.documentElement;
  root.dataset.codexWindowType = windowType;
  root.classList.toggle("dark", scheme === "dark");
  root.classList.toggle("electron-dark", windowType === "electron" && scheme === "dark");
  root.classList.toggle("electron-light", windowType === "electron" && scheme === "light");
};

afterEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-codex-window-type");
  document.documentElement.classList.remove("dark", "electron-dark", "electron-light");
});

describe("semantic theme contract in the renderer build", () => {
  test("resolves semantic text and status roles from their canonical variables", () => {
    document.body.style.setProperty("--color-text-danger", "rgb(201, 32, 18)");
    document.body.style.setProperty("--color-text-info", "rgb(18, 105, 201)");
    document.body.style.setProperty("--color-text-tertiary", "rgb(101, 102, 103)");
    document.body.style.setProperty("--color-text-secondary", "rgb(71, 72, 73)");

    expect(getComputedStyle(mountRole("text-danger")).color).toBe("rgb(201, 32, 18)");
    expect(getComputedStyle(mountRole("text-info")).color).toBe("rgb(18, 105, 201)");
    expect(getComputedStyle(mountRole("text-tertiary")).color).toBe("rgb(101, 102, 103)");
    expect(getComputedStyle(mountRole("semantic-text-secondary")).color).toBe("rgb(71, 72, 73)");
  });

  test("keeps the semantic secondary role independent from the generic control color", () => {
    document.body.style.setProperty("--color-secondary", "rgb(220, 10, 10)");
    document.body.style.setProperty("--color-text-secondary", "rgb(10, 120, 40)");

    expect(getComputedStyle(mountRole("semantic-text-secondary")).color).toBe("rgb(10, 120, 40)");
    expect(getComputedStyle(mountRole("text-secondary")).color).not.toBe("rgb(10, 120, 40)");
  });

  test("resolves semantic border and progress roles", () => {
    document.body.style.setProperty("--color-border", "rgb(42, 43, 44)");
    document.body.style.setProperty("--color-text", "rgb(18, 105, 201)");
    document.body.style.setProperty("--color-text-info", "rgb(18, 105, 201)");
    const border = mountRole("border border-default");
    const fill = mountRole("bg-text-info");
    const track = mountRole("bg-text/10");

    expect(getComputedStyle(border).borderTopColor).toBe("rgb(42, 43, 44)");
    expect(getComputedStyle(fill).backgroundColor).toBe("rgb(18, 105, 201)");
    expect(getComputedStyle(track).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("keeps production radii and electron layout dimensions resolvable", () => {
    setWindowTheme("electron", "light");
    const rounded = mountRole("rounded-lg");
    const sidebarWidth = mountRole("w-token-sidebar");

    expect(Number.parseFloat(getComputedStyle(rounded).borderTopLeftRadius)).toBeGreaterThan(0);
    expect(Number.parseFloat(getComputedStyle(sidebarWidth).width)).toBeGreaterThanOrEqual(240);
    const rootStyle = getComputedStyle(document.documentElement);
    expect(rootStyle.getPropertyValue("--spacing-token-sidebar")).toContain("300px");
    expect(rootStyle.getPropertyValue("--height-toolbar").trim()).toBe("46px");
  });

  test("keeps the browser toolbar override independent from the electron default", () => {
    setWindowTheme("browser", "light");

    expect(
      getComputedStyle(document.documentElement).getPropertyValue("--height-toolbar").trim(),
    ).toBe("56px");
  });

  test("resolves production shimmer and sidebar surfaces in both electron schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      setWindowTheme("electron", scheme);
      const shimmer = mountRole("loading-shimmer-pure-text");
      const sidebar = mountRole("app-shell-left-panel");
      const shimmerStyle = getComputedStyle(shimmer);
      const sidebarStyle = getComputedStyle(sidebar);

      expect(shimmerStyle.backgroundImage).not.toBe("none");
      expect(shimmerStyle.webkitTextFillColor).toBe("rgba(0, 0, 0, 0)");
      expect(
        sidebarStyle.backgroundColor,
        JSON.stringify({
          token: sidebarStyle.getPropertyValue("--color-token-editor-background"),
          vscode: sidebarStyle.getPropertyValue("--vscode-editor-background"),
          editor: sidebarStyle.getPropertyValue("--color-background-editor-opaque"),
        }),
      ).not.toBe("rgba(0, 0, 0, 0)");
      shimmer.remove();
      sidebar.remove();
    }
  });

  test("keeps production shimmer visible but static under reduced motion", async () => {
    const session = cdp() as unknown as ChromiumMediaEmulationSession;
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    try {
      setWindowTheme("electron", "dark");
      const shimmerStyle = getComputedStyle(mountRole("loading-shimmer-pure-text"));

      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
      expect(shimmerStyle.animationName).toBe("none");
      expect(shimmerStyle.backgroundImage).not.toBe("none");
    } finally {
      await session.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
    }
  });
});
