import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readOpenInterpreterReleaseLock,
  resolveOpenInterpreterReleaseLockPath,
} from "../agent-runtime-release-lock";
import { stableVersionFromAppTag } from "./model";

const AGENT_RUNTIME_ASSET_NAMES = {
  arm64: "open-interpreter-package-aarch64-apple-darwin.tar.gz",
  x64: "open-interpreter-package-x86_64-apple-darwin.tar.gz",
} as const;
const defaultProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type AgentRuntimeReleaseOptions = {
  readonly arm64Path: string;
  readonly lockPath?: string;
  readonly projectRootPath?: string;
  readonly repo: string;
  readonly sourceCommit: string;
  readonly tag: string;
  readonly x64Path: string;
};

const runGh = (args: readonly string[]): string =>
  execFileSync("gh", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const runGit = (args: readonly string[], projectRoot: string): string =>
  execFileSync("git", [...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function sha256File(filePath: string): string {
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

export function assertAgentRuntimeReviewedTag(input: {
  readonly currentCommit: string;
  readonly remoteTagCommit: string;
  readonly worktreeStatus: string;
}): void {
  if (input.worktreeStatus.trim().length > 0) {
    throw new Error("Agent runtime publication requires a clean reviewed worktree.");
  }
  if (input.remoteTagCommit !== input.currentCommit) {
    throw new Error("Agent runtime release tag does not point at the reviewed Nodex commit.");
  }
}

function resolveRemoteTagCommit(repo: string, tag: string): string {
  const reference = JSON.parse(runGh(["api", `repos/${repo}/git/ref/tags/${tag}`])) as {
    readonly object?: { readonly sha?: unknown; readonly type?: unknown };
  };
  let object = reference.object;
  for (let depth = 0; depth < 4; depth += 1) {
    if (object?.type === "commit" && typeof object.sha === "string") return object.sha;
    if (object?.type !== "tag" || typeof object.sha !== "string") break;
    const annotatedTag = JSON.parse(runGh(["api", `repos/${repo}/git/tags/${object.sha}`])) as {
      readonly object?: { readonly sha?: unknown; readonly type?: unknown };
    };
    object = annotatedTag.object;
  }
  throw new Error("Agent runtime release tag does not resolve to a Git commit.");
}

export function agentRuntimeReleaseArguments(
  options: AgentRuntimeReleaseOptions,
): readonly string[] {
  if (!/^agent-runtime-v\d+(?:\.\d+)+-[a-f0-9]{8}$/.test(options.tag)) {
    throw new Error("Agent runtime tag must use agent-runtime-v<version>-<8-char-source-commit>.");
  }
  if (!/^[a-f0-9]{40}$/.test(options.sourceCommit)) {
    throw new Error("Agent runtime source commit must be a full 40-character Git commit.");
  }
  if (!options.tag.endsWith(`-${options.sourceCommit.slice(0, 8)}`)) {
    throw new Error("Agent runtime tag does not identify its source commit.");
  }

  const projectRoot = resolve(options.projectRootPath ?? defaultProjectRoot);
  const lock = readOpenInterpreterReleaseLock(
    resolve(options.lockPath ?? resolveOpenInterpreterReleaseLockPath(projectRoot)),
  );
  if (lock.release.repository !== options.repo) {
    throw new Error("Agent runtime publication repository does not match the canonical lock.");
  }
  if (lock.release.tag !== options.tag) {
    throw new Error("Agent runtime publication tag does not match the canonical lock.");
  }
  if (lock.source.commit !== options.sourceCommit) {
    throw new Error("Agent runtime source commit does not match the canonical lock.");
  }

  const paths = {
    arm64: resolve(options.arm64Path),
    x64: resolve(options.x64Path),
  };
  for (const architecture of ["arm64", "x64"] as const) {
    const filePath = paths[architecture];
    const stats = lstatSync(filePath);
    const asset = lock.assets[`darwin-${architecture}`];
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      basename(filePath) !== AGENT_RUNTIME_ASSET_NAMES[architecture]
    ) {
      throw new Error(`Agent runtime ${architecture} archive is invalid.`);
    }
    if (asset.assetName !== basename(filePath) || asset.archiveSize !== stats.size) {
      throw new Error(`Agent runtime ${architecture} archive does not match the canonical lock.`);
    }
    if (sha256File(filePath) !== asset.archiveSha256) {
      throw new Error(`Agent runtime ${architecture} archive does not match the canonical lock.`);
    }
  }

  return [
    "release",
    "create",
    options.tag,
    paths.arm64,
    paths.x64,
    "--repo",
    options.repo,
    "--verify-tag",
    "--latest=false",
    "--title",
    `Nodex Agent runtime ${options.tag.replace("agent-runtime-v", "")}`,
    "--notes",
    `Immutable Codex-compatible Agent runtime closure based on reviewed source commit ${options.sourceCommit}; the source repository and ordered build patches are declared by the Nodex release lock.`,
  ];
}

export function publishAgentRuntime(options: AgentRuntimeReleaseOptions): void {
  const projectRoot = resolve(options.projectRootPath ?? defaultProjectRoot);
  const args = agentRuntimeReleaseArguments(options);
  assertAgentRuntimeReviewedTag({
    currentCommit: runGit(["rev-parse", "HEAD"], projectRoot),
    remoteTagCommit: resolveRemoteTagCommit(options.repo, options.tag),
    worktreeStatus: runGit(["status", "--porcelain=v1", "--untracked-files=normal"], projectRoot),
  });

  const latestBefore = JSON.parse(runGh(["api", `repos/${options.repo}/releases/latest`])) as {
    readonly tag_name?: unknown;
  };
  if (
    typeof latestBefore.tag_name !== "string" ||
    !stableVersionFromAppTag(latestBefore.tag_name)
  ) {
    throw new Error(
      "Agent runtime publication requires Latest to already be a stable app release.",
    );
  }
  runGh(args);
  const latestAfter = JSON.parse(runGh(["api", `repos/${options.repo}/releases/latest`])) as {
    readonly tag_name?: unknown;
  };
  if (latestAfter.tag_name !== latestBefore.tag_name) {
    throw new Error("Agent runtime publication changed the stable app Latest release.");
  }
}
