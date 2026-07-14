import {
  closeSync,
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  CODEX_RUNTIME_LAYOUT_VERSION,
  REQUIRED_CODEX_RUNTIME_SEARCH_PATH_TOOLS,
  REQUIRED_CODEX_RUNTIME_SIBLING_ARTIFACTS,
  type BundledCodexRuntimeMetadata,
  type CodexRuntimeArtifact,
} from "../src/shared/codex-runtime-metadata";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const require = createRequire(import.meta.url);

type SupportedTargetPlatform = "darwin";
type SupportedTargetArch = "arm64" | "x64";

type CodexRuntimeTarget = {
  packageName: string;
  targetArch: SupportedTargetArch;
  targetPlatform: SupportedTargetPlatform;
  targetTriple: string;
};

type StageCodexRuntimeOptions = {
  outputPath: string;
  packageRoot?: string;
  targetArch: SupportedTargetArch;
  targetPlatform: SupportedTargetPlatform;
};

type CliOptions = StageCodexRuntimeOptions;

export function resolveCodexRuntimeTarget(
  targetPlatform: SupportedTargetPlatform,
  targetArch: SupportedTargetArch,
): CodexRuntimeTarget {
  if (targetPlatform === "darwin" && targetArch === "arm64") {
    return {
      packageName: "@openai/codex-darwin-arm64",
      targetPlatform,
      targetArch,
      targetTriple: "aarch64-apple-darwin",
    };
  }

  if (targetPlatform === "darwin" && targetArch === "x64") {
    return {
      packageName: "@openai/codex-darwin-x64",
      targetPlatform,
      targetArch,
      targetTriple: "x86_64-apple-darwin",
    };
  }

  throw new Error(`Unsupported Codex runtime target: ${targetPlatform}/${targetArch}`);
}

function resolveCodexRuntimePackageRoot(packageName: string): string {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [projectRoot],
    });
    return dirname(packageJsonPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not resolve ${packageName} from node_modules. Install dependencies on a matching target architecture before packaging this runtime. Underlying error: ${message}`,
    );
  }
}

function readPackageVersion(packageRoot: string): string {
  const packageJsonPath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error(`Invalid package version in ${packageJsonPath}`);
  }
  return packageJson.version;
}

function readSha256(filePath: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fileDescriptor = openSync(filePath, "r");
  try {
    for (;;) {
      const bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) return hash.digest("hex");
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fileDescriptor);
  }
}

function replaceDirectory(sourceDir: string, destinationDir: string): void {
  if (!existsSync(destinationDir)) {
    renameSync(sourceDir, destinationDir);
    return;
  }

  const backupDir = mkdtempSync(join(dirname(destinationDir), `${basename(destinationDir)}-backup-`));
  rmSync(backupDir, { recursive: true, force: true });
  renameSync(destinationDir, backupDir);
  try {
    renameSync(sourceDir, destinationDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(destinationDir) && existsSync(backupDir)) {
      renameSync(backupDir, destinationDir);
    }
    throw error;
  }
}

function copyRuntimeDirectory(sourceDir: string, destinationDir: string): void {
  mkdirSync(destinationDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const destinationPath = join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyRuntimeDirectory(sourcePath, destinationPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported entry in bundled Codex runtime: ${sourcePath}`);
    }
    copyFileSync(sourcePath, destinationPath);
    chmodSync(destinationPath, statSync(sourcePath).mode & 0o777);
  }
}

