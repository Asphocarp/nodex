import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { readOpenInterpreterReleaseLock } from "./agent-runtime-release-lock";
import {
  createAgentRuntimeRelockCandidate,
  writeAgentRuntimeRelockCandidate,
} from "./relock-agent-runtime";
import { stageCodexRuntime } from "./stage-codex-runtime";

const directories: string[] = [];
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeExecutable(filePath: string, body: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
  chmodSync(filePath, 0o755);
}

function createArchive(input: {
  archivePath: string;
  target: "aarch64-apple-darwin" | "x86_64-apple-darwin";
}): void {
  const sourceRoot = mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-package-"));
  try {
    writeFileSync(
      path.join(sourceRoot, "codex-package.json"),
      `${JSON.stringify(
        {
          layoutVersion: 1,
          version: "0.0.35",
          target: input.target,
          variant: "open-interpreter",
          entrypoint: "bin/interpreter",
          resourcesDir: "codex-resources",
          pathDir: "codex-path",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeExecutable(path.join(sourceRoot, "bin/interpreter"), "#!/bin/sh\necho interpreter\n");
    writeExecutable(
      path.join(sourceRoot, "bin/codex-code-mode-host"),
      "#!/bin/sh\necho code-mode-host\n",
    );
    writeExecutable(path.join(sourceRoot, "codex-path/rg"), "#!/bin/sh\necho rg\n");
    writeExecutable(path.join(sourceRoot, "codex-resources/zsh/bin/zsh"), "#!/bin/sh\necho zsh\n");
    mkdirSync(path.dirname(input.archivePath), { recursive: true });
    execFileSync("tar", [
      "-czf",
      input.archivePath,
      "-C",
      sourceRoot,
      "bin",
      "codex-package.json",
      "codex-path",
      "codex-resources",
    ]);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
  }
}

function makeFixture(): {
  arm64ArchivePath: string;
  lockPath: string;
  outputPath: string;
  projectRoot: string;
  x64ArchivePath: string;
} {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-relock-test-"));
  directories.push(projectRoot);
  const patch = "reviewed patch\n";
  const license = "license\n";
  const notice = "notice\n";
  const patchPath = path.join(projectRoot, "resources/agent-runtime/patches/runtime.patch");
  const licensePath = path.join(projectRoot, "resources/third-party/open-interpreter/LICENSE");
  const noticePath = path.join(projectRoot, "resources/third-party/open-interpreter/NOTICE");
  mkdirSync(path.dirname(patchPath), { recursive: true });
  mkdirSync(path.dirname(licensePath), { recursive: true });
  writeFileSync(patchPath, patch, "utf8");
  writeFileSync(licensePath, license, "utf8");
  writeFileSync(noticePath, notice, "utf8");

  const artifactRoot = path.join(projectRoot, "artifacts");
  const arm64ArchivePath = path.join(
    artifactRoot,
    "open-interpreter-package-aarch64-apple-darwin.tar.gz",
  );
  const x64ArchivePath = path.join(
    artifactRoot,
    "open-interpreter-package-x86_64-apple-darwin.tar.gz",
  );
  createArchive({ archivePath: arm64ArchivePath, target: "aarch64-apple-darwin" });
  createArchive({ archivePath: x64ArchivePath, target: "x86_64-apple-darwin" });

  const sourceCommit = "a".repeat(40);
  const currentTag = "agent-runtime-v0.0.34-aaaaaaaa";
  const requiredArtifacts = [
    "codex-package.json",
    "bin/interpreter",
    "bin/codex-code-mode-host",
    "codex-path/rg",
    "codex-resources/zsh/bin/zsh",
  ];
  const lockPath = path.join(projectRoot, "resources/agent-runtime/openinterpreter.lock.json");
  writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        runtimeFamily: "open-interpreter",
        source: {
          repository: "openai/codex",
          commit: sourceCommit,
          patches: [
            {
              sourcePath: "resources/agent-runtime/patches/runtime.patch",
              artifactPath: "third-party/open-interpreter/patches/runtime.patch",
              sha256: "1".repeat(64),
            },
          ],
        },
        release: { repository: "example/nodex", tag: currentTag },
        runtimeVersion: "0.0.34",
        codexCompatibilityVersion: "0.150.0-alpha.12.2",
        protocolSchemaSha256: "2".repeat(64),
        packageManifest: {
          layoutVersion: 1,
          version: "0.0.34",
          variant: "open-interpreter",
          entrypoint: "bin/interpreter",
          resourcesDir: "codex-resources",
          pathDir: "codex-path",
        },
        requiredArtifacts,
        assets: {
          "darwin-arm64": {
            targetTriple: "aarch64-apple-darwin",
            assetName: "open-interpreter-package-aarch64-apple-darwin.tar.gz",
            url: `https://github.com/example/nodex/releases/download/${currentTag}/open-interpreter-package-aarch64-apple-darwin.tar.gz`,
            archiveSha256: "3".repeat(64),
            archiveSize: 1,
            runtimeMetadataSha256: "4".repeat(64),
          },
          "darwin-x64": {
            targetTriple: "x86_64-apple-darwin",
            assetName: "open-interpreter-package-x86_64-apple-darwin.tar.gz",
            url: `https://github.com/example/nodex/releases/download/${currentTag}/open-interpreter-package-x86_64-apple-darwin.tar.gz`,
            archiveSha256: "5".repeat(64),
            archiveSize: 1,
            runtimeMetadataSha256: "6".repeat(64),
          },
        },
        notices: {
          licensePath: "resources/third-party/open-interpreter/LICENSE",
          licenseSha256: "7".repeat(64),
          noticePath: "resources/third-party/open-interpreter/NOTICE",
          noticeSha256: "8".repeat(64),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    arm64ArchivePath,
    lockPath,
    outputPath: path.join(projectRoot, "candidate/openinterpreter.lock.json"),
    projectRoot,
    x64ArchivePath,
  };
}

