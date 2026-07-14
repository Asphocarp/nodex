export const CODEX_RUNTIME_LAYOUT_VERSION = 1;

export const REQUIRED_CODEX_RUNTIME_SIBLING_ARTIFACTS = [
  "codex",
  "codex-code-mode-host",
] as const;

export const REQUIRED_CODEX_RUNTIME_SEARCH_PATH_TOOLS = [
  "rg",
] as const;

export type CodexRuntimeArtifact = {
  executable: boolean;
  path: string;
  sha256: string;
  size: number;
};

export type BundledCodexRuntimeMetadata = {
  artifacts: CodexRuntimeArtifact[];
  codexVersion: string;
  layoutVersion: typeof CODEX_RUNTIME_LAYOUT_VERSION;
  searchPathTools: string[];
  sourcePackage: string;
  targetArch: string;
  targetPlatform: string;
  targetTriple: string;
};

function isSafeArtifactPath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isSafeSearchPathTool(value: string): boolean {
  return isSafeArtifactPath(value) && !value.includes("/");
}

function parseArtifact(value: unknown): CodexRuntimeArtifact | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CodexRuntimeArtifact>;
  if (typeof candidate.path !== "string" || !isSafeArtifactPath(candidate.path)) return null;
  if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) return null;
  if (typeof candidate.size !== "number" || !Number.isSafeInteger(candidate.size) || candidate.size < 0) return null;
  if (typeof candidate.executable !== "boolean") return null;
  return {
    path: candidate.path,
    sha256: candidate.sha256,
    size: candidate.size,
    executable: candidate.executable,
  };
}

export function parseBundledCodexRuntimeMetadata(value: unknown): BundledCodexRuntimeMetadata | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BundledCodexRuntimeMetadata>;
  if (candidate.layoutVersion !== CODEX_RUNTIME_LAYOUT_VERSION) return null;
  if (typeof candidate.codexVersion !== "string" || candidate.codexVersion.length === 0) return null;
  if (typeof candidate.sourcePackage !== "string" || candidate.sourcePackage.length === 0) return null;
  if (typeof candidate.targetArch !== "string" || candidate.targetArch.length === 0) return null;
  if (typeof candidate.targetPlatform !== "string" || candidate.targetPlatform.length === 0) return null;
  if (typeof candidate.targetTriple !== "string" || candidate.targetTriple.length === 0) return null;
  if (!Array.isArray(candidate.artifacts)) return null;
  if (!Array.isArray(candidate.searchPathTools)) return null;

  const artifacts = candidate.artifacts.map(parseArtifact);
  if (artifacts.some((artifact) => artifact === null)) return null;
  const parsedArtifacts = artifacts as CodexRuntimeArtifact[];
  const artifactPaths = new Set(parsedArtifacts.map((artifact) => artifact.path));
  if (artifactPaths.size !== parsedArtifacts.length) return null;
  if (!REQUIRED_CODEX_RUNTIME_SIBLING_ARTIFACTS.every((artifactPath) => (
    parsedArtifacts.some((artifact) => artifact.path === artifactPath && artifact.executable)
  ))) return null;
  if (!candidate.searchPathTools.every((tool) => (
    typeof tool === "string" && isSafeSearchPathTool(tool)
  ))) return null;
  const searchPathTools = candidate.searchPathTools as string[];
  const searchPathToolNames = new Set(searchPathTools);
  if (searchPathToolNames.size !== searchPathTools.length) return null;
  if (!REQUIRED_CODEX_RUNTIME_SEARCH_PATH_TOOLS.every((tool) => searchPathToolNames.has(tool))) {
    return null;
  }
  if (searchPathTools.some((tool) => artifactPaths.has(tool))) return null;

  return {
    artifacts: parsedArtifacts,
    codexVersion: candidate.codexVersion,
    layoutVersion: candidate.layoutVersion,
    searchPathTools,
    sourcePackage: candidate.sourcePackage,
    targetArch: candidate.targetArch,
    targetPlatform: candidate.targetPlatform,
    targetTriple: candidate.targetTriple,
  };
}
