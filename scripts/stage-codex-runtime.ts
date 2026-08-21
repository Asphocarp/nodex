import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
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
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  AGENT_RUNTIME_LAYOUT_VERSION,
  AGENT_RUNTIME_METADATA_FILENAME,
  type AgentRuntimeArtifact,
  type BundledAgentRuntimeMetadata,
  type OpenInterpreterPackageManifest,
  parseBundledAgentRuntimeMetadata,
} from "../src/shared/codex-runtime-metadata";
import {
  readOpenInterpreterReleaseLock,
  resolveOpenInterpreterReleaseLockPath,
  type AgentRuntimeTargetArch,
  type AgentRuntimeTargetPlatform,
  type OpenInterpreterReleaseLock,
} from "./agent-runtime-release-lock";
import { replaceOwnedDirectory } from "./replace-owned-directory";
import { stageBrowserRuntime } from "./stage-browser-runtime";
import type { BrowserRuntimePlatformArtifactVerifier } from "../src/main/codex/browser-runtime-bundle";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const EXECUTABLE_RUNTIME_MODE = 0o755;
const REGULAR_RUNTIME_MODE = 0o644;
const canonicalRuntimeMode = (executable: boolean): number =>
  executable ? EXECUTABLE_RUNTIME_MODE : REGULAR_RUNTIME_MODE;

type StageAgentRuntimeOptions = {
  archivePath?: string;
  browserRuntimePlatformArtifactVerifier?: BrowserRuntimePlatformArtifactVerifier;
  browserRuntimeSourceRoot?: string;
  cachePath?: string;
  lockPath?: string;
  outputPath: string;
  projectRootPath?: string;
  reuseExisting?: boolean;
  sourceRoot?: string;
  targetArch: AgentRuntimeTargetArch;
  targetPlatform: AgentRuntimeTargetPlatform;
};

type CliOptions = StageAgentRuntimeOptions;

export type AgentRuntimeTarget = {
  targetArch: AgentRuntimeTargetArch;
  targetKey: `darwin-${AgentRuntimeTargetArch}`;
  targetPlatform: AgentRuntimeTargetPlatform;
  targetTriple: string;
};

export function resolveCodexRuntimeTarget(
  targetPlatform: AgentRuntimeTargetPlatform,
  targetArch: AgentRuntimeTargetArch,
): AgentRuntimeTarget {
  if (targetPlatform !== "darwin") {
    throw new Error(`Unsupported agent runtime target: ${targetPlatform}/${targetArch}`);
  }
  return {
    targetPlatform,
    targetArch,
    targetKey: `darwin-${targetArch}`,
    targetTriple: targetArch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin",
  };
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

function assertRegularFile(filePath: string, label: string): void {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    throw new Error(`Open Interpreter release is missing ${label}: ${filePath}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Open Interpreter release ${label} is not a regular file: ${filePath}`);
  }
}

