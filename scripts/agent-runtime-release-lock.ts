import { readFileSync } from "node:fs";
import path from "node:path";

export type AgentRuntimeTargetPlatform = "darwin";
export type AgentRuntimeTargetArch = "arm64" | "x64";
export type AgentRuntimeTargetKey = `${AgentRuntimeTargetPlatform}-${AgentRuntimeTargetArch}`;

export type AgentRuntimeReleaseAsset = {
  archiveSha256: string;
  archiveSize: number;
  assetName: string;
  runtimeMetadataSha256: string;
  targetTriple: string;
  url: string;
};

export type OpenInterpreterReleaseLock = {
  assets: Record<AgentRuntimeTargetKey, AgentRuntimeReleaseAsset>;
  codexCompatibilityVersion: string;
  notices: {
    licensePath: string;
    licenseSha256: string;
    noticePath: string;
    noticeSha256: string;
  };
  packageManifest: {
    entrypoint: string;
    layoutVersion: number;
    pathDir: string;
    resourcesDir: string;
    variant: "open-interpreter";
    version: string;
  };
  protocolSchemaSha256: string;
  release: {
    repository: string;
    tag: string;
  };
  requiredArtifacts: string[];
  runtimeFamily: "open-interpreter";
  runtimeVersion: string;
  schemaVersion: 2;
  source: {
    commit: string;
    patches: Array<{
      artifactPath: string;
      sha256: string;
      sourcePath: string;
    }>;
    repository: string;
  };
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Invalid Open Interpreter release lock ${label}`);
}

function requireSha256(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (SHA256_PATTERN.test(parsed)) return parsed;
  throw new Error(`Invalid Open Interpreter release lock ${label}`);
}

function requireGitCommit(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (GIT_COMMIT_PATTERN.test(parsed)) return parsed;
  throw new Error(`Invalid Open Interpreter release lock ${label}`);
}

function requireGitHubRepository(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (GITHUB_REPOSITORY_PATTERN.test(parsed)) return parsed;
  throw new Error(`Invalid Open Interpreter release lock ${label}`);
}

function isSafeRelativePath(value: string): boolean {
  if (value.startsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function requireRelativePath(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (isSafeRelativePath(parsed)) return parsed;
  throw new Error(`Invalid Open Interpreter release lock ${label}`);
}

function parseAsset(
  value: unknown,
  label: string,
  release: OpenInterpreterReleaseLock["release"],
): AgentRuntimeReleaseAsset {
  if (!isObject(value)) throw new Error(`Invalid Open Interpreter release lock ${label}`);
  if (!Number.isSafeInteger(value.archiveSize) || (value.archiveSize as number) <= 0) {
    throw new Error(`Invalid Open Interpreter release lock ${label}.archiveSize`);
  }
  const url = requireString(value.url, `${label}.url`);
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") {
    throw new Error(`Invalid Open Interpreter release lock ${label}.url`);
  }
  const assetName = requireString(value.assetName, `${label}.assetName`);
  if (assetName.includes("/") || assetName.includes("\\")) {
    throw new Error(`Invalid Open Interpreter release lock ${label}.assetName`);
  }
  const expectedUrl = `https://github.com/${release.repository}/releases/download/${release.tag}/${assetName}`;
  if (url !== expectedUrl) {
    throw new Error(`Open Interpreter release lock ${label}.url does not match its artifact release`);
  }
  return {
    archiveSha256: requireSha256(value.archiveSha256, `${label}.archiveSha256`),
    archiveSize: value.archiveSize as number,
    assetName,
    runtimeMetadataSha256: requireSha256(
      value.runtimeMetadataSha256,
      `${label}.runtimeMetadataSha256`,
    ),
    targetTriple: requireString(value.targetTriple, `${label}.targetTriple`),
    url,
  };
}

