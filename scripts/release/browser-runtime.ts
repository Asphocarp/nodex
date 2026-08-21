import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableVersionFromAppTag } from "./model";

const run = (args: readonly string[]): string =>
  execFileSync("gh", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export function browserRuntimeReleaseArguments(options: {
  readonly arm64Path: string;
  readonly repo: string;
  readonly tag: string;
  readonly x64Path: string;
}): readonly string[] {
  if (!/^browser-runtime-v\d+(?:\.\d+)+$/.test(options.tag)) {
    throw new Error("Browser runtime tag must use browser-runtime-v<version>.");
  }
  const arm64Path = resolve(options.arm64Path);
  const x64Path = resolve(options.x64Path);
  for (const [architecture, filePath] of [
    ["arm64", arm64Path],
    ["x64", x64Path],
  ] as const) {
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || !basename(filePath).includes(architecture)) {
      throw new Error(`Browser runtime ${architecture} archive is invalid.`);
    }
  }
  return [
    "release",
    "create",
    options.tag,
    arm64Path,
    x64Path,
    "--repo",
    options.repo,
    "--verify-tag",
    "--latest=false",
    "--title",
    `Nodex Browser runtime ${options.tag.replace("browser-runtime-v", "")}`,
    "--notes",
    "Immutable Browser runtime closure consumed by Nodex release locks.",
  ];
}

export function publishBrowserRuntime(options: {
  readonly arm64Path: string;
  readonly repo: string;
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
      "Browser runtime publication requires Latest to already be a stable app release.",
    );
  }
  run(browserRuntimeReleaseArguments(options));
  const latestAfter = JSON.parse(run(["api", `repos/${options.repo}/releases/latest`])) as {
    readonly tag_name?: unknown;
  };
  if (latestAfter.tag_name !== latestBefore.tag_name) {
    throw new Error("Browser runtime publication changed the stable app Latest release.");
  }
}
