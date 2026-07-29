import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveCodexRuntime } from "./codex-runtime";

function writeRuntime(rootPath: string): void {
  fs.mkdirSync(rootPath, { recursive: true });
  const artifactBodies = new Map([
    ["codex-package.json", JSON.stringify({
      layoutVersion: 1,
      version: "0.0.34",
      target: "aarch64-apple-darwin",
      variant: "open-interpreter",
      entrypoint: "bin/interpreter",
      resourcesDir: "codex-resources",
      pathDir: "codex-path",
    })],
    ["bin/interpreter", "#!/bin/sh\necho interpreter\n"],
    ["bin/codex-code-mode-host", "#!/bin/sh\necho host\n"],
    ["codex-path/rg", "#!/bin/sh\necho rg\n"],
    ["codex-resources/zsh/bin/zsh", "#!/bin/sh\necho zsh\n"],
  ]);
  const artifacts = [...artifactBodies].map(([artifactName, body]) => {
    const artifactPath = path.join(rootPath, ...artifactName.split("/"));
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, body, "utf8");
    const executable = artifactName !== "codex-package.json";
    if (executable) fs.chmodSync(artifactPath, 0o755);
    return {
      executable,
      path: artifactName,
      sha256: createHash("sha256").update(body).digest("hex"),
      size: Buffer.byteLength(body),
    };
  });
  fs.writeFileSync(
    path.join(rootPath, "agent-runtime.json"),
    JSON.stringify({
      artifacts,
      codexCompatibilityVersion: "0.144.5",
      entrypoint: "bin/interpreter",
      layoutVersion: 2,
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
      sourceRelease: {
        archiveSha256: "1".repeat(64),
        assetName: "runtime.tar.gz",
        repository: "openinterpreter/openinterpreter",
        tag: "rust-v0.0.34",
      },
      targetArch: "arm64",
      targetPlatform: "darwin",
      targetTriple: "aarch64-apple-darwin",
    }),
    "utf8",
  );
}

function makeBundledRuntimeFixture(): { cleanup: () => void; resourcesPath: string } {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-"));
  writeRuntime(resourcesPath);
  return {
    resourcesPath,
    cleanup: () => fs.rmSync(resourcesPath, { recursive: true, force: true }),
  };
}

function makeStagedRuntimeFixture(): { cleanup: () => void; projectRootPath: string } {
  const projectRootPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-project-"));
  writeRuntime(path.join(projectRootPath, ".generated", "codex-runtime", "agent-runtime"));
  return {
    projectRootPath,
    cleanup: () => fs.rmSync(projectRootPath, { recursive: true, force: true }),
  };
}

describe("codex-runtime", () => {
  test("resolves the bundled Open Interpreter runtime from Electron Resources", () => {
    const fixture = makeBundledRuntimeFixture();
    try {
      const runtime = resolveCodexRuntime({ isPackaged: true, resourcesPath: fixture.resourcesPath });
      expect(runtime.source).toBe("bundled");
      expect(runtime.runtimeFamily).toBe("open-interpreter");
      expect(runtime.binaryPath).toBe(path.join(fixture.resourcesPath, "bin", "interpreter"));
      expect(runtime.additionalSearchPaths).toEqual([
        path.join(fixture.resourcesPath, "codex-path"),
      ]);
      expect(runtime.version).toBe("0.0.34");
      expect(runtime.codexCompatibilityVersion).toBe("0.144.5");
      expect(runtime.rootPath).toBe(fixture.resourcesPath);
      expect(runtime.browserRuntime).toMatchObject({
        reason: "manifest-missing",
        status: "unavailable",
      });
      expect(runtime.missingBinaryMessage).toBe("Bundled agent runtime is missing or corrupted. Reinstall Nodex.");
    } finally {
      fixture.cleanup();
    }
  });

  test("throws before startup when the bundled runtime omits a declared artifact", () => {
    const fixture = makeBundledRuntimeFixture();
    try {
      fs.rmSync(path.join(fixture.resourcesPath, "bin", "codex-code-mode-host"));
      expect(() => resolveCodexRuntime({
        isPackaged: true,
        resourcesPath: fixture.resourcesPath,
      })).toThrow("artifact is missing: bin/codex-code-mode-host");
    } finally {
      fixture.cleanup();
    }
  });

  test("throws before startup when a staged runtime artifact was modified", () => {
    const fixture = makeStagedRuntimeFixture();
    try {
      fs.appendFileSync(path.join(
        fixture.projectRootPath,
        ".generated",
        "codex-runtime",
        "agent-runtime",
        "bin",
        "codex-code-mode-host",
      ), "tampered");
      expect(() => resolveCodexRuntime({
        isPackaged: false,
        projectRootPath: fixture.projectRootPath,
      })).toThrow("artifact size does not match metadata: bin/codex-code-mode-host");
    } finally {
      fixture.cleanup();
    }
  });

  test("throws before startup when the staged runtime omits a search path", () => {
    const fixture = makeStagedRuntimeFixture();
    try {
      fs.rmSync(path.join(
        fixture.projectRootPath,
        ".generated",
        "codex-runtime",
        "agent-runtime",
        "codex-path",
      ), { recursive: true });
      expect(() => resolveCodexRuntime({
        isPackaged: false,
        projectRootPath: fixture.projectRootPath,
      })).toThrow("artifact is missing: codex-path/rg");
    } finally {
      fixture.cleanup();
    }
  });

  test("resolves the staged runtime for unpackaged runs", () => {
    const fixture = makeStagedRuntimeFixture();
    try {
      const runtime = resolveCodexRuntime({
        isPackaged: false,
        projectRootPath: fixture.projectRootPath,
      });
      const runtimeRoot = path.join(fixture.projectRootPath, ".generated", "codex-runtime", "agent-runtime");
      expect(runtime.source).toBe("staged");
      expect(runtime.binaryPath).toBe(path.join(runtimeRoot, "bin", "interpreter"));
      expect(runtime.additionalSearchPaths).toEqual([path.join(runtimeRoot, "codex-path")]);
      expect(runtime.version).toBe("0.0.34");
      expect(runtime.metadataPath).toBe(path.join(runtimeRoot, "agent-runtime.json"));
      expect(runtime.missingBinaryMessage).toBe(
        "Pinned agent runtime is missing or incomplete. Run `pnpm run stage:codex-runtime:mac`.",
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("throws when the staged runtime is missing", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-project-missing-"));
    try {
      expect(() => resolveCodexRuntime({
        isPackaged: false,
        projectRootPath: fixture,
      })).toThrow("Agent runtime is missing or incomplete");
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
