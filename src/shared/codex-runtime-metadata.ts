export const AGENT_RUNTIME_LAYOUT_VERSION = 2;

export type AgentRuntimeArtifact = {
  executable: boolean;
  path: string;
  sha256: string;
  size: number;
};

export type OpenInterpreterPackageManifest = {
  entrypoint: string;
  layoutVersion: number;
  pathDir: string;
  resourcesDir: string;
  target: string;
  variant: "open-interpreter";
  version: string;
};

export type BundledAgentRuntimeMetadata = {
  artifacts: AgentRuntimeArtifact[];
  codexCompatibilityVersion: string;
  entrypoint: string;
  layoutVersion: typeof AGENT_RUNTIME_LAYOUT_VERSION;
  packageManifest: OpenInterpreterPackageManifest;
  runtimeFamily: "open-interpreter";
  runtimeVersion: string;
  searchPaths: string[];
  sourceRelease: {
    archiveSha256: string;
    assetName: string;
    repository: string;
    tag: string;
  };
  targetArch: string;
  targetPlatform: string;
  targetTriple: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function parseArtifact(value: unknown): AgentRuntimeArtifact | null {
  if (!isObject(value)) return null;
  if (typeof value.path !== "string" || !isSafeRelativePath(value.path)) return null;
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256)) return null;
  if (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0) return null;
  if (typeof value.executable !== "boolean") return null;
  return {
    path: value.path,
    sha256: value.sha256,
    size: value.size,
    executable: value.executable,
  };
}

function parsePackageManifest(value: unknown): OpenInterpreterPackageManifest | null {
  if (!isObject(value)) return null;
  if (typeof value.layoutVersion !== "number" || !Number.isSafeInteger(value.layoutVersion)) return null;
  if (typeof value.version !== "string" || value.version.length === 0) return null;
  if (typeof value.target !== "string" || value.target.length === 0) return null;
  if (value.variant !== "open-interpreter") return null;
  if (typeof value.entrypoint !== "string" || !isSafeRelativePath(value.entrypoint)) return null;
  if (typeof value.resourcesDir !== "string" || !isSafeRelativePath(value.resourcesDir)) return null;
  if (typeof value.pathDir !== "string" || !isSafeRelativePath(value.pathDir)) return null;
  return {
    layoutVersion: value.layoutVersion,
    version: value.version,
    target: value.target,
    variant: value.variant,
    entrypoint: value.entrypoint,
    resourcesDir: value.resourcesDir,
    pathDir: value.pathDir,
  };
}

function parseSourceRelease(value: unknown): BundledAgentRuntimeMetadata["sourceRelease"] | null {
  if (!isObject(value)) return null;
  if (typeof value.repository !== "string" || value.repository.length === 0) return null;
  if (typeof value.tag !== "string" || value.tag.length === 0) return null;
  if (typeof value.assetName !== "string" || value.assetName.length === 0) return null;
  if (typeof value.archiveSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.archiveSha256)) {
    return null;
  }
  return {
    repository: value.repository,
    tag: value.tag,
    assetName: value.assetName,
    archiveSha256: value.archiveSha256,
  };
}

export function parseBundledAgentRuntimeMetadata(value: unknown): BundledAgentRuntimeMetadata | null {
  if (!isObject(value)) return null;
  if (value.layoutVersion !== AGENT_RUNTIME_LAYOUT_VERSION) return null;
  if (value.runtimeFamily !== "open-interpreter") return null;
  if (typeof value.runtimeVersion !== "string" || value.runtimeVersion.length === 0) return null;
  if (
    typeof value.codexCompatibilityVersion !== "string"
    || value.codexCompatibilityVersion.length === 0
  ) return null;
  if (typeof value.entrypoint !== "string" || !isSafeRelativePath(value.entrypoint)) return null;
  if (typeof value.targetArch !== "string" || value.targetArch.length === 0) return null;
  if (typeof value.targetPlatform !== "string" || value.targetPlatform.length === 0) return null;
  if (typeof value.targetTriple !== "string" || value.targetTriple.length === 0) return null;
  if (!Array.isArray(value.artifacts) || !Array.isArray(value.searchPaths)) return null;

  const artifacts = value.artifacts.map(parseArtifact);
  if (artifacts.some((artifact) => artifact === null)) return null;
  const parsedArtifacts = artifacts as AgentRuntimeArtifact[];
  const artifactPaths = new Set(parsedArtifacts.map((artifact) => artifact.path));
  if (artifactPaths.size !== parsedArtifacts.length) return null;
  if (!parsedArtifacts.some((artifact) => artifact.path === value.entrypoint && artifact.executable)) {
    return null;
  }

  if (!value.searchPaths.every((entry) => typeof entry === "string" && isSafeRelativePath(entry))) {
    return null;
  }
  const searchPaths = value.searchPaths as string[];
  if (new Set(searchPaths).size !== searchPaths.length) return null;

  const packageManifest = parsePackageManifest(value.packageManifest);
  if (!packageManifest || packageManifest.entrypoint !== value.entrypoint) return null;
  if (packageManifest.version !== value.runtimeVersion || packageManifest.target !== value.targetTriple) {
    return null;
  }
  if (!artifactPaths.has("codex-package.json")) return null;
  if (!searchPaths.includes(packageManifest.pathDir)) return null;

  const sourceRelease = parseSourceRelease(value.sourceRelease);
  if (!sourceRelease) return null;

  return {
    artifacts: parsedArtifacts,
    codexCompatibilityVersion: value.codexCompatibilityVersion,
    entrypoint: value.entrypoint,
    layoutVersion: value.layoutVersion,
    packageManifest,
    runtimeFamily: value.runtimeFamily,
    runtimeVersion: value.runtimeVersion,
    searchPaths,
    sourceRelease,
    targetArch: value.targetArch,
    targetPlatform: value.targetPlatform,
    targetTriple: value.targetTriple,
  };
}
