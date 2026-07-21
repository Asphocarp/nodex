import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const require = createRequire(import.meta.url);

const allowedAdditiveDifferences = new Set([
  "ClientRequest.ts",
  "FunctionCallOutputContentItem.ts",
  "v2/ModelListParams.ts",
  "v2/ThreadSettingsUpdateParams.ts",
  "v2/index.ts",
]);

type CompatibilityReport = {
  activeOnlyFiles: string[];
  activeOnlyMethods: string[];
  activeRuntime: string;
  baselineRuntime: string;
  commonFileCount: number;
};

function listFiles(rootPath: string, currentPath = rootPath): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(rootPath, entryPath));
      continue;
    }
    if (entry.isFile()) files.push(path.relative(rootPath, entryPath).split(path.sep).join("/"));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function read(rootPath: string, relativePath: string): string {
  return readFileSync(path.join(rootPath, ...relativePath.split("/")), "utf8");
}

function extractDiscriminants(source: string, key: "method" | "type"): Set<string> {
  const values = new Set<string>();
  const expression = new RegExp(`"${key}": "([^"]+)"`, "gu");
  for (const match of source.matchAll(expression)) {
    if (match[1]) values.add(match[1]);
  }
  return values;
}

function extractExportedTypeNames(source: string): Set<string> {
  const values = new Set<string>();
  for (const match of source.matchAll(/export type \{ ([A-Za-z0-9_]+) \}/gu)) {
    if (match[1]) values.add(match[1]);
  }
  return values;
}

function extractTopLevelFieldNames(source: string): Set<string> {
  const declaration = /export type [A-Za-z0-9_]+ = \{([\s\S]*)\};\s*$/u.exec(source)?.[1];
  if (!declaration) throw new Error("Could not parse generated TypeScript object declaration");
  const values = new Set<string>();
  for (const match of declaration.matchAll(/(?:^|\n|,\s*)([A-Za-z_][A-Za-z0-9_]*)(?:\?|):/gu)) {
    if (match[1]) values.add(match[1]);
  }
  return values;
}

function assertSetSuperset(
  active: Set<string>,
  baseline: Set<string>,
  label: string,
): void {
  const missing = [...baseline].filter((value) => !active.has(value));
  if (missing.length > 0) {
    throw new Error(`Active app-server schema narrows ${label}: missing ${missing.join(", ")}`);
  }
}

function compareAllowedFile(relativePath: string, active: string, baseline: string): void {
  if (relativePath === "ClientRequest.ts") {
    assertSetSuperset(
      extractDiscriminants(active, "method"),
      extractDiscriminants(baseline, "method"),
      "client request methods",
    );
    return;
  }
  if (relativePath === "FunctionCallOutputContentItem.ts") {
    assertSetSuperset(
      extractDiscriminants(active, "type"),
      extractDiscriminants(baseline, "type"),
      "function call output variants",
    );
    return;
  }
  if (relativePath === "v2/index.ts") {
    assertSetSuperset(
      extractExportedTypeNames(active),
      extractExportedTypeNames(baseline),
      "v2 exports",
    );
    return;
  }
  assertSetSuperset(
    extractTopLevelFieldNames(active),
    extractTopLevelFieldNames(baseline),
    `${relativePath} fields`,
  );
}

function resolveStockLauncher(): string {
  const packageJsonPath = require.resolve("@openai/codex/package.json", { paths: [projectRoot] });
  return path.join(path.dirname(packageJsonPath), "bin", "codex.js");
}

function generateTypes(input: {
  executable: string;
  executableArgs: string[];
  outputPath: string;
}): void {
  execFileSync(input.executable, [
    ...input.executableArgs,
    "app-server",
    "generate-ts",
    "--experimental",
    "--out",
    input.outputPath,
  ], { cwd: projectRoot, stdio: "pipe" });
}

export function compareGeneratedTypeTrees(input: {
  activePath: string;
  activeRuntime: string;
  baselinePath: string;
  baselineRuntime: string;
}): CompatibilityReport {
  const activeFiles = listFiles(input.activePath);
  const baselineFiles = listFiles(input.baselinePath);
  const activeSet = new Set(activeFiles);
  const missingFiles = baselineFiles.filter((file) => !activeSet.has(file));
  if (missingFiles.length > 0) {
    throw new Error(`Active app-server schema is missing baseline files: ${missingFiles.join(", ")}`);
  }

  for (const relativePath of baselineFiles) {
    const active = read(input.activePath, relativePath);
    const baseline = read(input.baselinePath, relativePath);
    if (active === baseline) continue;
    if (!allowedAdditiveDifferences.has(relativePath)) {
      throw new Error(`Unreviewed app-server schema difference in ${relativePath}`);
    }
    compareAllowedFile(relativePath, active, baseline);
  }

  const activeMethods = extractDiscriminants(read(input.activePath, "ClientRequest.ts"), "method");
  const baselineMethods = extractDiscriminants(read(input.baselinePath, "ClientRequest.ts"), "method");
  return {
    activeOnlyFiles: activeFiles.filter((file) => !baselineFiles.includes(file)),
    activeOnlyMethods: [...activeMethods].filter((method) => !baselineMethods.has(method)).sort(),
    activeRuntime: input.activeRuntime,
    baselineRuntime: input.baselineRuntime,
    commonFileCount: baselineFiles.length,
  };
}

function main(): void {
  const outputRoot = mkdtempSync(path.join(os.tmpdir(), "nodex-app-server-compatibility-"));
  try {
    const runtime = resolveCodexRuntime({ isPackaged: false, projectRootPath: projectRoot });
    const activePath = path.join(outputRoot, "active");
    const baselinePath = path.join(outputRoot, "baseline");
    const stockLauncher = resolveStockLauncher();
    generateTypes({ executable: runtime.binaryPath, executableArgs: [], outputPath: activePath });
    generateTypes({ executable: process.execPath, executableArgs: [stockLauncher], outputPath: baselinePath });
    const report = compareGeneratedTypeTrees({
      activePath,
      activeRuntime: `${runtime.runtimeFamily}@${runtime.version ?? "unknown"}`,
      baselinePath,
      baselineRuntime: `@openai/codex@${JSON.parse(
        readFileSync(path.join(path.dirname(stockLauncher), "..", "package.json"), "utf8"),
      ).version as string}`,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
