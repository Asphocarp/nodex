import { describe, expect, test } from "bun:test";

import {
  collectBlocks,
  extractDeclarationsFromBlocks,
} from "./sync-codex-theme-contract";

describe("sync-codex-theme-contract", () => {
  test("extracts declarations only from exact canonical selector blocks", () => {
    const css = `
      :root,
      :host {
        --color-token-description-foreground: var(--vscode-descriptionForeground);
        --color-token-side-bar-background: var(--vscode-sideBar-background);
      }

      @supports (color: color-mix(in lab, red, red)) {
        :root,
        :host {
          --color-token-border: color-mix(in oklab, var(--vscode-foreground) 8%, transparent);
        }
      }

      .browser\\:\\[--color-token-description-foreground\\:color-mix\\(in_srgb\\,var\\(--color-token-foreground\\)_90\\%\\,transparent\\)\\] {
        --color-token-description-foreground: color-mix(in srgb, var(--color-token-foreground) 90%, transparent);
      }

      [data-codex-window-type="electron"] {
        --vscode-descriptionForeground: var(--color-text-foreground-tertiary);
        --vscode-sideBar-background: var(--color-background-surface-under);
      }

      [data-codex-window-type="electron"] .electron\\:\\[--color-token-description-foreground\\:color-mix\\(in_srgb\\,var\\(--color-token-foreground\\)_70\\%\\,transparent\\)\\] {
        --color-token-description-foreground: color-mix(in srgb, var(--color-token-foreground) 70%, transparent);
      }
    `;

    const blocks = collectBlocks(css);
    const colorTokenDeclarations = extractDeclarationsFromBlocks(
      blocks,
      ":root, :host",
      "--color-token-",
    );
    const vscodeDeclarations = extractDeclarationsFromBlocks(
      blocks,
      '[data-codex-window-type="electron"]',
      "--vscode-",
    );

    expect(colorTokenDeclarations.get("--color-token-description-foreground")).toBe(
      "var(--vscode-descriptionForeground)",
    );
    expect(colorTokenDeclarations.get("--color-token-side-bar-background")).toBe(
      "var(--vscode-sideBar-background)",
    );
    expect(colorTokenDeclarations.get("--color-token-border")).toBe(
      "color-mix(in oklab, var(--vscode-foreground) 8%, transparent)",
    );
    expect(vscodeDeclarations.get("--vscode-descriptionForeground")).toBe(
      "var(--color-text-foreground-tertiary)",
    );
    expect(vscodeDeclarations.get("--vscode-sideBar-background")).toBe(
      "var(--color-background-surface-under)",
    );
  });
});
