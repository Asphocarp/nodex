import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { agentRuntimeReleaseArguments } from "./agent-runtime";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Agent runtime publication binds immutable artifacts to the exact source commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodex-agent-runtime-release-"));
  directories.push(directory);
  const arm64 = join(directory, "open-interpreter-package-aarch64-apple-darwin.tar.gz");
  const x64 = join(directory, "open-interpreter-package-x86_64-apple-darwin.tar.gz");
  writeFileSync(arm64, "arm64");
  writeFileSync(x64, "x64");
  const sourceCommit = "855ab60c0e10dac6bc89f3e248cba3746d44f034";
  const args = agentRuntimeReleaseArguments({
    arm64Path: arm64,
    repo: "junyudev/nodex",
    sourceCommit,
    tag: "agent-runtime-v0.146.0-855ab60c",
    x64Path: x64,
  });

  expect(args).toContain("--latest=false");
  expect(args).toContain("--verify-tag");
  expect(args.join(" ")).toContain(sourceCommit);
});

test("Agent runtime publication rejects a tag for a different source commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodex-agent-runtime-release-"));
  directories.push(directory);
  const arm64 = join(directory, "open-interpreter-package-aarch64-apple-darwin.tar.gz");
  const x64 = join(directory, "open-interpreter-package-x86_64-apple-darwin.tar.gz");
  writeFileSync(arm64, "arm64");
  writeFileSync(x64, "x64");

  expect(() =>
    agentRuntimeReleaseArguments({
      arm64Path: arm64,
      repo: "junyudev/nodex",
      sourceCommit: "855ab60c0e10dac6bc89f3e248cba3746d44f034",
      tag: "agent-runtime-v0.146.0-00000000",
      x64Path: x64,
    }),
  ).toThrow("does not identify its source commit");
});