function listRuntimeArtifacts(runtimeRoot: string, currentPath = runtimeRoot): CodexRuntimeArtifact[] {
  const artifacts: CodexRuntimeArtifact[] = [];
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const artifactPath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...listRuntimeArtifacts(runtimeRoot, artifactPath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported staged Codex runtime artifact: ${artifactPath}`);
    }
    const stats = statSync(artifactPath);
    artifacts.push({
      path: relative(runtimeRoot, artifactPath).split(sep).join("/"),
      sha256: readSha256(artifactPath),
      size: stats.size,
      executable: (stats.mode & 0o111) !== 0,
    });
  }
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

export function stageCodexRuntime(options: StageCodexRuntimeOptions): BundledCodexRuntimeMetadata {
  const target = resolveCodexRuntimeTarget(options.targetPlatform, options.targetArch);
  const packageRoot = options.packageRoot ? resolve(options.packageRoot) : resolveCodexRuntimePackageRoot(target.packageName);
  const packageVersion = readPackageVersion(packageRoot);
  const vendorRoot = join(packageRoot, "vendor", target.targetTriple);
  const runtimeBinSourcePath = join(vendorRoot, "bin");
  const rgSourcePath = join(vendorRoot, "codex-path", "rg");

  const outputPath = resolve(options.outputPath);
  const outputParent = dirname(outputPath);
  mkdirSync(outputParent, { recursive: true });
  const tempOutputPath = mkdtempSync(join(outputParent, `${basename(outputPath)}-`));
  const tempBinDir = join(tempOutputPath, "bin");

  try {
    mkdirSync(tempBinDir, { recursive: true });
    copyRuntimeDirectory(runtimeBinSourcePath, tempBinDir);
    const artifacts = listRuntimeArtifacts(tempBinDir);
    const artifactByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
    for (const requiredArtifactPath of REQUIRED_CODEX_RUNTIME_SIBLING_ARTIFACTS) {
      const artifact = artifactByPath.get(requiredArtifactPath);
      if (!artifact?.executable) {
        throw new Error(`Bundled Codex runtime is missing required executable ${requiredArtifactPath}`);
      }
    }
    for (const searchPathTool of REQUIRED_CODEX_RUNTIME_SEARCH_PATH_TOOLS) {
      if (artifactByPath.has(searchPathTool)) {
        throw new Error(`Bundled Codex runtime search-path tool conflicts with native artifact ${searchPathTool}`);
      }
    }

    copyFileSync(rgSourcePath, join(tempBinDir, "rg"));
    chmodSync(join(tempBinDir, "rg"), statSync(rgSourcePath).mode & 0o777);
    for (const searchPathTool of REQUIRED_CODEX_RUNTIME_SEARCH_PATH_TOOLS) {
      const toolStats = statSync(join(tempBinDir, searchPathTool));
      if (!toolStats.isFile() || (toolStats.mode & 0o111) === 0) {
        throw new Error(`Bundled Codex runtime is missing required search-path tool ${searchPathTool}`);
      }
    }

    const metadata: BundledCodexRuntimeMetadata = {
      layoutVersion: CODEX_RUNTIME_LAYOUT_VERSION,
      codexVersion: packageVersion.replace(/-(darwin-(arm64|x64))$/, ""),
      targetPlatform: target.targetPlatform,
      targetArch: target.targetArch,
      targetTriple: target.targetTriple,
      sourcePackage: `${target.packageName}@${packageVersion}`,
      artifacts,
      searchPathTools: [...REQUIRED_CODEX_RUNTIME_SEARCH_PATH_TOOLS],
    };

    writeFileSync(join(tempBinDir, "runtime.json"), JSON.stringify(metadata, null, 2), "utf8");

    replaceDirectory(tempOutputPath, outputPath);
    return metadata;
  } finally {
    rmSync(tempOutputPath, { recursive: true, force: true });
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const args = argv.filter((value) => value !== "--");
  let targetPlatform: SupportedTargetPlatform | null = null;
  let targetArch: SupportedTargetArch | null = null;
  let outputPath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = args[index + 1];

    if (arg === "--target-platform") {
      if (nextValue !== "darwin") {
        throw new Error(`Unsupported --target-platform value: ${nextValue ?? "<missing>"}`);
      }
      targetPlatform = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--target-arch") {
      if (nextValue !== "arm64" && nextValue !== "x64") {
        throw new Error(`Unsupported --target-arch value: ${nextValue ?? "<missing>"}`);
      }
      targetArch = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--out") {
      if (!nextValue) {
        throw new Error("Missing value for --out");
      }
      outputPath = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!targetPlatform || !targetArch || !outputPath) {
    throw new Error("Usage: pnpm run scripts/stage-codex-runtime.ts --target-platform darwin --target-arch <arm64|x64> --out <dir>");
  }

  return {
    targetPlatform,
    targetArch,
    outputPath: resolve(projectRoot, outputPath),
  };
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  stageCodexRuntime(options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
