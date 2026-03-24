import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  findMatches,
  flattenCssNodes,
  normalizeRawCssBody,
  parseCssNodes,
} from "./codex-css-extract";

const referencePath = resolve(
  process.cwd(),
  "design.local/codex-design-tokens/index.css",
);
const outputPath = resolve(
  process.cwd(),
  "src/renderer/styles/theme-codex-surface.generated.css",
);

const getMergedBody = (
  matches: ReturnType<typeof flattenCssNodes>,
  selector: string,
  parents: string[] = [],
): string => {
  const selectedMatches = findMatches(matches, selector, parents);
  if (selectedMatches.length === 0) {
    throw new Error(`Missing selector ${selector} in ${parents.join(" > ") || "root"}`);
  }

  return selectedMatches.map((match) => match.body.trim()).join("\n");
};

const formatRawBlock = (selector: string, body: string): string =>
  `${selector} {\n${normalizeRawCssBody(body)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}\n}`;

const formatRawNestedBlock = (
  prelude: string,
  selector: string,
  body: string,
): string =>
  `${prelude} {\n${formatRawBlock(selector, body)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}\n}`;

const formatRawKeyframes = (name: string, body: string): string =>
  `@keyframes ${name} {\n${normalizeRawCssBody(body)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}\n}`;

const run = (): void => {
  const css = readFileSync(referencePath, "utf8");
  const matches = flattenCssNodes(parseCssNodes(css));

  const sections = [
    "/*",
    " * Synced from the Codex Electron reference CSS.",
    " * Do not edit by hand. Update the reference file, then rerun:",
    " *   bun run scripts/sync-codex-theme-surface.ts",
    " */",
    "",
    formatRawBlock(
      ".loading-shimmer-pure-text,\n.loading-shimmer",
      getMergedBody(matches, ".loading-shimmer-pure-text, .loading-shimmer", [
        "@layer components",
      ]),
    ),
    "",
    formatRawNestedBlock(
      "@supports (color: color-mix(in lab, red, red))",
      ".loading-shimmer-pure-text,\n.loading-shimmer",
      getMergedBody(matches, ".loading-shimmer-pure-text, .loading-shimmer", [
        "@layer components",
        "@supports (color: color-mix(in lab, red, red))",
      ]),
    ),
    "",
    formatRawBlock(
      ".dark .loading-shimmer-pure-text,\n.dark .loading-shimmer",
      getMergedBody(matches, ".dark .loading-shimmer-pure-text, .dark .loading-shimmer", [
        "@layer components",
      ]),
    ),
    "",
    formatRawNestedBlock(
      "@supports (color: color-mix(in lab, red, red))",
      ".dark .loading-shimmer-pure-text,\n.dark .loading-shimmer",
      getMergedBody(matches, ".dark .loading-shimmer-pure-text, .dark .loading-shimmer", [
        "@layer components",
        "@supports (color: color-mix(in lab, red, red))",
      ]),
    ),
    "",
    formatRawBlock(
      ".loading-shimmer:hover",
      getMergedBody(matches, ".loading-shimmer:hover", ["@layer components"]),
    ),
    "",
    formatRawBlock(
      ".loading-shimmer-pure-text-inverted",
      getMergedBody(matches, ".loading-shimmer-pure-text-inverted", [
        "@layer components",
      ]),
    ),
    "",
    formatRawNestedBlock(
      "@media (prefers-reduced-motion: reduce)",
      ".loading-shimmer-pure-text,\n.loading-shimmer",
      getMergedBody(matches, ".loading-shimmer-pure-text, .loading-shimmer", [
        "@layer components",
        "@media (prefers-reduced-motion: reduce)",
      ]),
    ),
    "",
    formatRawNestedBlock(
      "@media (prefers-reduced-motion: reduce)",
      ".loading-shimmer-pure-text-inverted",
      getMergedBody(matches, ".loading-shimmer-pure-text-inverted", [
        "@layer components",
        "@media (prefers-reduced-motion: reduce)",
      ]),
    ),
    "",
    formatRawKeyframes(
      "loading-shimmer",
      getMergedBody(matches, "@keyframes loading-shimmer"),
    ),
    "",
  ];

  writeFileSync(outputPath, sections.join("\n"));

  console.log(`Synced Codex surface CSS to ${outputPath}`);
};

if (import.meta.main) {
  run();
}

export { run };
