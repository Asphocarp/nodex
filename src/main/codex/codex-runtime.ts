import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  parseBundledCodexRuntimeMetadata,
  type BundledCodexRuntimeMetadata,
} from "../../shared/codex-runtime-metadata";

export type CodexRuntimeSource = "bundled" | "staged";

export type ResolvedCodexRuntime = {
  additionalSearchPaths: string[];
  binaryPath: string;
  metadataPath: string | null;
  missingBinaryMessage: string;
  source: CodexRuntimeSource;
  version: string | null;
};

function readSha256(filePath: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fileDescriptor = fs.openSync(filePath, "r");
  try {
    for (;;) {
      const bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) return hash.digest("hex");
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function validateRuntimeArtifacts(runtimeRoot: string, metadata: BundledCodexRuntimeMetadata): void {
  for (const artifact of metadata.artifacts) {
    const artifactPath = path.join(runtimeRoot, ...artifact.path.split("/"));
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(artifactPath);
    } catch {
      throw new Error(`Codex runtime artifact is missing: ${artifact.path}`);
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Codex runtime artifact is not a regular file: ${artifact.path}`);
    }
    if (stats.size !== artifact.size) {
      throw new Error(`Codex runtime artifact size does not match metadata: ${artifact.path}`);
    }
    if (artifact.executable && (stats.mode & 0o111) === 0) {
      throw new Error(`Codex runtime artifact is not executable: ${artifact.path}`);
    }
    if (readSha256(artifactPath) !== artifact.sha256) {
      throw new Error(`Codex runtime artifact checksum does not match metadata: ${artifact.path}`);
    }
  }
}

function validateRuntimeSearchPathTools(
  runtimeRoot: string,
  metadata: BundledCodexRuntimeMetadata,
): void {
  for (const tool of metadata.searchPathTools) {
    const toolPath = path.join(runtimeRoot, tool);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(toolPath);
    } catch {
      throw new Error(`Codex runtime search-path tool is missing: ${tool}`);
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Codex runtime search-path tool is not a regular file: ${tool}`);
    }
    if ((stats.mode & 0o111) === 0) {
      throw new Error(`Codex runtime search-path tool is not executable: ${tool}`);
    }
  }
}

type ResolveCodexRuntimeOptions = {
  isPackaged: boolean;
  projectRootPath?: string;
  resourcesPath?: string;
};

function resolveRuntimeFromRoot(input: {
  missingBinaryMessage: string;
  runtimeRoot: string;
  source: CodexRuntimeSource;
}): ResolvedCodexRuntime {
  const metadataPath = path.join(input.runtimeRoot, "runtime.json");

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Codex runtime is missing or incomplete under ${input.runtimeRoot}`);
  }

  const metadata = parseBundledRuntimeMetadata(metadataPath);
  validateRuntimeArtifacts(input.runtimeRoot, metadata);
  validateRuntimeSearchPathTools(input.runtimeRoot, metadata);

  return {
    source: input.source,
    binaryPath: path.join(input.runtimeRoot, "codex"),
    additionalSearchPaths: [input.runtimeRoot],
    version: metadata.codexVersion,
    metadataPath,
    missingBinaryMessage: input.missingBinaryMessage,
  };
}

function parseBundledRuntimeMetadata(metadataPath: string): BundledCodexRuntimeMetadata {
  let rawMetadata: unknown;
  try {
    rawMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch {
    throw new Error(`Invalid bundled Codex runtime metadata at ${metadataPath}`);
  }
  const parsed = parseBundledCodexRuntimeMetadata(rawMetadata);
  if (!parsed) {
    throw new Error(`Invalid bundled Codex runtime metadata at ${metadataPath}`);
  }
  return parsed;
}

export function resolveCodexRuntime(options: ResolveCodexRuntimeOptions): ResolvedCodexRuntime {
  if (!options.isPackaged) {
    const projectRootPath = options.projectRootPath?.trim();
    if (!projectRootPath) {
      throw new Error("Unpackaged Codex runtime resolution requires a project root path");
    }

    return resolveRuntimeFromRoot({
      source: "staged",
      runtimeRoot: path.join(projectRootPath, ".generated", "codex-runtime", "bin"),
      missingBinaryMessage: "Pinned Codex runtime is missing or incomplete. Run `pnpm run stage:codex-runtime:mac`.",
    });
  }

  const resourcesPath = options.resourcesPath?.trim();
  if (!resourcesPath) {
    throw new Error("Packaged Codex runtime resolution requires process.resourcesPath");
  }

  return resolveRuntimeFromRoot({
    source: "bundled",
    runtimeRoot: path.join(resourcesPath, "bin"),
    missingBinaryMessage: "Bundled Codex runtime is missing or corrupted. Reinstall Nodex.",
  });
}
