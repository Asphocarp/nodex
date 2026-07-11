import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  extractNamedDeclarations,
  findMatches,
  flattenCssNodes,
  formatBlock,
  formatNestedBlock,
  formatThemeBlock,
  mergeDeclarationMaps,
  parseCssNodes,
} from "./codex-css-extract";

const referencePath = resolve(
  process.cwd(),
  "design.local/codex-design-tokens/index.css",
);
const outputPath = resolve(
  process.cwd(),
  "src/renderer/styles/theme-codex-foundation.generated.css",
);

const FOUNDATION_THEME_VARS = [
  "--font-sans",
  "--font-mono",
  "--spacing-panel",
  "--radius-2xs",
  "--radius-xs",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
  "--radius-2xl",
  "--radius-3xl",
  "--radius-4xl",
  "--padding-row-y",
  "--padding-row-x",
  "--padding-panel",
  "--padding-toolbar",
  "--height-toolbar",
  "--height-toolbar-sm",
  "--inset-toolbar",
  "--inset-toolbar-sm",
  "--spacing-token-sidebar",
  "--spacing-token-button-composer",
  "--spacing-token-button-composer-sm",
  "--spacing-token-button-composer-gap",
  "--spacing-token-safe-header-left",
  "--spacing-token-safe-header-right",
  "--h-token-button-composer-gap",
  "--cursor-interaction",
  "--thread-content-max-width",
  "--thread-composer-max-width",
  "--markdown-wide-block-max-width",
  "--text-heading-md",
  "--diffs-font-size",
] as const;

const FOUNDATION_THEME_NORMALIZATIONS = new Map<string, string>([
  ["--padding-row-y", "calc(var(--spacing) * 1)"],
  ["--padding-panel", "var(--padding-panel-base)"],
  ["--padding-toolbar", "calc(var(--spacing) * 4)"],
]);

const ROOT_VARS = [
  "--padding-row-y",
  "--padding-panel-base",
  "--padding-panel",
  "--padding-toolbar",
  "--inset-toolbar",
  "--safe-area-left",
  "--safe-area-right",
  "--spacing-token-button-composer-sm",
  "--text-heading-md",
] as const;

const ROOT_DECLARATION_FALLBACKS = new Map<string, string>([
  ["--padding-toolbar", "calc(var(--spacing) * 4)"],
]);

const ELECTRON_BODY_VARS = [
  "--padding-row-y",
  "--padding-panel-base",
  "--padding-panel",
  "--thread-content-max-width",
  "--thread-composer-max-width",
  "--markdown-wide-block-max-width",
  "--cursor-interaction",
  "--color-token-bg-fog",
  "--vscode-editor-font-family",
  "--vscode-font-size",
  "--vscode-editor-font-size",
  "--vscode-chat-font-size",
  "--vscode-chat-editor-font-size",
  "--spacing-token-button-composer-sm",
  "--text-heading-md",
] as const;

const BROWSER_VARS = ["--height-toolbar"] as const;

const EXTENSION_ROOT_VARS = ["--diffs-font-size", "--text-heading-md"] as const;

const CORNER_SUPPORT_VARS = ["--corner-radius-scale"] as const;

const extractSingleBlockDeclarations = (
  matches: ReturnType<typeof flattenCssNodes>,
  selector: string,
  propertyNames: readonly string[],
  parents: string[] = [],
): Map<string, string> =>
  mergeDeclarationMaps(
    findMatches(matches, selector, parents).map((match) =>
      extractNamedDeclarations(match.body, propertyNames),
    ),
  );

const run = (): void => {
  const css = readFileSync(referencePath, "utf8");
  const matches = flattenCssNodes(parseCssNodes(css));

  const foundationThemeDeclarations = extractSingleBlockDeclarations(
    matches,
    ":root, :host",
    FOUNDATION_THEME_VARS,
    ["@layer theme"],
  );
  for (const [name, value] of FOUNDATION_THEME_NORMALIZATIONS.entries()) {
    foundationThemeDeclarations.set(name, value);
  }
  const rootDeclarations = extractSingleBlockDeclarations(matches, ":root", ROOT_VARS);
  for (const [name, value] of ROOT_DECLARATION_FALLBACKS.entries()) {
    rootDeclarations.set(name, value);
  }
  const electronBodyDeclarations = extractSingleBlockDeclarations(
    matches,
    '[data-codex-window-type="electron"] body',
    ELECTRON_BODY_VARS,
  );
  const browserDeclarations = extractSingleBlockDeclarations(
    matches,
    '[data-codex-window-type="browser"]',
    BROWSER_VARS,
  );
  const extensionDeclarations = extractSingleBlockDeclarations(
    matches,
    ':root[data-codex-window-type="extension"]',
    EXTENSION_ROOT_VARS,
  );
  const cornerSupportDeclarations = extractSingleBlockDeclarations(
    matches,
    ":root",
    CORNER_SUPPORT_VARS,
    ["@supports (corner-shape: superellipse(1.5))"],
  );

  const sections = [
    "/*",
    " * Synced from the Codex Electron reference CSS.",
    " * Do not edit by hand. Update the reference file, then rerun:",
    " *   pnpm run scripts/sync-codex-theme-foundation.ts",
    " */",
    "",
    formatThemeBlock(foundationThemeDeclarations),
    "",
    formatBlock(":root", rootDeclarations),
    "",
    formatBlock('[data-codex-window-type="electron"] body', electronBodyDeclarations),
    "",
    formatBlock('[data-codex-window-type="browser"]', browserDeclarations),
    "",
    formatBlock(':root[data-codex-window-type="extension"]', extensionDeclarations),
    "",
    formatNestedBlock(
      "@supports (corner-shape: superellipse(1.5))",
      ":root",
      cornerSupportDeclarations,
    ),
    "",
  ];

  writeFileSync(outputPath, sections.join("\n"));

  console.log(`Synced Codex foundation CSS to ${outputPath}`);
};

if (import.meta.main) {
  run();
}

export { run };