test("writes a complete dual-architecture candidate without changing the current lock", async () => {
  const fixture = makeFixture();
  const currentLockSource = readFileSync(fixture.lockPath, "utf8");
  const protocolSchemaSha256 = "9".repeat(64);
  const fingerprintedBinaries: string[] = [];
  const releaseTag = "agent-runtime-v0.0.35-aaaaaaaa";
  const candidate = await writeAgentRuntimeRelockCandidate({
    ...fixture,
    fingerprintSchema: (binaryPath) => {
      fingerprintedBinaries.push(binaryPath);
      return protocolSchemaSha256;
    },
    projectRootPath: fixture.projectRoot,
    releaseTag,
  });

  expect(readFileSync(fixture.lockPath, "utf8")).toBe(currentLockSource);
  expect(readOpenInterpreterReleaseLock(fixture.outputPath)).toEqual(candidate);
  expect(candidate.runtimeVersion).toBe("0.0.35");
  expect(candidate.packageManifest.version).toBe("0.0.35");
  expect(candidate.release.tag).toBe(releaseTag);
  expect(candidate.protocolSchemaSha256).toBe(protocolSchemaSha256);
  expect(candidate.source.patches[0]?.sha256).toBe(sha256("reviewed patch\n"));
  expect(candidate.notices.licenseSha256).toBe(sha256("license\n"));
  expect(candidate.notices.noticeSha256).toBe(sha256("notice\n"));
  expect(fingerprintedBinaries).toHaveLength(2);
  expect(fingerprintedBinaries.some((binaryPath) => binaryPath.includes("/arm64/"))).toBe(true);
  expect(fingerprintedBinaries.some((binaryPath) => binaryPath.includes("/x64/"))).toBe(true);

  for (const targetArch of ["arm64", "x64"] as const) {
    const targetKey = `darwin-${targetArch}` as const;
    const archivePath = targetArch === "arm64" ? fixture.arm64ArchivePath : fixture.x64ArchivePath;
    const asset = candidate.assets[targetKey];
    expect(asset.archiveSha256).toBe(sha256(readFileSync(archivePath)));
    expect(asset.archiveSize).toBe(readFileSync(archivePath).byteLength);
    expect(asset.runtimeMetadataSha256).not.toBe("0".repeat(64));
    expect(asset.url).toContain(`/releases/download/${releaseTag}/`);

    const stagedRoot = path.join(fixture.projectRoot, `verified-${targetArch}`);
    await expect(
      stageCodexRuntime({
        archivePath,
        lockPath: fixture.outputPath,
        outputPath: stagedRoot,
        projectRootPath: fixture.projectRoot,
        targetArch,
        targetPlatform: "darwin",
      }),
    ).resolves.toMatchObject({ targetArch, runtimeVersion: "0.0.35" });
  }
});