function assertNoSymlinks(rootPath: string, currentPath = rootPath): void {
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = join(currentPath, entry.name);
    const stats = lstatSync(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Open Interpreter release contains a symlink: ${relative(rootPath, entryPath)}`,
      );
    }
    if (stats.isDirectory()) {
      assertNoSymlinks(rootPath, entryPath);
      continue;
    }
    if (!stats.isFile()) {
      throw new Error(
        `Open Interpreter release contains an unsupported entry: ${relative(rootPath, entryPath)}`,
      );
    }
  }
}

function copyRuntimeFile(sourcePath: string, destinationPath: string): void {
  assertRegularFile(sourcePath, relative(dirname(sourcePath), sourcePath));
  const sourceMode = statSync(sourcePath).mode;
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
  chmodSync(destinationPath, canonicalRuntimeMode((sourceMode & 0o111) !== 0));
}

function listRuntimeArtifacts(
  runtimeRoot: string,
  currentPath = runtimeRoot,
): AgentRuntimeArtifact[] {
  const artifacts: AgentRuntimeArtifact[] = [];
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const artifactPath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...listRuntimeArtifacts(runtimeRoot, artifactPath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported staged agent runtime artifact: ${artifactPath}`);
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

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const bundledAgentRuntimeMetadataSha256 = (metadata: BundledAgentRuntimeMetadata): string =>
  createHash("sha256").update(canonicalJson(metadata)).digest("hex");

const metadataMatchesLock = (input: {
  lock: OpenInterpreterReleaseLock;
  metadata: BundledAgentRuntimeMetadata;
  target: AgentRuntimeTarget;
}): boolean => {
  const { lock, metadata, target } = input;
  const asset = lock.assets[target.targetKey];
  return (
    bundledAgentRuntimeMetadataSha256(metadata) === asset.runtimeMetadataSha256 &&
    metadata.codexCompatibilityVersion === lock.codexCompatibilityVersion &&
    metadata.entrypoint === lock.packageManifest.entrypoint &&
    metadata.packageManifest.layoutVersion === lock.packageManifest.layoutVersion &&
    metadata.packageManifest.pathDir === lock.packageManifest.pathDir &&
    metadata.packageManifest.resourcesDir === lock.packageManifest.resourcesDir &&
    metadata.packageManifest.target === target.targetTriple &&
    metadata.packageManifest.variant === lock.packageManifest.variant &&
    metadata.packageManifest.version === lock.packageManifest.version &&
    metadata.runtimeFamily === lock.runtimeFamily &&
    metadata.runtimeVersion === lock.runtimeVersion &&
    JSON.stringify(metadata.searchPaths) === JSON.stringify([lock.packageManifest.pathDir]) &&
    metadata.artifactRelease.archiveSha256 === asset.archiveSha256 &&
    metadata.artifactRelease.assetName === asset.assetName &&
    metadata.artifactRelease.repository === lock.release.repository &&
    metadata.artifactRelease.tag === lock.release.tag &&
    metadata.sourceRevision.commit === lock.source.commit &&
    JSON.stringify(metadata.sourceRevision.patches) ===
      JSON.stringify(
        lock.source.patches.map((patch) => ({ path: patch.artifactPath, sha256: patch.sha256 })),
      ) &&
    metadata.sourceRevision.repository === lock.source.repository &&
    metadata.targetArch === target.targetArch &&
    metadata.targetPlatform === target.targetPlatform &&
    metadata.targetTriple === target.targetTriple
  );
};

function readReusableRuntime(input: {
  lock: OpenInterpreterReleaseLock;
  outputPath: string;
  repositoryRoot: string;
  target: AgentRuntimeTarget;
}): BundledAgentRuntimeMetadata | null {
  const runtimeRoot = join(input.outputPath, "agent-runtime");
  const metadataPath = join(runtimeRoot, AGENT_RUNTIME_METADATA_FILENAME);
  let metadata: BundledAgentRuntimeMetadata | null;
  try {
    const runtimeRootStats = lstatSync(runtimeRoot);
    if (!runtimeRootStats.isDirectory() || runtimeRootStats.isSymbolicLink()) return null;
    const stats = lstatSync(metadataPath);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    if ((stats.mode & 0o777) !== REGULAR_RUNTIME_MODE) return null;
    metadata = parseBundledAgentRuntimeMetadata(
      JSON.parse(readFileSync(metadataPath, "utf8")) as unknown,
    );
  } catch {
    return null;
  }
  if (!metadata || !metadataMatchesLock({ lock: input.lock, metadata, target: input.target })) {
    return null;
  }

  const expectedPaths = [
    ...input.lock.requiredArtifacts,
    "third-party/open-interpreter/LICENSE",
    "third-party/open-interpreter/NOTICE",
  ].sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(metadata.artifacts.map(({ path }) => path)) !== JSON.stringify(expectedPaths)
  ) {
    return null;
  }

  let actualArtifacts: AgentRuntimeArtifact[];
  try {
    actualArtifacts = listRuntimeArtifacts(runtimeRoot).filter(
      ({ path }) =>
        path !== AGENT_RUNTIME_METADATA_FILENAME && !path.startsWith("browser-runtime/"),
    );
  } catch {
    return null;
  }
  if (JSON.stringify(actualArtifacts) !== JSON.stringify(metadata.artifacts)) return null;
  for (const artifact of metadata.artifacts) {
    const mode = lstatSync(join(runtimeRoot, ...artifact.path.split("/"))).mode & 0o777;
    if (mode !== (artifact.executable ? 0o755 : 0o644)) return null;
  }

  const licensePath = join(input.repositoryRoot, ...input.lock.notices.licensePath.split("/"));
  const noticePath = join(input.repositoryRoot, ...input.lock.notices.noticePath.split("/"));
  try {
    if (
      readSha256(licensePath) !== input.lock.notices.licenseSha256 ||
      readSha256(noticePath) !== input.lock.notices.noticeSha256
    )
      return null;
  } catch {
    return null;
  }
  return metadata;
}

