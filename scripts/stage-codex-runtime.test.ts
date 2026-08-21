import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { BundledAgentRuntimeMetadata } from "../src/shared/codex-runtime-metadata";
import { writeBrowserRuntimeFixture } from "../src/main/codex/browser-runtime-test-fixture";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";
import {
  bundledAgentRuntimeMetadataSha256,
  resolveCodexRuntimeTarget,
  stageCodexRuntime,
} from "./stage-codex-runtime";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function writeExecutable(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
  fs.chmodSync(filePath, 0o755);
}

function makeFakeOpenInterpreterRelease(input?: {
  omitCodeModeHost?: boolean;
  restrictiveSourceModes?: boolean;
}): {
  cleanup: () => void;
  lockPath: string;
  projectRoot: string;
  sourceRoot: string;
} {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-agent-runtime-"));
  const projectRoot = path.join(fixtureRoot, "project");
  const sourceRoot = path.join(fixtureRoot, "release");
  const license = "fake apache license\n";
  const notice = "fake notice\n";
  const requiredArtifacts = [
    "codex-package.json",
    "bin/interpreter",
    "bin/codex-code-mode-host",
    "codex-path/rg",
    "codex-resources/zsh/bin/zsh",
  ];

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, "codex-package.json"),
    JSON.stringify({
      layoutVersion: 1,
      version: "0.0.34",
      target: "aarch64-apple-darwin",
      variant: "open-interpreter",
      entrypoint: "bin/interpreter",
      resourcesDir: "codex-resources",
      pathDir: "codex-path",
    }),
    "utf8",
  );
  writeExecutable(path.join(sourceRoot, "bin", "interpreter"), "#!/bin/sh\necho interpreter\n");
  if (!input?.omitCodeModeHost) {
    writeExecutable(path.join(sourceRoot, "bin", "codex-code-mode-host"), "#!/bin/sh\necho host\n");
  }
  writeExecutable(path.join(sourceRoot, "bin", "i"), "#!/bin/sh\necho duplicate\n");
  writeExecutable(path.join(sourceRoot, "codex-path", "rg"), "#!/bin/sh\necho rg\n");
  writeExecutable(
    path.join(sourceRoot, "codex-resources", "zsh", "bin", "zsh"),
    "#!/bin/sh\necho zsh\n",
  );

  if (input?.restrictiveSourceModes) {
    for (const artifactPath of requiredArtifacts) {
      const filePath = path.join(sourceRoot, artifactPath);
      if (!fs.existsSync(filePath)) continue;
      const mode = (fs.statSync(filePath).mode & 0o111) !== 0 ? 0o700 : 0o600;
      fs.chmodSync(filePath, mode);
    }
  }

  const licensePath = path.join(
    projectRoot,
    "resources",
    "third-party",
    "open-interpreter",
    "LICENSE",
  );
  const noticePath = path.join(
    projectRoot,
    "resources",
    "third-party",
    "open-interpreter",
    "NOTICE",
  );
  fs.mkdirSync(path.dirname(licensePath), { recursive: true });
  fs.writeFileSync(licensePath, license, "utf8");
  fs.writeFileSync(noticePath, notice, "utf8");

  const artifacts = requiredArtifacts
    .filter((artifactPath) => fs.existsSync(path.join(sourceRoot, artifactPath)))
    .map((artifactPath) => {
      const filePath = path.join(sourceRoot, artifactPath);
      const stats = fs.statSync(filePath);
      return {
        executable: (stats.mode & 0o111) !== 0,
        path: artifactPath,
        sha256: createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
        size: stats.size,
      };
    })
    .concat([
      {
        executable: false,
        path: "third-party/open-interpreter/LICENSE",
        sha256: sha256(license),
        size: Buffer.byteLength(license),
      },
      {
        executable: false,
        path: "third-party/open-interpreter/NOTICE",
        sha256: sha256(notice),
        size: Buffer.byteLength(notice),
      },
    ])
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedMetadata: BundledAgentRuntimeMetadata = {
    artifactRelease: {
      archiveSha256: "2".repeat(64),
      assetName: "runtime-arm64.tar.gz",
      repository: "example/nodex",
      tag: "agent-runtime-v0.0.34-aaaaaaaa",
    },
    artifacts,
    codexCompatibilityVersion: "0.144.5",
    entrypoint: "bin/interpreter",
    layoutVersion: 3,
    packageManifest: {
      layoutVersion: 1,
      version: "0.0.34",
      target: "aarch64-apple-darwin",
      variant: "open-interpreter",
      entrypoint: "bin/interpreter",
      resourcesDir: "codex-resources",
      pathDir: "codex-path",
    },
    runtimeFamily: "open-interpreter",
    runtimeVersion: "0.0.34",
    searchPaths: ["codex-path"],
    sourceRevision: {
      commit: "a".repeat(40),
      patches: [],
      repository: "openinterpreter/openinterpreter",
    },
    targetArch: "arm64",
    targetPlatform: "darwin",
    targetTriple: "aarch64-apple-darwin",
  };

  const lockPath = path.join(
    projectRoot,
    "resources",
    "agent-runtime",
    "openinterpreter.lock.json",
  );
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      schemaVersion: 2,
      runtimeFamily: "open-interpreter",
      source: {
        repository: "openinterpreter/openinterpreter",
        commit: "a".repeat(40),
        patches: [],
      },
      release: {
        repository: "example/nodex",
        tag: "agent-runtime-v0.0.34-aaaaaaaa",
      },
      runtimeVersion: "0.0.34",
      codexCompatibilityVersion: "0.144.5",
      protocolSchemaSha256: "1".repeat(64),
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
          assetName: "runtime-arm64.tar.gz",
          url: "https://github.com/example/nodex/releases/download/agent-runtime-v0.0.34-aaaaaaaa/runtime-arm64.tar.gz",
          archiveSha256: "2".repeat(64),
          archiveSize: 1,
          runtimeMetadataSha256: input?.omitCodeModeHost
            ? "5".repeat(64)
            : bundledAgentRuntimeMetadataSha256(expectedMetadata),
        },
        "darwin-x64": {
          targetTriple: "x86_64-apple-darwin",
          assetName: "runtime-x64.tar.gz",
          url: "https://github.com/example/nodex/releases/download/agent-runtime-v0.0.34-aaaaaaaa/runtime-x64.tar.gz",
          archiveSha256: "3".repeat(64),
          archiveSize: 1,
          runtimeMetadataSha256: "4".repeat(64),
        },
      },
      notices: {
        licensePath: "resources/third-party/open-interpreter/LICENSE",
        licenseSha256: sha256(license),
        noticePath: "resources/third-party/open-interpreter/NOTICE",
        noticeSha256: sha256(notice),
      },
    }),
    "utf8",
  );

  return {
    cleanup: () => fs.rmSync(fixtureRoot, { recursive: true, force: true }),
    lockPath,
    projectRoot,
    sourceRoot,
  };
}

