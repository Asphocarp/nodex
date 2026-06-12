import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { findMatches, flattenCssNodes, parseCssNodes } from "./codex-css-extract";

describe("sync-codex-theme-surface", () => {
  test("finds exact shimmer selectors without mixing nested contexts", () => {
    const css = `
      .loading-shimmer-pure-text,
      .loading-shimmer {
        --text-primary: var(--color-token-description-foreground);
      }

      @supports (color: color-mix(in lab, red, red)) {
        .loading-shimmer-pure-text,
        .loading-shimmer {
          --text-secondary: color-mix(in srgb, var(--text-primary) 55%, transparent);
        }
      }

      .dark .loading-shimmer-pure-text,
      .dark .loading-shimmer {
        --shimmer-contrast: #0009;
      }

      @media (prefers-reduced-motion: reduce) {
        .loading-shimmer-pure-text,
        .loading-shimmer {
          animation: none;
        }
      }

      @keyframes loading-shimmer {
        0% { background-position: -100% 0; }
        to { background-position: 250% 0; }
      }
    `;

    const matches = flattenCssNodes(parseCssNodes(css));

    expect(findMatches(matches, ".loading-shimmer-pure-text, .loading-shimmer").length).toBe(
      1,
    );
    expect(
      findMatches(matches, ".loading-shimmer-pure-text, .loading-shimmer", [
        "@supports (color: color-mix(in lab, red, red))",
      ]).length,
    ).toBe(1);
    expect(
      findMatches(matches, ".loading-shimmer-pure-text, .loading-shimmer", [
        "@media (prefers-reduced-motion: reduce)",
      ]).length,
    ).toBe(1);
    expect(
      findMatches(matches, ".dark .loading-shimmer-pure-text, .dark .loading-shimmer").length,
    ).toBe(1);
    expect(findMatches(matches, "@keyframes loading-shimmer").length).toBe(1);
  });

  test("generated CSS includes the Codex Electron left sidebar surface rules", () => {
    const generatedCss = readFileSync(
      resolve(process.cwd(), "src/renderer/styles/theme-codex-surface.generated.css"),
      "utf8",
    );

    expect(generatedCss.includes(
      '[data-codex-window-type="electron"]:not([data-codex-window-chrome="application-menu"]) .app-shell-left-panel',
    )).toBeTrue();
    expect(generatedCss.includes("background: color-mix(in srgb, var(--color-token-editor-background) 55%, transparent);")).toBeTrue();
    expect(generatedCss.includes("overflow: visible;")).toBeTrue();
    expect(generatedCss.includes(".app-shell-left-panel:after")).toBeTrue();
    expect(generatedCss.includes("background: inherit;")).toBeTrue();
  });
});
