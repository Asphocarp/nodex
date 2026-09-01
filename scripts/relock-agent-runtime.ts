import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseOpenInterpreterReleaseLock,
  readOpenInterpreterReleaseLock,
  resolveOpenInterpreterReleaseLockPath,
  type AgentRuntimeTargetArch,
  type AgentRuntimeTargetKey,
  type OpenInterpreterReleaseLock,
} from "./agent-runtime-release-lock";
import { generateAgentRuntimeSchemaFingerprint } from "./probe-agent-runtime";
import { stageCodexRuntimeCandidate } from "./stage-codex-runtime";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDir, "..");
const ZERO_SHA256 = "0".repeat(64);
const ARCHIVE_NAMES = {
  arm64: "open-interpreter-package-aarch64-apple-darwin.tar.gz",
  x64: "open-interpreter-package-x86_64-apple-darwin.tar.gz",
} as const;

export type AgentRuntimeRelockOptions = {
  arm64ArchivePath: string;
  fingerprintSchema?: (binaryPath: string) => string;
  lockPath?: string;
  outputPath: string;
  projectRootPath?: string;
  releaseTag: string;
  x64ArchivePath: string;
};

function readSha256(filePath: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, "r");
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) return hash.digest("hex");
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
}

function assertRegularFile(filePath: string, label: string): void {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
}

function resolveArchive(inputPath: string, expectedName: string): string {
  const archivePath = path.resolve(inputPath);
  assertRegularFile(archivePath, "Agent runtime archive");
  if (path.basename(archivePath) !== expectedName) {
    throw new Error(`Agent runtime archive must be named ${expectedName}: ${archivePath}`);
  }
  return archivePath;
}

function releaseVersion(tag: string, sourceCommit: string): string {
  const match = /^agent-runtime-v(?<version>\d+(?:\.\d+)+)-(?<commit>[a-f0-9]{8})$/u.exec(tag);
  if (!match?.groups) {
    throw new Error(
      "Agent runtime release tag must use agent-runtime-v<version>-<8-char-source-commit>",
    );
  }
  if (match.groups.commit !== sourceCommit.slice(0, 8)) {
    throw new Error("Agent runtime release tag does not identify the locked source commit");
  }
  return match.groups.version;
}

function inspectArchive(archivePath: string): { archiveSha256: string; archiveSize: number } {
  const archiveSize = statSync(archivePath).size;
  if (archiveSize <= 0) throw new Error(`Agent runtime archive is empty: ${archivePath}`);
  return { archiveSha256: readSha256(archivePath), archiveSize };
}

function refreshLocalEvidence(
  projectRoot: string,
  lock: OpenInterpreterReleaseLock,
): Pick<OpenInterpreterReleaseLock, "notices" | "source"> {
  const patches = lock.source.patches.map((patch) => {
    const sourcePath = path.join(projectRoot, ...patch.sourcePath.split("/"));
    assertRegularFile(sourcePath, `Agent runtime source patch ${patch.sourcePath}`);
    return { ...patch, sha256: readSha256(sourcePath) };
  });
  const licensePath = path.join(projectRoot, ...lock.notices.licensePath.split("/"));
  const noticePath = path.join(projectRoot, ...lock.notices.noticePath.split("/"));
  assertRegularFile(licensePath, "Agent runtime license");
  assertRegularFile(noticePath, "Agent runtime notice");
  return {
    source: { ...lock.source, patches },
    notices: {
      ...lock.notices,
      licenseSha256: readSha256(licensePath),
      noticeSha256: readSha256(noticePath),
    },
  };
}

function releaseAsset(input: {
  archivePath: string;
  lock: OpenInterpreterReleaseLock;
  releaseTag: string;
  targetArch: AgentRuntimeTargetArch;
}): OpenInterpreterReleaseLock["assets"][AgentRuntimeTargetKey] {
  const current = input.lock.assets[`darwin-${input.targetArch}`];
  const assetName = ARCHIVE_NAMES[input.targetArch];
  const archive = inspectArchive(input.archivePath);
  return {
    ...current,
    ...archive,
    assetName,
    runtimeMetadataSha256: ZERO_SHA256,
    url: `https://github.com/${input.lock.release.repository}/releases/download/${input.releaseTag}/${assetName}`,
  };
}

function writeTemporaryLock(rootPath: string, lock: OpenInterpreterReleaseLock): string {
  const lockPath = path.join(rootPath, "openinterpreter.candidate.lock.json");
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return lockPath;
}

async function metadataSha256(input: {
  archivePath: string;
  candidateLockPath: string;
  projectRoot: string;
  stagingRoot: string;
  targetArch: AgentRuntimeTargetArch;
}): Promise<{ binaryPath: string; metadataSha256: string }> {
  const outputPath = path.join(input.stagingRoot, input.targetArch);
  const result = await stageCodexRuntimeCandidate({
    archivePath: input.archivePath,
    lockPath: input.candidateLockPath,
    outputPath,
    projectRootPath: input.projectRoot,
    targetArch: input.targetArch,
    targetPlatform: "darwin",
  });
  return {
    binaryPath: path.join(outputPath, "agent-runtime", ...result.metadata.entrypoint.split("/")),
    metadataSha256: result.metadataSha256,
  };
}