describe("stage-codex-runtime", () => {
  test("resolves the pinned darwin target metadata", () => {
    const target = resolveCodexRuntimeTarget("darwin", "arm64");

    expect(target.targetKey).toBe("darwin-arm64");
    expect(target.targetTriple).toBe("aarch64-apple-darwin");
  });

  test("stages the canonical package context without the duplicate CLI alias", async () => {
    const fixture = makeFakeOpenInterpreterRelease();
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-agent-runtime-out-"));
    const outputPath = path.join(outputRoot, "codex-runtime");

    try {
      fs.mkdirSync(outputPath, { recursive: true });
      fs.writeFileSync(path.join(outputPath, "stale.txt"), "stale", "utf8");
      fs.mkdirSync(path.join(outputPath, "bin"));
      fs.writeFileSync(path.join(outputPath, "bin", "nodex-core"), "core", "utf8");

      const metadata = await stageCodexRuntime({
        targetPlatform: "darwin",
        targetArch: "arm64",
        outputPath,
        sourceRoot: fixture.sourceRoot,
        lockPath: fixture.lockPath,
        projectRootPath: fixture.projectRoot,
      });
      const runtimeRoot = path.join(outputPath, "agent-runtime");

      expect(metadata.runtimeFamily).toBe("open-interpreter");
      expect(metadata.runtimeVersion).toBe("0.0.34");
      expect(metadata.codexCompatibilityVersion).toBe("0.144.5");
      expect(metadata.entrypoint).toBe("bin/interpreter");
      expect(metadata.targetTriple).toBe("aarch64-apple-darwin");
      expect(fs.existsSync(path.join(runtimeRoot, "codex-package.json"))).toBe(true);
      expect(fs.existsSync(path.join(runtimeRoot, "bin", "interpreter"))).toBe(true);
      expect(fs.existsSync(path.join(runtimeRoot, "bin", "codex-code-mode-host"))).toBe(true);
      expect(fs.existsSync(path.join(runtimeRoot, "codex-path", "rg"))).toBe(true);
      expect(fs.existsSync(path.join(runtimeRoot, "codex-resources", "zsh", "bin", "zsh"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(runtimeRoot, "bin", "i"))).toBe(false);
      expect(fs.existsSync(path.join(runtimeRoot, "agent-runtime.json"))).toBe(true);
      expect(
        fs.existsSync(path.join(runtimeRoot, "third-party", "open-interpreter", "LICENSE")),
      ).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "stale.txt"))).toBe(true);
      expect(fs.readFileSync(path.join(outputPath, "bin", "nodex-core"), "utf8")).toBe("core");

      const writtenMetadata = JSON.parse(
        fs.readFileSync(path.join(runtimeRoot, "agent-runtime.json"), "utf8"),
      ) as {
        artifacts?: Array<{ executable?: boolean; path?: string; sha256?: string; size?: number }>;
        layoutVersion?: number;
        searchPaths?: string[];
        artifactRelease?: { tag?: string };
        sourceRevision?: { commit?: string };
      };
      expect(writtenMetadata.layoutVersion).toBe(3);
      expect(writtenMetadata.artifactRelease?.tag).toBe("agent-runtime-v0.0.34-aaaaaaaa");
      expect(writtenMetadata.sourceRevision?.commit).toBe("a".repeat(40));
      expect(writtenMetadata.searchPaths).toEqual(["codex-path"]);
      expect(writtenMetadata.artifacts?.map((artifact) => artifact.path)).toEqual([
        "bin/codex-code-mode-host",
        "bin/interpreter",
        "codex-package.json",
        "codex-path/rg",
        "codex-resources/zsh/bin/zsh",
        "third-party/open-interpreter/LICENSE",
        "third-party/open-interpreter/NOTICE",
      ]);
    } finally {
      fixture.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("normalizes runtime modes from a release extracted under a restrictive umask", async () => {
    const fixture = makeFakeOpenInterpreterRelease({ restrictiveSourceModes: true });
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-agent-runtime-out-"));
    const outputPath = path.join(outputRoot, "codex-runtime");

    try {
      const metadata = await (async () => {
        const previousUmask = process.umask(0o077);
        try {
          return await stageCodexRuntime({
            targetPlatform: "darwin",
            targetArch: "arm64",
            outputPath,
            sourceRoot: fixture.sourceRoot,
            lockPath: fixture.lockPath,
            projectRootPath: fixture.projectRoot,
          });
        } finally {
          process.umask(previousUmask);
        }
      })();
      const runtimeRoot = path.join(outputPath, "agent-runtime");

      for (const artifact of metadata.artifacts) {
        const artifactPath = path.join(runtimeRoot, ...artifact.path.split("/"));
        expect(fs.statSync(artifactPath).mode & 0o777).toBe(artifact.executable ? 0o755 : 0o644);
      }
      expect(fs.statSync(path.join(runtimeRoot, "agent-runtime.json")).mode & 0o777).toBe(0o644);
    } finally {
      fixture.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("activates a verified Browser bundle inside the same runtime replacement", async () => {
    const fixture = makeFakeOpenInterpreterRelease();
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-agent-runtime-out-"));
    const outputPath = path.join(outputRoot, "codex-runtime");
    const browserRuntimeSourceRoot = path.join(outputRoot, "browser-source");
    writeBrowserRuntimeFixture(browserRuntimeSourceRoot, {
      codexCompatibilityVersion: "0.144.5",
    });

    try {
      await stageCodexRuntime({
        browserRuntimeSourceRoot,
        targetPlatform: "darwin",
        targetArch: "arm64",
        outputPath,
        sourceRoot: fixture.sourceRoot,
        lockPath: fixture.lockPath,
        projectRootPath: fixture.projectRoot,
      });

      const runtime = resolveCodexRuntime({
        browserRuntimePlatformArtifactVerifier: () => null,
        isPackaged: true,
        resourcesPath: path.join(outputPath, "agent-runtime"),
      });
      expect(runtime.browserRuntime.status).toBe("available");

      await stageCodexRuntime({
        reuseExisting: true,
        targetPlatform: "darwin",
        targetArch: "arm64",
        outputPath,
        sourceRoot: fixture.sourceRoot,
        lockPath: fixture.lockPath,
        projectRootPath: fixture.projectRoot,
      });
      expect(
        resolveCodexRuntime({
          browserRuntimePlatformArtifactVerifier: () => null,
          isPackaged: true,
          resourcesPath: path.join(outputPath, "agent-runtime"),
        }).browserRuntime.status,
      ).toBe("available");
    } finally {
      fixture.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("reuses an exact lock-bound runtime and repairs content damage", async () => {
    const fixture = makeFakeOpenInterpreterRelease();
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-agent-runtime-out-"));
    const outputPath = path.join(outputRoot, "codex-runtime");

    try {
      const options = {
        targetPlatform: "darwin" as const,
        targetArch: "arm64" as const,
        outputPath,
        sourceRoot: fixture.sourceRoot,
        lockPath: fixture.lockPath,
        projectRootPath: fixture.projectRoot,
        reuseExisting: true,
      };
      await stageCodexRuntime(options);
      const entrypoint = path.join(outputPath, "agent-runtime", "bin", "interpreter");
      const firstModifiedAt = fs.statSync(entrypoint).mtimeMs;

      await stageCodexRuntime(options);
      expect(fs.statSync(entrypoint).mtimeMs).toBe(firstModifiedAt);

      fs.chmodSync(entrypoint, 0o700);
      await stageCodexRuntime(options);
      expect(fs.statSync(entrypoint).mode & 0o777).toBe(0o755);

      const metadataPath = path.join(outputPath, "agent-runtime", "agent-runtime.json");
      fs.chmodSync(metadataPath, 0o600);
      await stageCodexRuntime(options);
      expect(fs.statSync(metadataPath).mode & 0o777).toBe(0o644);

      fs.writeFileSync(entrypoint, "damaged", "utf8");
      await stageCodexRuntime(options);
      expect(fs.readFileSync(entrypoint, "utf8")).toContain("echo interpreter");

      const runtimeRoot = path.join(outputPath, "agent-runtime");
      const externalRuntimeRoot = path.join(outputRoot, "external-agent-runtime");
      fs.renameSync(runtimeRoot, externalRuntimeRoot);
      fs.symlinkSync(externalRuntimeRoot, runtimeRoot, "dir");
      await stageCodexRuntime(options);
      expect(fs.lstatSync(runtimeRoot).isSymbolicLink()).toBe(false);
      expect(fs.existsSync(path.join(externalRuntimeRoot, "agent-runtime.json"))).toBe(true);
    } finally {
      fixture.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("rejects a release whose required closure omits the code-mode host", async () => {
    const fixture = makeFakeOpenInterpreterRelease({ omitCodeModeHost: true });
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-agent-runtime-out-"));
    const outputPath = path.join(outputRoot, "codex-runtime");

    try {
      await expect(
        stageCodexRuntime({
          targetPlatform: "darwin",
          targetArch: "arm64",
          outputPath,
          sourceRoot: fixture.sourceRoot,
          lockPath: fixture.lockPath,
          projectRootPath: fixture.projectRoot,
        }),
      ).rejects.toThrow("bin/codex-code-mode-host");
      expect(fs.readdirSync(outputRoot)).toEqual(["codex-runtime"]);
      expect(fs.readdirSync(outputPath)).toEqual([]);
    } finally {
      fixture.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
