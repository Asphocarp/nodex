import { describe, expect, test } from "vitest";

import {
  collectSelectorFingerprints,
  collectSemanticThemeCssFacts,
  extractCustomPropertyMap,
  filterCss,
} from "./parser";

describe("semantic theme CSS parser", () => {
  test("keeps configured declarations and their conditional scope", () => {
    const css = `
      :root, :host { --color-text-info: blue; --unowned: red; }
      .unrelated { --color-text-info: orange; }
      @supports (color: color-mix(in oklab, red, blue)) {
        :root, :host { --color-text-info: color-mix(in oklab, blue 80%, white); }
      }
    `;

    const output = filterCss(css, {
      selectorFingerprints: collectSelectorFingerprints([":root, :host"]),
      declarationPredicate: (declaration) =>
        declaration.property === "custom" && declaration.value.name === "--color-text-info",
    });

    expect(extractCustomPropertyMap(output).has("--color-text-info")).toBe(true);
    expect(output).toContain("@supports");
    expect(output).not.toContain("--unowned");
    expect(output).not.toContain(".unrelated");
  });

  test("normalizes equivalent selector formatting through AST fingerprints", () => {
    const output = filterCss(":root,:host{--color-text-info:blue}", {
      selectorFingerprints: collectSelectorFingerprints([":root, :host"]),
    });

    expect(output).toContain("--color-text-info: blue");
  });

  test("preserves window and color-scheme coverage instead of flattening declarations", () => {
    const facts = collectSemanticThemeCssFacts(
      `
      :root { --global: 1; }
      .electron-light { --electron-light-only: var(--global); }
      .electron-dark { --electron-dark-only: var(--global); }
      :is([data-codex-window-type="browser"], [data-codex-window-type="chrome-extension"]) {
        --web-windows: var(--global);
      }
    `,
      "fixture.css",
    );

    const definitions = new Map(
      facts.definitions.map((definition) => [definition.name, definition]),
    );
    expect(definitions.get("--global")?.targets).toEqual([
      "browser-dark",
      "browser-light",
      "electron-dark",
      "electron-light",
      "extension-dark",
      "extension-light",
    ]);
    expect(definitions.get("--electron-light-only")?.targets).toEqual(["electron-light"]);
    expect(definitions.get("--electron-dark-only")?.targets).toEqual(["electron-dark"]);
    expect(definitions.get("--web-windows")?.targets).toEqual([
      "browser-dark",
      "browser-light",
      "extension-dark",
      "extension-light",
    ]);
    expect(definitions.get("--web-windows")?.scopeKind).toBe("scoped");
  });
});