function readAndValidatePackageManifest(
  sourceRoot: string,
  lock: OpenInterpreterReleaseLock,
  targetTriple: string,
): OpenInterpreterPackageManifest {
  const manifestPath = join(sourceRoot, "codex-package.json");
  assertRegularFile(manifestPath, "codex-package.json");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`Invalid Open Interpreter package manifest at ${manifestPath}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Open Interpreter package manifest at ${manifestPath}`);
  }
  const candidate = value as Record<string, unknown>;
  const expected = lock.packageManifest;
  if (
    candidate.layoutVersion !== expected.layoutVersion ||
    candidate.version !== expected.version ||
    candidate.variant !== expected.variant ||
    candidate.entrypoint !== expected.entrypoint ||
    candidate.resourcesDir !== expected.resourcesDir ||
    candidate.pathDir !== expected.pathDir ||
    candidate.target !== targetTriple
  ) {
    throw new Error(
      `Open Interpreter package manifest does not match the release lock for ${targetTriple}`,
    );
  }
  return {
    layoutVersion: expected.layoutVersion,
    version: expected.version,
    target: targetTriple,
    variant: expected.variant,
    entrypoint: expected.entrypoint,
    resourcesDir: expected.resourcesDir,
    pathDir: expected.pathDir,
  };
}