export function parseOpenInterpreterReleaseLock(value: unknown): OpenInterpreterReleaseLock {
  if (!isObject(value) || value.schemaVersion !== 2 || value.runtimeFamily !== "open-interpreter") {
    throw new Error("Invalid Open Interpreter release lock header");
  }
  if (!isObject(value.packageManifest) || value.packageManifest.variant !== "open-interpreter") {
    throw new Error("Invalid Open Interpreter release lock packageManifest");
  }
  if (!Number.isSafeInteger(value.packageManifest.layoutVersion)) {
    throw new Error("Invalid Open Interpreter release lock packageManifest.layoutVersion");
  }
  if (!isObject(value.assets)) {
    throw new Error("Invalid Open Interpreter release lock assets");
  }
  if (!Array.isArray(value.requiredArtifacts) || value.requiredArtifacts.length === 0) {
    throw new Error("Invalid Open Interpreter release lock requiredArtifacts");
  }
  const requiredArtifacts = value.requiredArtifacts.map((entry, index) => (
    requireRelativePath(entry, `requiredArtifacts[${index}]`)
  ));
  if (new Set(requiredArtifacts).size !== requiredArtifacts.length) {
    throw new Error("Open Interpreter release lock contains duplicate requiredArtifacts");
  }
  if (!isObject(value.notices)) {
    throw new Error("Invalid Open Interpreter release lock notices");
  }
  if (!isObject(value.source)) {
    throw new Error("Invalid Open Interpreter release lock source");
  }
  if (!isObject(value.release)) {
    throw new Error("Invalid Open Interpreter release lock release");
  }

  const release = {
    repository: requireGitHubRepository(value.release.repository, "release.repository"),
    tag: requireString(value.release.tag, "release.tag"),
  };
  if (!Array.isArray(value.source.patches)) {
    throw new Error("Invalid Open Interpreter release lock source.patches");
  }
  const patches = value.source.patches.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`Invalid Open Interpreter release lock source.patches[${index}]`);
    }
    const artifactPath = requireRelativePath(
      entry.artifactPath,
      `source.patches[${index}].artifactPath`,
    );
    if (!artifactPath.startsWith("third-party/open-interpreter/patches/")) {
      throw new Error(`Invalid Open Interpreter release lock source.patches[${index}].artifactPath`);
    }
    return {
      artifactPath,
      sha256: requireSha256(entry.sha256, `source.patches[${index}].sha256`),
      sourcePath: requireRelativePath(entry.sourcePath, `source.patches[${index}].sourcePath`),
    };
  });
  if (
    new Set(patches.map((entry) => entry.artifactPath)).size !== patches.length
    || new Set(patches.map((entry) => entry.sourcePath)).size !== patches.length
  ) {
    throw new Error("Open Interpreter release lock contains duplicate source patches");
  }

  const runtimeVersion = requireString(value.runtimeVersion, "runtimeVersion");
  const packageVersion = requireString(value.packageManifest.version, "packageManifest.version");
  if (runtimeVersion !== packageVersion) {
    throw new Error("Open Interpreter release lock runtime and package versions differ");
  }
  const entrypoint = requireRelativePath(value.packageManifest.entrypoint, "packageManifest.entrypoint");
  if (!requiredArtifacts.includes(entrypoint) || !requiredArtifacts.includes("codex-package.json")) {
    throw new Error("Open Interpreter release lock requiredArtifacts omit the package manifest or entrypoint");
  }

  return {
    assets: {
      "darwin-arm64": parseAsset(value.assets["darwin-arm64"], "assets.darwin-arm64", release),
      "darwin-x64": parseAsset(value.assets["darwin-x64"], "assets.darwin-x64", release),
    },
    codexCompatibilityVersion: requireString(value.codexCompatibilityVersion, "codexCompatibilityVersion"),
    notices: {
      licensePath: requireRelativePath(value.notices.licensePath, "notices.licensePath"),
      licenseSha256: requireSha256(value.notices.licenseSha256, "notices.licenseSha256"),
      noticePath: requireRelativePath(value.notices.noticePath, "notices.noticePath"),
      noticeSha256: requireSha256(value.notices.noticeSha256, "notices.noticeSha256"),
    },
    packageManifest: {
      entrypoint,
      layoutVersion: value.packageManifest.layoutVersion as number,
      pathDir: requireRelativePath(value.packageManifest.pathDir, "packageManifest.pathDir"),
      resourcesDir: requireRelativePath(value.packageManifest.resourcesDir, "packageManifest.resourcesDir"),
      variant: value.packageManifest.variant,
      version: packageVersion,
    },
    protocolSchemaSha256: requireSha256(value.protocolSchemaSha256, "protocolSchemaSha256"),
    release,
    requiredArtifacts,
    runtimeFamily: value.runtimeFamily,
    runtimeVersion,
    schemaVersion: value.schemaVersion,
    source: {
      commit: requireGitCommit(value.source.commit, "source.commit"),
      patches,
      repository: requireGitHubRepository(value.source.repository, "source.repository"),
    },
  };
}

export function readOpenInterpreterReleaseLock(lockPath: string): OpenInterpreterReleaseLock {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    throw new Error(`Invalid Open Interpreter release lock at ${lockPath}`);
  }
  return parseOpenInterpreterReleaseLock(value);
}

export function resolveOpenInterpreterReleaseLockPath(projectRoot: string): string {
  return path.join(projectRoot, "resources", "agent-runtime", "openinterpreter.lock.json");
}
