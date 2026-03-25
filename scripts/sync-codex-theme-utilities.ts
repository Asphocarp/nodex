import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { transform, type Rule, type Selector, type StyleSheet } from "lightningcss";

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

type WindowVariant = "browser" | "electron" | "extension";

const parseStylesheet = (css: string, filename: string): StyleSheet => {
  let stylesheet: StyleSheet | null = null;

  transform({
    filename,
    code: Buffer.from(css),
    minify: false,
    analyzeDependencies: false,
    visitor: {
      StyleSheet(sheet) {
        stylesheet = sheet;
        return sheet;
      },
    },
  });

  if (stylesheet == null) {
    throw new Error(`Failed to parse stylesheet: ${filename}`);
  }

  return stylesheet;
};

const selectorFingerprint = (selector: Selector): string => JSON.stringify(selector);

const parseSelectorFingerprints = (selectorText: string): string[] => {
  const stylesheet = parseStylesheet(`${selectorText} { color: red; }`, "selector.css");
  const firstRule = stylesheet.rules[0];
  if (firstRule == null || firstRule.type !== "style") {
    throw new Error(`Unable to parse selector snippet: ${selectorText}`);
  }

  return firstRule.value.selectors.map(selectorFingerprint);
};

const collectSelectorFingerprintSet = (selectors: readonly string[]): Set<string> => {
  const fingerprints = new Set<string>();

  for (const selector of selectors) {
    for (const fingerprint of parseSelectorFingerprints(selector)) {
      fingerprints.add(fingerprint);
    }
  }

  return fingerprints;
};

const ROOT_SELECTOR_FINGERPRINTS = collectSelectorFingerprintSet(ROOT_SELECTOR_BLOCKS);
const ROOT_SUPPORT_SELECTOR_FINGERPRINTS = collectSelectorFingerprintSet(
  ROOT_SUPPORT_SELECTOR_BLOCKS,
);

const readWindowVariantName = (className: string): WindowVariant | null => {
  if (className.startsWith("browser:[")) {
    return "browser";
  }
  if (className.startsWith("electron:[")) {
    return "electron";
  }
  if (className.startsWith("extension:[")) {
    return "extension";
  }

  return null;
};

const isWindowVariantArbitraryPropertySelector = (selector: Selector): boolean => {
  if (selector.length !== 2) {
    return false;
  }

  const [classNode, whereNode] = selector;
  if (classNode?.type !== "class") {
    return false;
  }

  const windowVariant = readWindowVariantName(classNode.name);
  if (windowVariant == null) {
    return false;
  }

  if (whereNode?.type !== "pseudo-class" || whereNode.kind !== "where") {
    return false;
  }

  const nestedSelector = whereNode.selectors?.[0];
  if (nestedSelector == null || nestedSelector.length !== 3) {
    return false;
  }

  const [attributeNode, combinatorNode, nestedClassNode] = nestedSelector;
  if (attributeNode?.type !== "attribute" || attributeNode.name !== "data-codex-window-type") {
    return false;
  }

  if (attributeNode.operation?.value !== windowVariant) {
    return false;
  }

  if (combinatorNode?.type !== "combinator" || combinatorNode.value !== "descendant") {
    return false;
  }

  return nestedClassNode?.type === "class" && nestedClassNode.name === classNode.name;
};

const isAllowedUtilityStyleRule = (
  rule: Extract<Rule, { type: "style" }>,
  withinSupports: boolean,
): boolean => {
  const fingerprints = withinSupports
    ? ROOT_SUPPORT_SELECTOR_FINGERPRINTS
    : ROOT_SELECTOR_FINGERPRINTS;

  return rule.value.selectors.some((selector) => {
    if (isWindowVariantArbitraryPropertySelector(selector)) {
      return true;
    }

    return fingerprints.has(selectorFingerprint(selector));
  });
};

const isAllowedGeneratedUtilityStyleRule = (
  rule: Extract<Rule, { type: "style" }>,
  withinSupports: boolean,
): boolean => isAllowedUtilityStyleRule(rule, withinSupports);

const ALLOWED_GENERATED_LAYER_NAMES = new Set(["components", "utilities"]);

const buildGeneratedUtilitiesCss = (referenceCss: string): string => {
  const layerNameStack: string[] = [];
  let supportsDepth = 0;

  const result = transform({
    filename: referencePath,
    code: Buffer.from(referenceCss),
    minify: false,
    analyzeDependencies: false,
    visitor: {
      Rule(rule) {
        if (rule.type === "layer-block") {
          layerNameStack.push((rule.value.name ?? []).join("."));
          return;
        }

        if (rule.type === "supports") {
          supportsDepth += 1;
          return;
        }

        if (
          rule.type === "style" &&
          !isAllowedGeneratedUtilityStyleRule(rule, supportsDepth > 0)
        ) {
          return [];
        }
      },
      RuleExit(rule) {
        if (rule.type === "supports") {
          supportsDepth -= 1;

          if (rule.value.rules.length === 0) {
            return [];
          }

          return;
        }

        if (rule.type === "layer-block") {
          const layerName = layerNameStack.pop() ?? "";
          if (!ALLOWED_GENERATED_LAYER_NAMES.has(layerName) || rule.value.rules.length === 0) {
            return [];
          }
        }
      },
    },
  });

  let generatedCss = Buffer.from(result.code).toString("utf8");

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const strippedResult = transform({
      filename: referencePath,
      code: Buffer.from(generatedCss),
      minify: false,
      analyzeDependencies: false,
      visitor: {
        Rule(rule) {
          if (
            (rule.type === "layer-block" ||
              rule.type === "supports" ||
              rule.type === "media" ||
              rule.type === "container") &&
            rule.value.rules.length === 0
          ) {
            return [];
          }
        },
      },
    });

    const nextCss = Buffer.from(strippedResult.code).toString("utf8");
    if (nextCss === generatedCss) {
      break;
    }

    generatedCss = nextCss;
  }

  generatedCss = generatedCss.trim();

  return `/*
 * Synced from the Codex Electron reference CSS.
 * Do not edit by hand. Update the reference file, then rerun:
 *   bun run scripts/sync-codex-theme-utilities.ts
 */

${generatedCss}
`;
};

const run = (): void => {
  const referenceCss = readFileSync(referencePath, "utf8");
  const output = buildGeneratedUtilitiesCss(referenceCss);
  writeFileSync(outputPath, output);

  console.log(`Synced Codex utility CSS to ${outputPath}`);
};

if (import.meta.main) {
  run();
}

export {
  buildGeneratedUtilitiesCss,
  isWindowVariantArbitraryPropertySelector,
  parseStylesheet,
  run,
  selectorFingerprint,
};
