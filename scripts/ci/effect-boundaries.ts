import { Visitor, type ImportDeclaration } from "oxc-parser";
import { parseTypeScriptSource, sourcePosition } from "../lib/oxc-source";

export type EffectBoundaryDiagnosticCode =
  | "effect-free-import"
  | "run-outside-boundary"
  | "unstable-outside-adapter";

export interface EffectBoundaryDiagnostic {
  readonly code: EffectBoundaryDiagnosticCode;
  readonly column: number;
  readonly line: number;
  readonly message: string;
  readonly path: string;
}

interface EffectBoundaryInput {
  readonly path: string;
  readonly sourceText: string;
}

const effectFreeRoots = [
  "packages/codex-app-server-protocol/",
  "packages/core-protocol/",
  "src/preload/",
  "src/renderer/",
  "src/shared/",
];

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isEffectModule(moduleName: string): boolean {
  return (
    moduleName === "effect" || moduleName.startsWith("effect/") || moduleName.startsWith("@effect/")
  );
}

function isUnstableEffectModule(moduleName: string): boolean {
  return moduleName.includes("/unstable/") || moduleName.endsWith("/unstable");
}

function isEffectFreePath(path: string): boolean {
  return effectFreeRoots.some((root) => path.startsWith(root));
}

function isEffectAdapter(path: string): boolean {
  return (
    path.startsWith("src/main/platform/") ||
    path.startsWith("packages/effect-codex-app-server/") ||
    path === "scripts/codex-probe-session.ts"
  );
}

function isEffectRuntimeBoundary(path: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return true;
  return path === "src/main/app/MainEntry.ts" || path === "scripts/dev-launcher.ts";
}

function effectNamespaceFromImport(declaration: ImportDeclaration): string[] {
  if (declaration.source.value !== "effect") return [];
  return declaration.specifiers.flatMap((specifier) => {
    if (specifier.type === "ImportNamespaceSpecifier") return [specifier.local.name];
    if (
      specifier.type === "ImportSpecifier" &&
      (specifier.imported.type === "Identifier"
        ? specifier.imported.name === "Effect"
        : specifier.imported.value === "Effect")
    ) {
      return [specifier.local.name];
    }
    return [];
  });
}

export function analyzeEffectBoundaries({
  path: inputPath,
  sourceText,
}: EffectBoundaryInput): EffectBoundaryDiagnostic[] {
  const path = normalizeProjectPath(inputPath);
  const program = parseTypeScriptSource(path, sourceText);
  const diagnostics: EffectBoundaryDiagnostic[] = [];
  const effectNamespaces = new Set<string>();

  const report = (code: EffectBoundaryDiagnosticCode, offset: number, message: string): void => {
    const position = sourcePosition(sourceText, offset);
    diagnostics.push({ code, column: position.column, line: position.line, message, path });
  };

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const moduleName = statement.source.value;
    effectNamespaceFromImport(statement).forEach((name) => effectNamespaces.add(name));
    if (!isEffectModule(moduleName)) continue;

    if (isEffectFreePath(path)) {
      report(
        "effect-free-import",
        statement.start,
        `${path} belongs to an Effect-free renderer, preload, shared, or wire-contract boundary.`,
      );
    }
    if (isUnstableEffectModule(moduleName) && !isEffectAdapter(path)) {
      report(
        "unstable-outside-adapter",
        statement.start,
        `${moduleName} is unstable and may only be imported by a dedicated platform or companion-package adapter.`,
      );
    }
  }

  new Visitor({
    CallExpression(node) {
      if (isEffectRuntimeBoundary(path) || node.callee.type !== "MemberExpression") return;
      if (node.callee.object.type !== "Identifier") return;
      if (!effectNamespaces.has(node.callee.object.name)) return;
      if (node.callee.property.type !== "Identifier") return;
      if (!/^run(?:Promise|Fork|Sync)/.test(node.callee.property.name)) return;

      report(
        "run-outside-boundary",
        node.start,
        `${node.callee.object.name}.${node.callee.property.name} may only run at a designated runtime boundary or in tests.`,
      );
    },
  }).visit(program);

  return diagnostics;
}
