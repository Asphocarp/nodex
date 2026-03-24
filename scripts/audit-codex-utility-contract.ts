import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rendererAssetsDir = resolve(process.cwd(), "out/renderer/assets");

const cssCandidates = readdirSync(rendererAssetsDir)
  .filter((fileName) => fileName.startsWith("index-") && fileName.endsWith(".css"))
  .sort();

if (cssCandidates.length === 0) {
  throw new Error(`No built renderer CSS found in ${rendererAssetsDir}`);
}

const cssPath = resolve(rendererAssetsDir, cssCandidates[cssCandidates.length - 1]);
const css = readFileSync(cssPath, "utf8");

const requiredSelectors = [
  ".icon-2xs{",
  ".heading-dialog{",
  ".text-size-chat{",
  ".font-vscode-editor{",
  ".scroll-contain{",
  ".contain-inline-size{",
  ".\\@container\\/diff-header{",
  ".\\[\\&_\\*\\]\\:text-token-description-foreground\\/80 *{",
  ".\\[\\&_\\*\\]\\:text-token-foreground\\/50 *{",
] as const;

const forbiddenSelectors = [
  ".electron\\:\\[&>svg\\]\\:icon-sm",
  ".electron\\:\\[\\&\\>svg\\]\\:icon-sm",
] as const;

const missingSelectors = requiredSelectors.filter((selector) => !css.includes(selector));
const presentForbiddenSelectors = forbiddenSelectors.filter((selector) =>
  css.includes(selector),
);

console.log(`Build: ${cssPath}`);
console.log(`Required selectors checked: ${requiredSelectors.length}`);
console.log(`Missing selectors: ${missingSelectors.length}`);
console.log(`Forbidden selectors present: ${presentForbiddenSelectors.length}`);

if (missingSelectors.length > 0 || presentForbiddenSelectors.length > 0) {
  if (missingSelectors.length > 0) {
    console.log("Missing:");
    for (const selector of missingSelectors) {
      console.log(`- ${selector}`);
    }
  }

  if (presentForbiddenSelectors.length > 0) {
    console.log("Forbidden present:");
    for (const selector of presentForbiddenSelectors) {
      console.log(`- ${selector}`);
    }
  }

  process.exitCode = 1;
}
