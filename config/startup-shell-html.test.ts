import { JSDOM } from "jsdom";
import { describe, expect, test } from "vite-plus/test";
import { createStartupShellCriticalCss, createStartupShellMarkup } from "./startup-shell-html";

describe("parser-time startup shell", () => {
  test("contains a visible base logo and one accessible status surface before scripts run", () => {
    const document = new JSDOM(createStartupShellMarkup()).window.document;
    const shell = document.querySelector(".nodex-startup-shell");
    const logo = document.querySelector(".nodex-startup-logo-base");
    const status = document.querySelector('[role="status"]');

    expect(shell?.getAttribute("data-startup-phase")).toBe("opening");
    expect(logo?.tagName).toBe("svg");
    expect(logo?.querySelectorAll("path")).toHaveLength(3);
    expect(logo?.getAttribute("viewBox")).toBe("0 0 800 800");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toContain("Opening Nodex…");
  });

  test("keeps shimmer compositor-only and disables it for reduced motion", () => {
    const document = new JSDOM(`<style>${createStartupShellCriticalCss()}</style>`).window.document;
    const rules = Array.from(document.styleSheets[0]?.cssRules ?? []);
    const keyframes = rules.find((rule) => rule.constructor.name === "CSSKeyframesRule") as
      | CSSKeyframesRule
      | undefined;
    const reducedMotion = rules.find((rule) => rule.constructor.name === "CSSMediaRule") as
      | CSSMediaRule
      | undefined;
    const animatedProperties = new Set<string>();
    for (const frame of Array.from(keyframes?.cssRules ?? [])) {
      for (const property of Array.from(frame.style)) animatedProperties.add(property);
    }

    expect([...animatedProperties]).toEqual(["transform"]);
    expect(reducedMotion?.conditionText).toBe("(prefers-reduced-motion: reduce)");
    expect(reducedMotion?.cssText).toContain("display: none");
  });
});
