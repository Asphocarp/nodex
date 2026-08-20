import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  Visitor,
  type ImportDeclaration,
  type JSXAttribute,
  type Program,
} from "oxc-parser";
import {
  parseTypeScriptSource,
  sourcePosition,
} from "../lib/oxc-source";

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
const iconSizeClassPattern = /\bicon-(?:3xs|xxs|2xs|xs|sm|base|md|lg)\b/;

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

function importedNames(declaration: ImportDeclaration): string[] {
  return declaration.specifiers.flatMap((specifier) => {
    if (specifier.type !== "ImportSpecifier") return [];
    return [specifier.imported.type === "Identifier"
      ? specifier.imported.name
      : specifier.imported.value];
  });
}

function verifySharedIconIntrinsicSizing(
  sourceFile: Program,
  sourceText: string,
  path: string,
  failures: string[],
): void {
  new Visitor({
    JSXOpeningElement(node) {
      if (node.name.type !== "JSXIdentifier" || node.name.name !== "svg") return;

      const attributes = node.attributes.filter(
        (attribute): attribute is JSXAttribute => attribute.type === "JSXAttribute",
      );
      const className = attributes.find(
        (attribute) => attribute.name.type === "JSXIdentifier"
          && attribute.name.name === "className",
      );
      const classNameSource = className
        ? sourceText.slice(className.start, className.end)
        : "";
      if (!iconSizeClassPattern.test(classNameSource)) return;

      const attributeNames = new Set(attributes.map((attribute) => (
        attribute.name.type === "JSXIdentifier" ? attribute.name.name : ""
      )));
      if (attributeNames.has("width") && attributeNames.has("height")) return;

      failures.push(
        `${projectPath(path)}:${sourcePosition(sourceText, node.start).line} gives a shared SVG an icon-* default without intrinsic width and height.`,
      );
    },
  }).visit(sourceFile);
}

const failures: string[] = [];
const usedGenericIcons = new Set<string>();
const genericIconExports = new Set<string>();

for (const path of listSourceFiles(rendererRoot)) {
  if (path.includes("/third_party/")) continue;
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = parseTypeScriptSource(path, sourceText);

  for (const statement of sourceFile.body) {
    if (statement.type === "ImportDeclaration") {
      const moduleName = statement.source.value;
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
      || statement.type !== "ExportNamedDeclaration"
      || statement.declaration?.type !== "VariableDeclaration") {
      continue;
    }
    for (const declaration of statement.declaration.declarations) {
      if (declaration.id.type === "Identifier") {
        genericIconExports.add(declaration.id.name);
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

  if (path.startsWith(sharedIconRoot)) {
    verifySharedIconIntrinsicSizing(sourceFile, sourceText, path, failures);
    continue;
  }
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
