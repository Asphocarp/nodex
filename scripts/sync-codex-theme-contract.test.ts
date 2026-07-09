import { describe, expect, test } from "vitest";

import {
  applyCodexRuntimeColorTokenOverrides,
  applyCodexRuntimeVscodeOverrides,
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

  test("normalizes runtime vscode overrides observed from Electron", () => {
    const declarations = new Map<string, string>([
      ["--vscode-font-family", "inherit"],
      ["--vscode-font-weight", "normal"],
      ["--vscode-editor-font-weight", "normal"],
    ]);

    const normalized = applyCodexRuntimeVscodeOverrides(declarations);

    expect(normalized.get("--vscode-font-weight")).toBe("445");
    expect(normalized.get("--vscode-textCodeBlock-background")).toBe(
      "var(--color-background-button-secondary)",
    );
    expect(normalized.get("--vscode-font-family")).toBe("inherit");
    expect(normalized.get("--vscode-editor-font-weight")).toBe("normal");
  });

  test("restores exact leaf-surface tokens omitted by the readable design source", () => {
    const normalized = applyCodexRuntimeColorTokenOverrides(new Map([
      ["--color-token-foreground", "var(--vscode-foreground)"],
    ]));

    expect(normalized.get("--color-token-border-heavy")).toBe(
      "var(--color-border-heavy, color-mix(in oklab, var(--vscode-foreground) 12%, transparent))",
    );
    expect(normalized.get("--color-token-conversation-header")).toBe(
      "color-mix(in oklab, var(--color-token-foreground) 30%, transparent)",
    );
    expect(normalized.get("--color-token-conversation-body")).toBe(
      "color-mix(in oklab, var(--color-token-foreground) 60%, transparent)",
    );
    expect(normalized.get("--color-token-non-assistant-body-descendant")).toBe(
      "color-mix(in oklab, var(--color-token-foreground) 50%, transparent)",
    );
    expect(normalized.get("--color-token-conversation-summary-leading")).toBe(
      "color-mix(in oklab, var(--color-token-description-foreground) 90%, transparent)",
    );
    expect(normalized.get("--color-token-conversation-summary-trailing")).toBe(
      "color-mix(in oklab, var(--color-token-foreground) 40%, transparent)",
    );
  });
});
