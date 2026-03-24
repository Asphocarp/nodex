import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  extractAllDeclarations,
  findMatches,
  flattenCssNodes,
  formatBlock,
  formatNestedBlock,
  mergeDeclarationMaps,
  parseCssNodes,
} from "./codex-css-extract";

const referencePath = resolve(
  process.cwd(),
  "design.local/codex-design-tokens/index.css",
);
const outputPath = resolve(
  process.cwd(),
  "src/renderer/styles/theme-codex-utilities.generated.css",
);

const ROOT_SELECTOR_BLOCKS = [
  ".\\@container\\/diff-header",
  ".\\@container\\/left-panel",
  ".icon-3xs",
  ".icon-xxs",
  ".icon-2xs",
  ".icon-xs",
  ".icon-sm",
  ".icon-base",
  ".icon-md",
  ".icon-lg",
  ".heading-4xl",
  ".heading-3xl",
  ".heading-2xl",
  ".heading-xl",
  ".heading-lg",
  ".heading-base",
  ".heading-dialog",
  ".heading-sm",
  ".heading-xs",
  ".contain-inline-size",
  ".text-size-chat",
  ".text-size-chat-sm",
  ".text-size-code",
  ".text-size-code-sm",
  ".font-vscode-editor",
  ".cursor-interaction",
  ".h-token-button-composer, .h-token-button-composer-sm",
  ".draggable",
  ".draggable button, .no-drag",
  ".duration-relaxed",
  ".ease-basic",
  ".scroll-contain",
  ".scrollbar-stable",
  ".disambiguated-digits",
  ".disambig-digits.slashed-zero",
  ".\\[\\&_\\.ProseMirror\\]\\:focus-visible\\:outline-none .ProseMirror:focus-visible",
  ".\\[\\&_\\.ProseMirror\\]\\:h-auto .ProseMirror",
  ".\\[\\&_\\.ProseMirror\\]\\:min-h-\\[2rem\\] .ProseMirror",
  ".\\[\\&_\\.ProseMirror\\]\\:resize-none .ProseMirror",
  ".\\[\\&_\\.ProseMirror_p\\]\\:m-0 .ProseMirror p",
  ".\\[\\&_\\.contain-inline-size\\]\\:\\[contain\\:initial\\] .contain-inline-size",
  ".\\[\\&\\>\\*\\:first-child\\]\\:mt-0 > :first-child",
  ".\\[\\&\\>\\*\\:last-child\\]\\:mb-0 > :last-child",
  ".\\[\\&\\>ol\\:first-child\\]\\:mt-0 > ol:first-child",
  ".\\[\\&\\>ul\\:first-child\\]\\:mt-0 > ul:first-child",
  ".\\[\\&_\\*\\]\\:text-token-description-foreground\\/80 *",
  ".\\[\\&_\\*\\]\\:text-token-foreground\\/50 *",
] as const;

const ROOT_SUPPORT_SELECTOR_BLOCKS = [
  ".\\[\\&_\\*\\]\\:text-token-description-foreground\\/80 *",
  ".\\[\\&_\\*\\]\\:text-token-foreground\\/50 *",
] as const;

const UTILITY_SUPPORT_LAYER_PARENTS = [
  "@layer utilities",
  "@supports (color: color-mix(in lab, red, red))",
] as const;

const extractDeclarationsForSelector = (
  matches: ReturnType<typeof flattenCssNodes>,
  selector: string,
  parents?: string[],
): Map<string, string> => {
  const selectedMatches =
    parents == null
      ? matches.filter(
          (match) =>
            match.prelude === selector &&
            !match.parents.some((parent) => parent.startsWith("@supports ")),
        )
      : findMatches(matches, selector, parents);
  if (selectedMatches.length === 0) {
    throw new Error(
      `Missing selector ${selector} in ${parents?.join(" > ") || "any parent"}`,
    );
  }

  return mergeDeclarationMaps(
    selectedMatches.map((match) => extractAllDeclarations(match.body)),
  );
};

const run = (): void => {
  const css = readFileSync(referencePath, "utf8");
  const matches = flattenCssNodes(parseCssNodes(css));

  const sections = [
    "/*",
    " * Synced from the Codex Electron reference CSS.",
    " * Do not edit by hand. Update the reference file, then rerun:",
    " *   bun run scripts/sync-codex-theme-utilities.ts",
    " */",
    "",
    ...ROOT_SELECTOR_BLOCKS.flatMap((selector) => [
      formatBlock(selector, extractDeclarationsForSelector(matches, selector)),
      "",
    ]),
    ...ROOT_SUPPORT_SELECTOR_BLOCKS.flatMap((selector) => [
      formatNestedBlock(
        "@supports (color: color-mix(in lab, red, red))",
        selector,
        extractDeclarationsForSelector(matches, selector, [
          ...UTILITY_SUPPORT_LAYER_PARENTS,
        ]),
      ),
      "",
    ]),
  ];

  writeFileSync(outputPath, sections.join("\n"));

  console.log(`Synced Codex utility CSS to ${outputPath}`);
};

if (import.meta.main) {
  run();
}

export { run };