export async function createAgentRuntimeRelockCandidate(
  options: AgentRuntimeRelockOptions,
): Promise<OpenInterpreterReleaseLock> {
  const projectRoot = path.resolve(options.projectRootPath ?? defaultProjectRoot);
  const currentLockPath = path.resolve(
    options.lockPath ?? resolveOpenInterpreterReleaseLockPath(projectRoot),
  );
  const currentLock = readOpenInterpreterReleaseLock(currentLockPath);
  const runtimeVersion = releaseVersion(options.releaseTag, currentLock.source.commit);
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-relock-"));

  try {
    const arm64ArchivePath = resolveArchive(options.arm64ArchivePath, ARCHIVE_NAMES.arm64);
    const x64ArchivePath = resolveArchive(options.x64ArchivePath, ARCHIVE_NAMES.x64);
    const localEvidence = refreshLocalEvidence(projectRoot, currentLock);
    const assets = {
      "darwin-arm64": releaseAsset({
        archivePath: arm64ArchivePath,
        lock: currentLock,
        releaseTag: options.releaseTag,
        targetArch: "arm64",
      }),
      "darwin-x64": releaseAsset({
        archivePath: x64ArchivePath,
        lock: currentLock,
        releaseTag: options.releaseTag,
        targetArch: "x64",
      }),
    };
    let candidate = parseOpenInterpreterReleaseLock({
      ...currentLock,
      assets,
      notices: localEvidence.notices,
      packageManifest: { ...currentLock.packageManifest, version: runtimeVersion },
      protocolSchemaSha256: ZERO_SHA256,
      release: { ...currentLock.release, tag: options.releaseTag },
      runtimeVersion,
      source: localEvidence.source,
    });
    const candidateLockPath = writeTemporaryLock(temporaryRoot, candidate);
    const arm64 = await metadataSha256({
      archivePath: arm64ArchivePath,
      candidateLockPath,
      projectRoot,
      stagingRoot: temporaryRoot,
      targetArch: "arm64",
    });
    const x64 = await metadataSha256({
      archivePath: x64ArchivePath,
      candidateLockPath,
      projectRoot,
      stagingRoot: temporaryRoot,
      targetArch: "x64",
    });
    if (!options.fingerprintSchema && process.platform !== "darwin") {
      throw new Error("Agent runtime schema fingerprinting requires macOS");
    }
    const schemaBinaryPath = process.arch === "x64" ? x64.binaryPath : arm64.binaryPath;
    candidate = parseOpenInterpreterReleaseLock({
      ...candidate,
      protocolSchemaSha256: (options.fingerprintSchema ?? generateAgentRuntimeSchemaFingerprint)(
        schemaBinaryPath,
      ),
      assets: {
        "darwin-arm64": {
          ...candidate.assets["darwin-arm64"],
          runtimeMetadataSha256: arm64.metadataSha256,
        },
        "darwin-x64": {
          ...candidate.assets["darwin-x64"],
          runtimeMetadataSha256: x64.metadataSha256,
        },
      },
    });
    return candidate;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function assertCandidateOutputPath(outputPath: string, lockPath: string): void {
  if (outputPath === lockPath) {
    throw new Error("Agent runtime relock output must not overwrite the current release lock");
  }
  if (existsSync(outputPath)) {
    throw new Error(`Agent runtime relock output already exists: ${outputPath}`);
  }
}

export async function writeAgentRuntimeRelockCandidate(
  options: AgentRuntimeRelockOptions,
): Promise<OpenInterpreterReleaseLock> {
  const projectRoot = path.resolve(options.projectRootPath ?? defaultProjectRoot);
  const currentLockPath = path.resolve(
    options.lockPath ?? resolveOpenInterpreterReleaseLockPath(projectRoot),
  );
  const outputPath = path.resolve(options.outputPath);
  assertCandidateOutputPath(outputPath, currentLockPath);
  const candidate = await createAgentRuntimeRelockCandidate(options);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(candidate, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    chmodSync(temporaryPath, 0o644);
    if (existsSync(outputPath)) {
      throw new Error(`Agent runtime relock output already exists: ${outputPath}`);
    }
    // A hard link gives the candidate path create-only semantics; an existing
    // file wins the race instead of being replaced by rename(2).
    linkSync(temporaryPath, outputPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return candidate;
}

function parseCliOptions(argv: string[]): AgentRuntimeRelockOptions {
  const args = argv.filter((value) => value !== "--");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key || !value || !key.startsWith("--")) {
      throw new Error("Agent runtime relock arguments must be --key value pairs");
    }
    if (!["--arm64", "--x64", "--tag", "--out"].includes(key)) {
      throw new Error(`Unexpected Agent runtime relock argument: ${key}`);
    }
    if (values.has(key)) throw new Error(`Duplicate Agent runtime relock argument: ${key}`);
    values.set(key, value);
  }
  const arm64ArchivePath = values.get("--arm64");
  const x64ArchivePath = values.get("--x64");
  const releaseTag = values.get("--tag");
  const outputPath = values.get("--out");
  if (!arm64ArchivePath || !x64ArchivePath || !releaseTag || !outputPath) {
    throw new Error(
      "Usage: relock-agent-runtime.ts --arm64 <archive> --x64 <archive> " +
        "--tag <release-tag> --out <candidate-lock.json>",
    );
  }
  return { arm64ArchivePath, outputPath, releaseTag, x64ArchivePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCliOptions(process.argv.slice(2));
  void writeAgentRuntimeRelockCandidate(options)
    .then((candidate) => {
      process.stdout.write(
        `${JSON.stringify({
          outputPath: path.resolve(options.outputPath),
          releaseTag: candidate.release.tag,
          runtimeVersion: candidate.runtimeVersion,
          assets: candidate.assets,
        })}\n`,
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
