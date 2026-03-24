import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

type DeclarationMap = Map<string, string>;

const DEFAULT_PREFIXES = ["--vscode-", "--color-token-"];
const DEFAULT_REFERENCE_PATH = resolve(
  process.cwd(),
  "design.local/codex-design-tokens/index.css",
);

const normalizeValue = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s*([(),:])\s*/g, "$1")
    .replace(/\s*\/\s*/g, "/")
    .trim();

const extractDeclarations = (
  css: string,
  prefixes: readonly string[],
): DeclarationMap => {
  const declarations = new Map<string, string>();
  const pattern = /(?<=[{;])\s*(--[A-Za-z0-9_.\\-]+)\s*:\s*([^;}]*)/g;

  for (const match of css.matchAll(pattern)) {
    const name = match[1];
    const value = match[2];

    if (!prefixes.some((prefix) => name.startsWith(prefix))) {
      continue;
    }

    declarations.set(name, normalizeValue(value));
  }

  return declarations;
};

const extractVarReferences = (
  css: string,
  prefixes: readonly string[],
): Set<string> => {
  const references = new Set<string>();
  const pattern = /var\((--[A-Za-z0-9_.\\-]+)/g;

  for (const match of css.matchAll(pattern)) {
    const name = match[1];
    if (prefixes.some((prefix) => name.startsWith(prefix))) {
      references.add(name);
    }
  }

  return references;
};

const findLatestBuildCss = (): string => {
  const assetsDir = resolve(process.cwd(), "out/renderer/assets");
  if (!existsSync(assetsDir)) {
    throw new Error(`Renderer assets directory not found: ${assetsDir}`);
  }

  const matches = readdirSync(assetsDir)
    .filter((name) => /^index-.*\.css$/.test(name))
    .map((name) => resolve(assetsDir, name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);

  const latest = matches.at(-1);
  if (!latest) {
    throw new Error("No renderer build CSS found in out/renderer/assets.");
  }

  return latest;
};

const formatList = (title: string, values: readonly string[]): string => {
  if (values.length === 0) {
    return `${title}: 0`;
  }

  return `${title}: ${values.length}\n${values.map((value) => `- ${value}`).join("\n")}`;
};

const args = process.argv.slice(2);
const referencePath = resolve(args[0] ?? DEFAULT_REFERENCE_PATH);
const buildCssPath = resolve(args[1] ?? findLatestBuildCss());
const prefixes = args.length > 2 ? args.slice(2) : DEFAULT_PREFIXES;

if (!existsSync(referencePath)) {
  throw new Error(`Reference CSS not found: ${referencePath}`);
}

if (!existsSync(buildCssPath)) {
  throw new Error(`Build CSS not found: ${buildCssPath}`);
}

const referenceCss = readFileSync(referencePath, "utf8");
const buildCss = readFileSync(buildCssPath, "utf8");

const referenceDeclarations = extractDeclarations(referenceCss, prefixes);
const buildDeclarations = extractDeclarations(buildCss, prefixes);
const buildReferences = extractVarReferences(buildCss, prefixes);

const missingFromBuild = [...referenceDeclarations.keys()]
  .filter((name) => !buildDeclarations.has(name))
  .sort();

const undefinedInBuild = [...buildReferences]
  .filter((name) => !buildDeclarations.has(name))
  .sort();

const differingValues = [...referenceDeclarations.entries()]
  .filter(([name, value]) => buildDeclarations.has(name) && buildDeclarations.get(name) !== value)
  .map(([name, value]) => `${name}\n  ref: ${value}\n  build: ${buildDeclarations.get(name)}`)
  .sort();

const sections = [
  `Reference: ${referencePath}`,
  `Build: ${buildCssPath}`,
  `Prefixes: ${prefixes.join(", ")}`,
  formatList("Missing declarations from build", missingFromBuild),
  formatList("Undefined var() references in build", undefinedInBuild),
  formatList("Differing final declarations", differingValues),
];

console.log(sections.join("\n\n"));

if (
  missingFromBuild.length > 0 ||
  undefinedInBuild.length > 0 ||
  differingValues.length > 0
) {
  process.exitCode = 1;
}
