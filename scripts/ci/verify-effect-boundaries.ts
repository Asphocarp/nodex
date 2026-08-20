import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { analyzeEffectBoundaries } from "./effect-boundaries";

const projectRoot = resolve(import.meta.dirname, "../..");
const sourceRoots = ["packages", "scripts", "src"];
const sourceExtensions = new Set([".cts", ".mts", ".ts", ".tsx"]);
const excludedSegments = [
  "/dist/",
  "/fixtures/",
  "/generated/",
  "/node_modules/",
  "/runtime-schemas/",
];

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (excludedSegments.some((segment) => `${path}/`.includes(segment))) return [];
      return listSourceFiles(path);
    }
    if (!entry.isFile() || !sourceExtensions.has(extname(path))) return [];
    return [path];
  });
}

const diagnostics = sourceRoots.flatMap((root) =>
  listSourceFiles(resolve(projectRoot, root)).flatMap((path) =>
    analyzeEffectBoundaries({
      path: relative(projectRoot, path),
      sourceText: readFileSync(path, "utf8"),
    }),
  ),
);

if (diagnostics.length > 0) {
  throw new Error(
    [
      "Effect boundary verification failed:",
      ...diagnostics.map(
        (diagnostic) =>
          `${diagnostic.path}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`,
      ),
    ].join("\n"),
  );
}

console.log(
  "Effect boundaries verified: renderer, preload, shared, and wire contracts remain Effect-free.",
);
