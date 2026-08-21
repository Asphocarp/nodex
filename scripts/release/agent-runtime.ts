import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableVersionFromAppTag } from "./model";

const AGENT_RUNTIME_ASSET_NAMES = {
  arm64: "open-interpreter-package-aarch64-apple-darwin.tar.gz",
  x64: "open-interpreter-package-x86_64-apple-darwin.tar.gz",
} as const;

const run = (args: readonly string[]): string =>
  execFileSync("gh", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export function agentRuntimeReleaseArguments(options: {
  readonly arm64Path: string;
  readonly repo: string;
  readonly sourceCommit: string;
  readonly tag: string;
  readonly x64Path: string;
}): readonly string[] {
  if (!/^agent-runtime-v\d+(?:\.\d+)+-[a-f0-9]{8}$/.test(options.tag)) {
    throw new Error("Agent runtime tag must use agent-runtime-v<version>-<8-char-source-commit>.");
  }
  if (!/^[a-f0-9]{40}$/.test(options.sourceCommit)) {
    throw new Error("Agent runtime source commit must be a full 40-character Git commit.");
  }
  if (!options.tag.endsWith(`-${options.sourceCommit.slice(0, 8)}`)) {
    throw new Error("Agent runtime tag does not identify its source commit.");
  }

  const paths = {
    arm64: resolve(options.arm64Path),
    x64: resolve(options.x64Path),
  };
  for (const architecture of ["arm64", "x64"] as const) {
    const filePath = paths[architecture];
    const stats = lstatSync(filePath);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      basename(filePath) !== AGENT_RUNTIME_ASSET_NAMES[architecture]
    ) {
      throw new Error(`Agent runtime ${architecture} archive is invalid.`);
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
    `Immutable Open Interpreter runtime closure based on openinterpreter/openinterpreter@${options.sourceCommit}; reviewed build patches are declared by the Nodex release lock.`,
  ];
}

export function publishAgentRuntime(options: {
  readonly arm64Path: string;
  readonly repo: string;
  readonly sourceCommit: string;
  readonly tag: string;
  readonly x64Path: string;
}): void {
  const latestBefore = JSON.parse(run(["api", `repos/${options.repo}/releases/latest`])) as {
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
  run(agentRuntimeReleaseArguments(options));
  const latestAfter = JSON.parse(run(["api", `repos/${options.repo}/releases/latest`])) as {
    readonly tag_name?: unknown;
  };
  if (latestAfter.tag_name !== latestBefore.tag_name) {
    throw new Error("Agent runtime publication changed the stable app Latest release.");
  }
}
