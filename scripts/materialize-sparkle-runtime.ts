import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";

import { replaceOwnedDirectory } from "./replace-owned-directory";
import {
  readSparkleReleaseLock,
  resolveSparkleReleaseLockPath,
  type SparkleReleaseLock,
} from "./sparkle-release-lock";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_TOOLS = ["BinaryDelta", "generate_appcast", "generate_keys", "sign_update"] as const;
const REQUIRED_UNIVERSAL_BINARIES = [
  "Sparkle.framework/Versions/B/Sparkle",
  "Sparkle.framework/Versions/B/Autoupdate",
  "Sparkle.framework/Versions/B/Updater.app/Contents/MacOS/Updater",
] as const;

export interface SparkleToolchainManifest {
  readonly archiveSha256: string;
  readonly frameworkBundleVersion: string;
  readonly frameworkShortVersion: string;
  readonly schemaVersion: 1;
  readonly sourceCommit: string;
  readonly version: string;
}

export interface MaterializeSparkleOptions {
  readonly archivePath?: string;
  readonly cachePath?: string;
  readonly lockPath?: string;
  readonly outputPath: string;
  readonly projectRootPath?: string;
}

const sha256File = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const normalizeLicenseWhitespace = (filePath: string): void => {
  const normalized = readFileSync(filePath, "utf8").replace(/[\t ]+$/gmu, "");
  writeFileSync(filePath, normalized, "utf8");
};

function assertFileSha256(filePath: string, expectedSha256: string, label: string): void {
  const actualSha256 = sha256File(filePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${label} checksum mismatch: expected ${expectedSha256}, found ${actualSha256}.`,
    );
  }
}

const normalizeArchiveEntry = (entry: string): string =>
  entry.replace(/^(?:\.\/)+/u, "").replace(/\/$/u, "");

function assertArchivePathsAreSafe(archivePath: string): void {
  const entries = execFileSync("tar", ["-tJf", archivePath], {
    encoding: "utf8",
    env: { ...process.env, LANG: "C" },
  })
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error("Sparkle archive is empty.");

  for (const entry of entries) {
    const normalized = normalizeArchiveEntry(entry);
    if (!normalized) continue;
    if (normalized.startsWith("/") || normalized.includes("\\")) {
      throw new Error(`Sparkle archive contains an unsafe path: ${entry}`);
    }
    if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`Sparkle archive contains an unsafe path: ${entry}`);
    }
  }
}

function assertArchiveMatches(archivePath: string, lock: SparkleReleaseLock): void {
  const stats = lstatSync(archivePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Sparkle archive must be a regular file: ${archivePath}`);
  }
  if (stats.size !== lock.archive.size) {
    throw new Error(
      `Sparkle archive size mismatch: expected ${lock.archive.size}, found ${stats.size}.`,
    );
  }
  assertFileSha256(archivePath, lock.archive.sha256, "Sparkle archive");
  assertArchivePathsAreSafe(archivePath);
}

async function downloadArchive(
  url: string,
  destinationPath: string,
  expectedSize: number,
): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Sparkle: HTTP ${response.status}.`);
  }
  const reportedLength = response.headers.get("content-length");
  if (reportedLength && Number(reportedLength) !== expectedSize) {
    throw new Error(
      `Sparkle download size mismatch: expected ${expectedSize}, server reported ${reportedLength}.`,
    );
  }

  mkdirSync(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.part-${process.pid}`;
  let downloadedSize = 0;
  const sizeLimiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedSize += chunk.length;
      if (downloadedSize > expectedSize) {
        callback(new Error("Sparkle download exceeded its locked size."));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
    await pipeline(
      body,
      sizeLimiter,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
    );
    if (downloadedSize !== expectedSize) {
      throw new Error(
        `Sparkle download size mismatch: expected ${expectedSize}, received ${downloadedSize}.`,
      );
    }
    if (existsSync(destinationPath)) return;
    renameSync(temporaryPath, destinationPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function assertSymlinkClosure(rootPath: string, currentPath = rootPath): void {
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = path.join(currentPath, entry.name);
    const metadata = lstatSync(entryPath);
    if (metadata.isSymbolicLink()) {
      const target = readlinkSync(entryPath);
      if (path.isAbsolute(target)) {
        throw new Error(`Sparkle framework contains an absolute symlink: ${entryPath}`);
      }
      const resolvedTarget = path.resolve(path.dirname(entryPath), target);
      const relativeTarget = path.relative(rootPath, resolvedTarget);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        throw new Error(`Sparkle framework symlink escapes its root: ${entryPath}`);
      }
      continue;
    }
    if (metadata.isDirectory()) {
      assertSymlinkClosure(rootPath, entryPath);
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(`Sparkle framework contains an unsupported filesystem entry: ${entryPath}`);
    }
  }
}

const readPlistValue = (plistPath: string, key: string): string =>
  execFileSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath], {
    encoding: "utf8",
  }).trim();

