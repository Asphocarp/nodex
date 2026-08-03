import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const projectRoot = resolve(import.meta.dirname, "../..");
const rendererRoot = resolve(projectRoot, "src/renderer");
const sharedIconRoot = resolve(rendererRoot, "components/shared/icons");
const genericIconModule = resolve(sharedIconRoot, "generic-icons.tsx");
const inlineSvgBaselinePath = resolve(
  import.meta.dirname,
  "icon-inline-svg-baseline.json",
);
const inlineSvgBaseline = JSON.parse(
  readFileSync(inlineSvgBaselinePath, "utf8"),
) as Record<string, number>;

const sourceExtensions = new Set([".ts", ".tsx"]);

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return listSourceFiles(path);
    if (![...sourceExtensions].some((extension) => path.endsWith(extension))) {
      return [];
    }
    return [path];
  });
}

function projectPath(path: string): string {
  return relative(projectRoot, path);
}

function importedNames(declaration: ts.ImportDeclaration): string[] {
  const bindings = declaration.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  return bindings.elements.map((element) =>
    (element.propertyName ?? element.name).text
  );
}

const failures: string[] = [];
const usedGenericIcons = new Set<string>();
const genericIconExports = new Set<string>();

for (const path of listSourceFiles(rendererRoot)) {
  if (path.includes("/third_party/")) continue;
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleName = statement.moduleSpecifier.text;
      if (moduleName === "lucide-react" && path !== genericIconModule) {
        failures.push(
          `${projectPath(path)} imports lucide-react directly; use the shared icon boundary.`,
        );
      }
      if (moduleName === "@/components/shared/icons/generic-icons") {
        importedNames(statement).forEach((name) => usedGenericIcons.add(name));
      }
    }

    if (path !== genericIconModule
      || !ts.isVariableStatement(statement)
      || !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        genericIconExports.add(declaration.name.text);
      }
    }
  }

  const prefixedIconName = sourceText.match(
    /\b(?:function|const|class)\s+(Codex[A-Za-z0-9_]*Icon(?:Svg|Sprite)?)\b/,
  );
  if (prefixedIconName) {
    failures.push(
      `${projectPath(path)} declares ${prefixedIconName[1]}; app-owned icon names must describe semantics, not provenance.`,
    );
  }

  if (path.startsWith(sharedIconRoot)) continue;
  const inlineSvgCount = sourceText.match(/<svg\b/g)?.length ?? 0;
  if (inlineSvgCount === 0) continue;
  const relativePath = projectPath(path);
  const allowedCount = inlineSvgBaseline[relativePath] ?? 0;
  if (inlineSvgCount > allowedCount) {
    failures.push(
      `${relativePath} contains ${inlineSvgCount} inline SVGs (baseline ${allowedCount}); move reusable glyphs into components/shared/icons or explicitly review the exception.`,
    );
  }
}

for (const iconName of genericIconExports) {
  if (usedGenericIcons.has(iconName)) continue;
  failures.push(
    `generic-icons.tsx exports unused ${iconName}; keep the generic adapter curated to active call sites.`,
  );
}

if (failures.length > 0) {
  throw new Error(["Icon boundary verification failed:", ...failures].join("\n- "));
}

console.log(
  `Icon boundaries verified: ${genericIconExports.size} generic glyphs, ${Object.keys(inlineSvgBaseline).length} ratcheted inline-SVG exceptions.`,
);
