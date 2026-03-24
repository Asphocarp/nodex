import { describe, expect, test } from "bun:test";

import {
  extractNamedDeclarations,
  findMatches,
  flattenCssNodes,
  parseCssNodes,
} from "./codex-css-extract";

describe("sync-codex-theme-foundation", () => {
  test("extracts exact foundation vars and scoped overrides from codex css", () => {
    const css = `
      @layer theme {
        :root,
        :host {
          --radius-sm: calc(var(--radius-sm-base) * var(--corner-radius-scale));
          --height-toolbar: 46px;
          --spacing-token-button-composer-gap: var(--spacing);
          --color-token-border: var(--vscode-foreground);
        }
      }

      :root {
        --padding-row-y: calc(var(--spacing) * 1);
      }

      [data-codex-window-type="electron"] body {
        --padding-row-y: calc(var(--spacing) * 1.25);
      }

      [data-codex-window-type="browser"] {
        --height-toolbar: 56px;
        --color-token-bg-primary: var(--vscode-editor-background);
      }

      :root[data-codex-window-type="extension"] {
        --diffs-font-size: calc(var(--codex-chat-code-font-size) - 1px);
      }

      @supports (corner-shape: superellipse(1.5)) {
        :root {
          --corner-radius-scale: 1.25;
        }
      }
    `;

    const matches = flattenCssNodes(parseCssNodes(css));
    const themeDeclarations = extractNamedDeclarations(
      findMatches(matches, ":root, :host", ["@layer theme"])[0]?.body ?? "",
      ["--radius-sm", "--height-toolbar", "--spacing-token-button-composer-gap"],
    );
    const rootDeclarations = extractNamedDeclarations(
      findMatches(matches, ":root")[0]?.body ?? "",
      ["--padding-row-y"],
    );
    const electronDeclarations = extractNamedDeclarations(
      findMatches(matches, '[data-codex-window-type="electron"] body')[0]?.body ?? "",
      ["--padding-row-y"],
    );
    const browserDeclarations = extractNamedDeclarations(
      findMatches(matches, '[data-codex-window-type="browser"]')[0]?.body ?? "",
      ["--height-toolbar"],
    );
    const extensionDeclarations = extractNamedDeclarations(
      findMatches(matches, ':root[data-codex-window-type="extension"]')[0]?.body ?? "",
      ["--diffs-font-size"],
    );
    const cornerDeclarations = extractNamedDeclarations(
      findMatches(matches, ":root", ["@supports (corner-shape: superellipse(1.5))"])[0]
        ?.body ?? "",
      ["--corner-radius-scale"],
    );

    expect(themeDeclarations.get("--radius-sm")).toBe(
      "calc(var(--radius-sm-base) * var(--corner-radius-scale))",
    );
    expect(themeDeclarations.get("--height-toolbar")).toBe("46px");
    expect(rootDeclarations.get("--padding-row-y")).toBe("calc(var(--spacing) * 1)");
    expect(electronDeclarations.get("--padding-row-y")).toBe(
      "calc(var(--spacing) * 1.25)",
    );
    expect(browserDeclarations.get("--height-toolbar")).toBe("56px");
    expect(extensionDeclarations.get("--diffs-font-size")).toBe(
      "calc(var(--codex-chat-code-font-size) - 1px)",
    );
    expect(cornerDeclarations.get("--corner-radius-scale")).toBe("1.25");
  });
});
