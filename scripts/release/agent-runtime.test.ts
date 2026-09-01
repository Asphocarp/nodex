import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { agentRuntimeReleaseArguments, assertAgentRuntimeReviewedTag } from "./agent-runtime";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function writeReleaseLock(input: {
  readonly arm64: string;
  readonly directory: string;
  readonly repo?: string;
  readonly sourceCommit: string;
  readonly tag: string;
  readonly x64: string;
}): string {
  const lockPath = join(input.directory, "openinterpreter.lock.json");
  const asset = (architecture: "arm64" | "x64", contents: string) => {
    const assetName =
      architecture === "arm64"
        ? "open-interpreter-package-aarch64-apple-darwin.tar.gz"
        : "open-interpreter-package-x86_64-apple-darwin.tar.gz";
    return {
      archiveSha256: sha256(contents),
      archiveSize: Buffer.byteLength(contents),
      assetName,
      runtimeMetadataSha256: "4".repeat(64),
      targetTriple: architecture === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin",
      url: `https://github.com/${input.repo ?? "junyudev/nodex"}/releases/download/${input.tag}/${assetName}`,
    };
  };
  writeFileSync(
    lockPath,
    `${JSON.stringify({
      schemaVersion: 2,
      runtimeFamily: "open-interpreter",
      source: { repository: "openai/codex", commit: input.sourceCommit, patches: [] },
      release: { repository: input.repo ?? "junyudev/nodex", tag: input.tag },
      runtimeVersion: "0.146.0",
      codexCompatibilityVersion: "0.150.0-alpha.12.2",
      protocolSchemaSha256: "2".repeat(64),
      packageManifest: {
        layoutVersion: 1,
        version: "0.146.0",
        variant: "open-interpreter",
        entrypoint: "bin/interpreter",
        resourcesDir: "codex-resources",
        pathDir: "codex-path",
      },
      requiredArtifacts: ["codex-package.json", "bin/interpreter"],
      assets: {
        "darwin-arm64": asset("arm64", input.arm64),
        "darwin-x64": asset("x64", input.x64),
      },
      notices: {
        licensePath: "resources/third-party/open-interpreter/LICENSE",
        licenseSha256: "7".repeat(64),
        noticePath: "resources/third-party/open-interpreter/NOTICE",
        noticeSha256: "8".repeat(64),
      },
    })}\n`,
    "utf8",
  );
  return lockPath;
}

test("Agent runtime publication binds immutable artifacts to the exact source commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodex-agent-runtime-release-"));
  directories.push(directory);
  const arm64 = join(directory, "open-interpreter-package-aarch64-apple-darwin.tar.gz");
  const x64 = join(directory, "open-interpreter-package-x86_64-apple-darwin.tar.gz");
  writeFileSync(arm64, "arm64");
  writeFileSync(x64, "x64");
  const sourceCommit = "855ab60c0e10dac6bc89f3e248cba3746d44f034";
  const tag = "agent-runtime-v0.146.0-855ab60c";
  const lockPath = writeReleaseLock({
    arm64: "arm64",
    directory,
    sourceCommit,
    tag,
    x64: "x64",
  });
  const args = agentRuntimeReleaseArguments({
    arm64Path: arm64,
    lockPath,
    repo: "junyudev/nodex",
    sourceCommit,
    tag,
    x64Path: x64,
  });

  expect(args).toContain("--latest=false");
  expect(args).toContain("--verify-tag");
  expect(args.join(" ")).toContain(sourceCommit);
  expect(args.join(" ")).toContain("the source repository and ordered build patches");
  expect(args.join(" ")).not.toContain("openinterpreter/openinterpreter@");
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

test("Agent runtime publication rejects same-sized archive bytes outside the canonical lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodex-agent-runtime-release-"));
  directories.push(directory);
  const arm64 = join(directory, "open-interpreter-package-aarch64-apple-darwin.tar.gz");
  const x64 = join(directory, "open-interpreter-package-x86_64-apple-darwin.tar.gz");
  writeFileSync(arm64, "arm65");
  writeFileSync(x64, "x64");
  const sourceCommit = "855ab60c0e10dac6bc89f3e248cba3746d44f034";
  const tag = "agent-runtime-v0.146.0-855ab60c";
  const lockPath = writeReleaseLock({
    arm64: "arm64",
    directory,
    sourceCommit,
    tag,
    x64: "x64",
  });

  expect(() =>
    agentRuntimeReleaseArguments({
      arm64Path: arm64,
      lockPath,
      repo: "junyudev/nodex",
      sourceCommit,
      tag,
      x64Path: x64,
    }),
  ).toThrow("arm64 archive does not match the canonical lock");

  writeFileSync(arm64, "larger-arm64-archive");
  expect(() =>
    agentRuntimeReleaseArguments({
      arm64Path: arm64,
      lockPath,
      repo: "junyudev/nodex",
      sourceCommit,
      tag,
      x64Path: x64,
    }),
  ).toThrow("arm64 archive does not match the canonical lock");
});

test("Agent runtime publication binds repository, tag, and full source commit to the lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodex-agent-runtime-release-"));
  directories.push(directory);
  const arm64 = join(directory, "open-interpreter-package-aarch64-apple-darwin.tar.gz");
  const x64 = join(directory, "open-interpreter-package-x86_64-apple-darwin.tar.gz");
  writeFileSync(arm64, "arm64");
  writeFileSync(x64, "x64");
  const sourceCommit = "855ab60c0e10dac6bc89f3e248cba3746d44f034";
  const tag = "agent-runtime-v0.146.0-855ab60c";
  const invoke = (input: { lockPath: string; repo?: string; tag?: string }) =>
    agentRuntimeReleaseArguments({
      arm64Path: arm64,
      lockPath: input.lockPath,
      repo: input.repo ?? "junyudev/nodex",
      sourceCommit,
      tag: input.tag ?? tag,
      x64Path: x64,
    });

  const otherRepositoryLock = writeReleaseLock({
    arm64: "arm64",
    directory,
    repo: "other/nodex",
    sourceCommit,
    tag,
    x64: "x64",
  });
  expect(() => invoke({ lockPath: otherRepositoryLock })).toThrow(
    "repository does not match the canonical lock",
  );

  const lockedTag = "agent-runtime-v0.146.1-855ab60c";
  const otherTagLock = writeReleaseLock({
    arm64: "arm64",
    directory,
    sourceCommit,
    tag: lockedTag,
    x64: "x64",
  });
  expect(() => invoke({ lockPath: otherTagLock })).toThrow("tag does not match the canonical lock");

  const otherSourceLock = writeReleaseLock({
    arm64: "arm64",
    directory,
    sourceCommit: `${sourceCommit.slice(0, 8)}${"f".repeat(32)}`,
    tag,
    x64: "x64",
  });
  expect(() => invoke({ lockPath: otherSourceLock })).toThrow(
    "source commit does not match the canonical lock",
  );
});

test("Agent runtime publication requires a clean reviewed commit behind the remote tag", () => {
  expect(() =>
    assertAgentRuntimeReviewedTag({
      currentCommit: "a".repeat(40),
      remoteTagCommit: "a".repeat(40),
      worktreeStatus: " M resources/agent-runtime/openinterpreter.lock.json",
    }),
  ).toThrow("clean reviewed worktree");
  expect(() =>
    assertAgentRuntimeReviewedTag({
      currentCommit: "a".repeat(40),
      remoteTagCommit: "b".repeat(40),
      worktreeStatus: "",
    }),
  ).toThrow("does not point at the reviewed Nodex commit");
});