export function verifySparkleToolchain(
  outputPath: string,
  lock: SparkleReleaseLock,
): SparkleToolchainManifest {
  const root = path.resolve(outputPath);
  const frameworkPath = path.join(root, "Sparkle.framework");
  const frameworkMetadata = lstatSync(frameworkPath);
  if (!frameworkMetadata.isDirectory() || frameworkMetadata.isSymbolicLink()) {
    throw new Error("Sparkle toolchain framework must be a real directory.");
  }
  assertSymlinkClosure(frameworkPath);

  const infoPlistPath = path.join(frameworkPath, "Versions", "B", "Resources", "Info.plist");
  if (readPlistValue(infoPlistPath, "CFBundleShortVersionString") !== lock.framework.shortVersion) {
    throw new Error("Sparkle framework short version does not match the release lock.");
  }
  if (readPlistValue(infoPlistPath, "CFBundleVersion") !== lock.framework.bundleVersion) {
    throw new Error("Sparkle framework bundle version does not match the release lock.");
  }

  const expectedArchitectures = new Set(lock.framework.architectures);
  for (const relativePath of REQUIRED_UNIVERSAL_BINARIES) {
    const architectures = execFileSync("/usr/bin/lipo", ["-archs", path.join(root, relativePath)], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/u);
    if (
      architectures.length !== expectedArchitectures.size ||
      architectures.some(
        (architecture) => !expectedArchitectures.has(architecture as "arm64" | "x86_64"),
      )
    ) {
      throw new Error(`${relativePath} does not contain exactly the locked Sparkle architectures.`);
    }
  }

  assertFileSha256(path.join(root, "LICENSE"), lock.license.sha256, "Extracted Sparkle license");

  for (const tool of REQUIRED_TOOLS) {
    const toolPath = path.join(root, "bin", tool);
    const metadata = statSync(toolPath);
    if (!metadata.isFile() || (metadata.mode & 0o111) === 0) {
      throw new Error(`Sparkle tool is missing or non-executable: ${tool}.`);
    }
  }

  const manifestPath = path.join(root, "sparkle-toolchain.json");
  const expected: SparkleToolchainManifest = {
    archiveSha256: lock.archive.sha256,
    frameworkBundleVersion: lock.framework.bundleVersion,
    frameworkShortVersion: lock.framework.shortVersion,
    schemaVersion: 1,
    sourceCommit: lock.source.commit,
    version: lock.version,
  };
  const actual = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Sparkle toolchain manifest does not match the release lock.");
  }
  return expected;
}

export async function materializeSparkleRuntime(
  options: MaterializeSparkleOptions,
): Promise<SparkleToolchainManifest> {
  if (process.platform !== "darwin") {
    throw new Error("Sparkle materialization is supported only on macOS.");
  }
  const projectRoot = path.resolve(options.projectRootPath ?? repositoryRoot);
  const lock = readSparkleReleaseLock(
    path.resolve(options.lockPath ?? resolveSparkleReleaseLockPath(projectRoot)),
  );
  assertFileSha256(
    path.resolve(projectRoot, lock.license.path),
    lock.license.sha256,
    "Committed Sparkle license",
  );
  const outputPath = path.resolve(options.outputPath);
  try {
    const existing = verifySparkleToolchain(outputPath, lock);
    process.stderr.write("Reused verified Sparkle toolchain.\n");
    return existing;
  } catch {
    // A missing or stale owned output is replaced only after a fresh verified extraction.
  }

  const cachePath = path.resolve(
    options.cachePath ?? path.join(projectRoot, ".generated", "sparkle-cache"),
  );
  const archivePath = path.resolve(
    options.archivePath ?? path.join(cachePath, lock.archive.sha256, lock.archive.name),
  );
  if (existsSync(archivePath)) {
    try {
      assertArchiveMatches(archivePath, lock);
    } catch (error) {
      if (options.archivePath) throw error;
      rmSync(archivePath, { force: true });
    }
  }
  if (!existsSync(archivePath)) {
    await downloadArchive(lock.archive.url, archivePath, lock.archive.size);
  }
  assertArchiveMatches(archivePath, lock);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  const extractionParent = mkdtempSync(
    path.join(path.dirname(outputPath), ".sparkle-materialize-"),
  );
  const extractedRoot = path.join(extractionParent, "toolchain");
  mkdirSync(extractedRoot);
  try {
    execFileSync("tar", [
      "-xJf",
      archivePath,
      "-C",
      extractedRoot,
      "./Sparkle.framework",
      "./bin/BinaryDelta",
      "./bin/generate_appcast",
      "./bin/generate_keys",
      "./bin/sign_update",
      "./LICENSE",
    ]);
    // Keep the committed notice and staged notice byte-identical without
    // retaining upstream-only trailing spaces. The archive itself remains
    // pinned and verified byte-for-byte before extraction.
    normalizeLicenseWhitespace(path.join(extractedRoot, "LICENSE"));
    for (const tool of REQUIRED_TOOLS) chmodSync(path.join(extractedRoot, "bin", tool), 0o755);
    const manifest: SparkleToolchainManifest = {
      archiveSha256: lock.archive.sha256,
      frameworkBundleVersion: lock.framework.bundleVersion,
      frameworkShortVersion: lock.framework.shortVersion,
      schemaVersion: 1,
      sourceCommit: lock.source.commit,
      version: lock.version,
    };
    writeFileSync(
      path.join(extractedRoot, "sparkle-toolchain.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    verifySparkleToolchain(extractedRoot, lock);
    replaceOwnedDirectory(extractedRoot, outputPath);
    return verifySparkleToolchain(outputPath, lock);
  } finally {
    rmSync(extractionParent, { force: true, recursive: true });
  }
}

function parseCliOptions(argv: readonly string[]): MaterializeSparkleOptions {
  const args = argv.filter((value) => value !== "--");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Sparkle materialization arguments must be --key value pairs.");
    }
    values.set(key, value);
  }
  const outputPath = values.get("--out");
  if (!outputPath) {
    throw new Error("Usage: materialize-sparkle-runtime.ts --out <toolchain-directory>.");
  }
  return {
    ...(values.get("--archive") ? { archivePath: values.get("--archive") } : {}),
    ...(values.get("--cache") ? { cachePath: values.get("--cache") } : {}),
    ...(values.get("--lock") ? { lockPath: values.get("--lock") } : {}),
    outputPath,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void materializeSparkleRuntime(parseCliOptions(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
