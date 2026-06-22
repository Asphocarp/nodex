import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type DeclarationMap = Map<string, string>;
type CssBlock = {
  prelude: string;
  body: string;
};

const codexRuntimeVscodeOverrides: DeclarationMap = new Map([
  ["--vscode-font-weight", "430"],
]);

const referencePath = resolve(
  process.cwd(),
  "design.local/codex-design-tokens/index.css",
);
const outputPath = resolve(
  process.cwd(),
  "src/renderer/styles/theme-codex-contract.generated.css",
);

const normalizeValue = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const stripComments = (value: string): string =>
  value.replace(/\/\*[\s\S]*?\*\//g, " ");

const normalizeSelector = (value: string): string =>
  stripComments(value).replace(/\s+/g, " ").trim();

const collectBlocks = (css: string, start = 0, end = css.length): CssBlock[] => {
  const blocks: CssBlock[] = [];
  let cursor = start;

  while (cursor < end) {
    const openBraceIndex = css.indexOf("{", cursor);
    if (openBraceIndex === -1 || openBraceIndex >= end) {
      break;
    }

    const prelude = css.slice(cursor, openBraceIndex);
    let depth = 1;
    let cursorIndex = openBraceIndex + 1;

    while (cursorIndex < end && depth > 0) {
      const character = css[cursorIndex];
      if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
      }
      cursorIndex += 1;
    }

    const body = css.slice(openBraceIndex + 1, cursorIndex - 1);
    blocks.push({
      prelude: normalizeSelector(prelude),
      body,
    });
    blocks.push(...collectBlocks(body));
    cursor = cursorIndex;
  }

  return blocks;
};

const extractDeclarationsFromBlocks = (
  blocks: CssBlock[],
  selector: string,
  prefix: string,
): DeclarationMap => {
  const declarations = new Map<string, string>();
  const normalizedSelector = normalizeSelector(selector);
  const pattern = new RegExp(
    String.raw`(?:^|(?<=[;]))\s*(${prefix}[A-Za-z0-9_.\\-]+)\s*:\s*([^;}]*)`,
    "g",
  );

  for (const block of blocks) {
    if (block.prelude !== normalizedSelector) {
      continue;
    }

    for (const match of block.body.matchAll(pattern)) {
      const name = match[1];
      const value = normalizeValue(match[2]);
      declarations.delete(name);
      declarations.set(name, value);
    }
  }

  return declarations;
};

const formatBlock = (selector: string, declarations: DeclarationMap): string => {
  const lines = [...declarations.entries()].map(
    ([name, value]) => `  ${name}: ${value};`,
  );

  return `${selector} {\n${lines.join("\n")}\n}`;
};

const formatThemeBlock = (declarations: DeclarationMap): string => {
  const lines = [...declarations.entries()].map(
    ([name, value]) => `  ${name}: ${value};`,
  );

  return `@theme static {\n${lines.join("\n")}\n}`;
};

const applyCodexRuntimeVscodeOverrides = (
  declarations: DeclarationMap,
): DeclarationMap => {
  const next = new Map(declarations);

  for (const [name, value] of codexRuntimeVscodeOverrides) {
    next.set(name, value);
  }

  return next;
};

const run = (): void => {
  const css = readFileSync(referencePath, "utf8");
  const blocks = collectBlocks(css);
  const vscodeDeclarations = applyCodexRuntimeVscodeOverrides(
    extractDeclarationsFromBlocks(
      blocks,
      '[data-codex-window-type="electron"]',
      "--vscode-",
    ),
  );
  const colorTokenDeclarations = extractDeclarationsFromBlocks(
    blocks,
    ":root, :host",
    "--color-token-",
  );

  const output = `/*
 * Synced from the Codex Electron reference CSS.
 * Do not edit by hand. Update the reference file, then rerun:
 *   bun run scripts/sync-codex-theme-contract.ts
 */

${formatBlock('[data-codex-window-type="electron"]', vscodeDeclarations)}

${formatThemeBlock(colorTokenDeclarations)}
`;

  writeFileSync(outputPath, output);

  console.log(
    `Synced ${vscodeDeclarations.size} vscode vars and ${colorTokenDeclarations.size} color-token vars from ${referencePath} to ${outputPath}`,
  );
};

if (import.meta.main) {
  run();
}

export {
  applyCodexRuntimeVscodeOverrides,
  collectBlocks,
  extractDeclarationsFromBlocks,
  normalizeSelector,
  normalizeValue,
  run,
};
