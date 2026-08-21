import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { browserRuntimeReleaseArguments } from "./browser-runtime";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("Browser runtime publisher always opts out of app Latest", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodex-browser-release-"));
  directories.push(directory);
  const arm64 = join(directory, "browser-runtime-arm64.tar.gz");
  const x64 = join(directory, "browser-runtime-x64.tar.gz");
  writeFileSync(arm64, "arm64");
  writeFileSync(x64, "x64");
  const args = browserRuntimeReleaseArguments({
    arm64Path: arm64,
    repo: "junyudev/nodex",
    tag: "browser-runtime-v26.727.40816",
    x64Path: x64,
  });
  expect(args).toContain("--latest=false");
  expect(args).toContain("--verify-tag");
  expect(args).not.toContain("--latest");
});