test("refuses to overwrite the canonical release lock", async () => {
  const fixture = makeFixture();
  await expect(
    writeAgentRuntimeRelockCandidate({
      ...fixture,
      fingerprintSchema: () => "9".repeat(64),
      outputPath: fixture.lockPath,
      projectRootPath: fixture.projectRoot,
      releaseTag: "agent-runtime-v0.0.35-aaaaaaaa",
    }),
  ).rejects.toThrow("must not overwrite the current release lock");
});

test("refuses to replace an existing candidate output", async () => {
  const fixture = makeFixture();
  mkdirSync(path.dirname(fixture.outputPath), { recursive: true });
  writeFileSync(fixture.outputPath, "keep this candidate\n", "utf8");
  await expect(
    writeAgentRuntimeRelockCandidate({
      ...fixture,
      fingerprintSchema: () => "9".repeat(64),
      projectRootPath: fixture.projectRoot,
      releaseTag: "agent-runtime-v0.0.35-aaaaaaaa",
    }),
  ).rejects.toThrow("output already exists");
  expect(readFileSync(fixture.outputPath, "utf8")).toBe("keep this candidate\n");
});

test("rejects a release tag that names a different source revision before reading archives", async () => {
  const fixture = makeFixture();
  await expect(
    createAgentRuntimeRelockCandidate({
      ...fixture,
      arm64ArchivePath: path.join(fixture.projectRoot, "missing-arm64.tar.gz"),
      fingerprintSchema: () => "9".repeat(64),
      projectRootPath: fixture.projectRoot,
      releaseTag: "agent-runtime-v0.0.35-bbbbbbbb",
      x64ArchivePath: path.join(fixture.projectRoot, "missing-x64.tar.gz"),
    }),
  ).rejects.toThrow("does not identify the locked source commit");
});

test("rejects architecture packages with different protocol schemas", async () => {
  const fixture = makeFixture();
  await expect(
    createAgentRuntimeRelockCandidate({
      ...fixture,
      fingerprintSchema: (binaryPath) =>
        binaryPath.includes("/arm64/") ? "9".repeat(64) : "8".repeat(64),
      projectRootPath: fixture.projectRoot,
      releaseTag: "agent-runtime-v0.0.35-aaaaaaaa",
    }),
  ).rejects.toThrow("architecture packages expose different protocol schemas");
});

test("rejects generated source-worktree caches from release evidence", async () => {
  const fixture = makeFixture();
  writeFileSync(
    path.join(fixture.projectRoot, "resources/agent-runtime/patches/runtime.patch"),
    [
      "diff --git a/codex-rs/core/.zcode/oi-initial-git-status/session.txt b/codex-rs/core/.zcode/oi-initial-git-status/session.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/codex-rs/core/.zcode/oi-initial-git-status/session.txt",
      "@@ -0,0 +1 @@",
      "+local worktree state",
      "",
    ].join("\n"),
    "utf8",
  );

  await expect(
    createAgentRuntimeRelockCandidate({
      ...fixture,
      fingerprintSchema: () => "9".repeat(64),
      projectRootPath: fixture.projectRoot,
      releaseTag: "agent-runtime-v0.0.35-aaaaaaaa",
    }),
  ).rejects.toThrow("source patch contains generated cache path");
});
