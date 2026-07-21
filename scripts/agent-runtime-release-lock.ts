import { readFileSync } from "node:fs";
import path from "node:path";

export type AgentRuntimeTargetPlatform = "darwin";
export type AgentRuntimeTargetArch = "arm64" | "x64";
export type AgentRuntimeTargetKey = `${AgentRuntimeTargetPlatform}-${AgentRuntimeTargetArch}`;

export type AgentRuntimeReleaseAsset = {
  archiveSha256: string;
  archiveSize: number;
  assetName: string;
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
  repository: string;
  requiredArtifacts: string[];
  runtimeFamily: "open-interpreter";
  runtimeVersion: string;
  schemaVersion: 1;
  tag: string;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

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

function isSafeRelativePath(value: string): boolean {
  if (value.startsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function requireRelativePath(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (isSafeRelativePath(parsed)) return parsed;
  throw new Error(`Invalid Open Interpreter release lock ${label}`);
}

function parseAsset(value: unknown, label: string): AgentRuntimeReleaseAsset {
  if (!isObject(value)) throw new Error(`Invalid Open Interpreter release lock ${label}`);
  if (!Number.isSafeInteger(value.archiveSize) || (value.archiveSize as number) <= 0) {
    throw new Error(`Invalid Open Interpreter release lock ${label}.archiveSize`);
  }
  const url = requireString(value.url, `${label}.url`);
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") {
    throw new Error(`Invalid Open Interpreter release lock ${label}.url`);
  }
  return {
    archiveSha256: requireSha256(value.archiveSha256, `${label}.archiveSha256`),
    archiveSize: value.archiveSize as number,
    assetName: requireString(value.assetName, `${label}.assetName`),
    targetTriple: requireString(value.targetTriple, `${label}.targetTriple`),
    url,
  };
}

export function parseOpenInterpreterReleaseLock(value: unknown): OpenInterpreterReleaseLock {
  if (!isObject(value) || value.schemaVersion !== 1 || value.runtimeFamily !== "open-interpreter") {
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
      "darwin-arm64": parseAsset(value.assets["darwin-arm64"], "assets.darwin-arm64"),
      "darwin-x64": parseAsset(value.assets["darwin-x64"], "assets.darwin-x64"),
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
    repository: requireString(value.repository, "repository"),
    requiredArtifacts,
    runtimeFamily: value.runtimeFamily,
    runtimeVersion,
    schemaVersion: value.schemaVersion,
    tag: requireString(value.tag, "tag"),
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