function validateArchive(archivePath: string, expectedSha256: string, expectedSize: number): void {
  assertRegularFile(archivePath, "release archive");
  const stats = statSync(archivePath);
  if (stats.size !== expectedSize) {
    throw new Error(
      `Open Interpreter archive size mismatch: expected ${expectedSize}, found ${stats.size}`,
    );
  }
  const actualSha256 = readSha256(archivePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Open Interpreter archive checksum mismatch: expected ${expectedSha256}, found ${actualSha256}`,
    );
  }
}

function validateArchivePaths(archivePath: string): void {
  const entries = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" })
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.includes("\\")) {
      throw new Error(`Open Interpreter archive contains an unsafe path: ${entry}`);
    }
    const segments = entry.replace(/\/$/u, "").split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      throw new Error(`Open Interpreter archive contains an unsafe path: ${entry}`);
    }
  }
}

async function downloadArchive(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Open Interpreter runtime: HTTP ${response.status}`);
  }
  mkdirSync(dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.part-${process.pid}`;
  try {
    const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
    await pipeline(body, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
    renameSync(temporaryPath, destinationPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

async function resolveSourceRoot(input: {
  archivePath?: string;
  cachePath: string;
  extractionParent: string;
  lock: OpenInterpreterReleaseLock;
  sourceRoot?: string;
  target: AgentRuntimeTarget;
}): Promise<{ cleanup: () => void; sourceRoot: string }> {
  if (input.sourceRoot) {
    const sourceRoot = resolve(input.sourceRoot);
    assertNoSymlinks(sourceRoot);
    return { sourceRoot, cleanup: () => undefined };
  }

  const asset = input.lock.assets[input.target.targetKey];
  const archivePath = resolve(
    input.archivePath ?? join(input.cachePath, input.lock.release.tag, asset.assetName),
  );
  if (!existsSync(archivePath)) {
    await downloadArchive(asset.url, archivePath);
  }
  validateArchive(archivePath, asset.archiveSha256, asset.archiveSize);
  validateArchivePaths(archivePath);

  const extractionRoot = mkdtempSync(join(input.extractionParent, "open-interpreter-extract-"));
  try {
    execFileSync("tar", ["-xzf", archivePath, "-C", extractionRoot]);
    assertNoSymlinks(extractionRoot);
    return {
      sourceRoot: extractionRoot,
      cleanup: () => rmSync(extractionRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(extractionRoot, { recursive: true, force: true });
    throw error;
  }
}

function validateNotice(input: {
  destinationPath: string;
  expectedSha256: string;
  label: string;
  sourcePath: string;
}): void {
  assertRegularFile(input.sourcePath, input.label);
  const sha256 = readSha256(input.sourcePath);
  if (sha256 !== input.expectedSha256) {
    throw new Error(`${input.label} checksum does not match the Open Interpreter release lock`);
  }
  copyRuntimeFile(input.sourcePath, input.destinationPath);
}

export async function stageCodexRuntime(
  options: StageAgentRuntimeOptions,
): Promise<BundledAgentRuntimeMetadata> {
  const repositoryRoot = resolve(options.projectRootPath ?? projectRoot);
  const lockPath = resolve(
    options.lockPath ?? resolveOpenInterpreterReleaseLockPath(repositoryRoot),
  );
  const lock = readOpenInterpreterReleaseLock(lockPath);
  const target = resolveCodexRuntimeTarget(options.targetPlatform, options.targetArch);
  const asset = lock.assets[target.targetKey];
  if (asset.targetTriple !== target.targetTriple) {
    throw new Error(`Open Interpreter release lock target mismatch for ${target.targetKey}`);
  }

  const outputPath = resolve(options.outputPath);
  const outputParent = dirname(outputPath);
  mkdirSync(outputParent, { recursive: true });
  if (existsSync(outputPath) && lstatSync(outputPath).isSymbolicLink()) {
    throw new Error(`Agent runtime output root must not be a symlink: ${outputPath}`);
  }
  mkdirSync(outputPath, { recursive: true });
  if (options.reuseExisting) {
    const reusable = readReusableRuntime({
      lock,
      outputPath,
      repositoryRoot,
      target,
    });
    if (reusable) {
      if (options.browserRuntimeSourceRoot) {
        stageBrowserRuntime({
          expectedCodexCompatibilityVersion: reusable.codexCompatibilityVersion,
          platformArtifactVerifier: options.browserRuntimePlatformArtifactVerifier,
          runtimeRoot: join(outputPath, "agent-runtime"),
          sourceRoot: options.browserRuntimeSourceRoot,
          targetArch: target.targetArch,
          targetPlatform: target.targetPlatform,
        });
      }
      process.stderr.write("Reused verified staged agent runtime.\n");
      return reusable;
    }
  }
  const tempOutputPath = mkdtempSync(join(outputPath, ".agent-runtime-stage-"));
  const tempRuntimeRoot = join(tempOutputPath, "agent-runtime");
  const cachePath = resolve(
    options.cachePath ?? join(repositoryRoot, ".generated", "agent-runtime-cache"),
  );
  let sourceCleanup = (): void => undefined;

  try {
    const resolvedSource = await resolveSourceRoot({
      archivePath: options.archivePath,
      cachePath,
      extractionParent: outputParent,
      lock,
      sourceRoot: options.sourceRoot,
      target,
    });
    sourceCleanup = resolvedSource.cleanup;
    const packageManifest = readAndValidatePackageManifest(
      resolvedSource.sourceRoot,
      lock,
      target.targetTriple,
    );

    for (const artifactPath of lock.requiredArtifacts) {
      const sourcePath = join(resolvedSource.sourceRoot, ...artifactPath.split("/"));
      const destinationPath = join(tempRuntimeRoot, ...artifactPath.split("/"));
      copyRuntimeFile(sourcePath, destinationPath);
    }

    const noticesRoot = join(tempRuntimeRoot, "third-party", "open-interpreter");
    validateNotice({
      sourcePath: join(repositoryRoot, ...lock.notices.licensePath.split("/")),
      destinationPath: join(noticesRoot, "LICENSE"),
      expectedSha256: lock.notices.licenseSha256,
      label: "Open Interpreter LICENSE",
    });
    validateNotice({
      sourcePath: join(repositoryRoot, ...lock.notices.noticePath.split("/")),
      destinationPath: join(noticesRoot, "NOTICE"),
      expectedSha256: lock.notices.noticeSha256,
      label: "Open Interpreter NOTICE",
    });
    for (const patch of lock.source.patches) {
      validateNotice({
        sourcePath: join(repositoryRoot, ...patch.sourcePath.split("/")),
        destinationPath: join(tempRuntimeRoot, ...patch.artifactPath.split("/")),
        expectedSha256: patch.sha256,
        label: `Open Interpreter source patch ${patch.sourcePath}`,
      });
    }

    const artifacts = listRuntimeArtifacts(tempRuntimeRoot);
    for (const artifact of artifacts) {
      const expectedMode = canonicalRuntimeMode(artifact.executable);
      const artifactPath = join(tempRuntimeRoot, ...artifact.path.split("/"));
      if ((lstatSync(artifactPath).mode & 0o777) !== expectedMode) {
        throw new Error(`Staged agent runtime artifact has an unsafe mode: ${artifact.path}`);
      }
    }
    const artifactByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
    for (const artifactPath of lock.requiredArtifacts) {
      if (!artifactByPath.has(artifactPath)) {
        throw new Error(`Staged agent runtime is missing required artifact ${artifactPath}`);
      }
    }
    const entrypoint = artifactByPath.get(packageManifest.entrypoint);
    if (!entrypoint?.executable) {
      throw new Error(
        `Staged agent runtime entrypoint is not executable: ${packageManifest.entrypoint}`,
      );
    }

    const metadata: BundledAgentRuntimeMetadata = {
      artifactRelease: {
        archiveSha256: asset.archiveSha256,
        assetName: asset.assetName,
        repository: lock.release.repository,
        tag: lock.release.tag,
      },
      artifacts,
      codexCompatibilityVersion: lock.codexCompatibilityVersion,
      entrypoint: packageManifest.entrypoint,
      layoutVersion: AGENT_RUNTIME_LAYOUT_VERSION,
      packageManifest,
      runtimeFamily: lock.runtimeFamily,
      runtimeVersion: lock.runtimeVersion,
      searchPaths: [packageManifest.pathDir],
      sourceRevision: {
        commit: lock.source.commit,
        patches: lock.source.patches.map((patch) => ({
          path: patch.artifactPath,
          sha256: patch.sha256,
        })),
        repository: lock.source.repository,
      },
      targetArch: target.targetArch,
      targetPlatform: target.targetPlatform,
      targetTriple: target.targetTriple,
    };

    const metadataSha256 = bundledAgentRuntimeMetadataSha256(metadata);
    if (metadataSha256 !== asset.runtimeMetadataSha256) {
      throw new Error(
        `Staged agent runtime metadata does not match the release lock for ${target.targetKey}: ${metadataSha256}`,
      );
    }

    const metadataPath = join(tempRuntimeRoot, AGENT_RUNTIME_METADATA_FILENAME);
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    chmodSync(metadataPath, REGULAR_RUNTIME_MODE);
    if (options.browserRuntimeSourceRoot) {
      stageBrowserRuntime({
        expectedCodexCompatibilityVersion: metadata.codexCompatibilityVersion,
        platformArtifactVerifier: options.browserRuntimePlatformArtifactVerifier,
        runtimeRoot: tempRuntimeRoot,
        sourceRoot: options.browserRuntimeSourceRoot,
        targetArch: target.targetArch,
        targetPlatform: target.targetPlatform,
      });
    }
    replaceOwnedDirectory(tempRuntimeRoot, join(outputPath, "agent-runtime"));
    return metadata;
  } finally {
    sourceCleanup();
    rmSync(tempOutputPath, { recursive: true, force: true });
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const args = argv.filter((value) => value !== "--");
  let targetPlatform: AgentRuntimeTargetPlatform | null = null;
  let targetArch: AgentRuntimeTargetArch | null = null;
  let outputPath: string | null = null;
  let archivePath: string | undefined;
  let browserRuntimeSourceRoot: string | undefined;
  let reuseExisting = false;

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
      if (!nextValue) throw new Error("Missing value for --out");
      outputPath = nextValue;
      index += 1;
      continue;
    }
    if (arg === "--archive") {
      if (!nextValue) throw new Error("Missing value for --archive");
      archivePath = nextValue;
      index += 1;
      continue;
    }
    if (arg === "--browser-runtime-source") {
      if (!nextValue) throw new Error("Missing value for --browser-runtime-source");
      browserRuntimeSourceRoot = nextValue;
      index += 1;
      continue;
    }
    if (arg === "--reuse-existing") {
      reuseExisting = true;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!targetPlatform || !targetArch || !outputPath) {
    throw new Error(
      "Usage: stage-codex-runtime.ts --target-platform darwin --target-arch <arm64|x64> " +
        "--out <dir> [--archive <tar.gz>] [--browser-runtime-source <dir>] " +
        "[--reuse-existing]",
    );
  }
  return {
    archivePath,
    browserRuntimeSourceRoot,
    targetPlatform,
    targetArch,
    outputPath: resolve(projectRoot, outputPath),
    reuseExisting,
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const metadata = await stageCodexRuntime(options);
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
