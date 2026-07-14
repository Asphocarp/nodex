import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexRuntime } from "./codex-runtime";

function writeRuntime(rootPath: string): void {
  fs.mkdirSync(rootPath, { recursive: true });
  const artifactBodies = new Map([
    ["codex", "#!/bin/sh\necho codex\n"],
    ["codex-code-mode-host", "#!/bin/sh\necho host\n"],
  ]);
  const artifacts = [...artifactBodies].map(([artifactName, body]) => {
    const artifactPath = path.join(rootPath, artifactName);
    fs.writeFileSync(artifactPath, body, "utf8");
    fs.chmodSync(artifactPath, 0o755);
    return {
      executable: true,
      path: artifactName,
      sha256: createHash("sha256").update(body).digest("hex"),
      size: Buffer.byteLength(body),
    };
  });
  const rgPath = path.join(rootPath, "rg");
  fs.writeFileSync(rgPath, "#!/bin/sh\necho rg\n", "utf8");
  fs.chmodSync(rgPath, 0o755);
  fs.writeFileSync(
    path.join(rootPath, "runtime.json"),
    JSON.stringify({
      artifacts,
      codexVersion: "0.115.0",
      layoutVersion: 1,
      searchPathTools: ["rg"],
      sourcePackage: "@openai/codex-darwin-arm64@0.115.0-darwin-arm64",
      targetArch: "arm64",
      targetPlatform: "darwin",
      targetTriple: "aarch64-apple-darwin",
    }),
    "utf8",
  );
}

function makeBundledRuntimeFixture(): { cleanup: () => void; resourcesPath: string } {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-runtime-"));
  writeRuntime(path.join(resourcesPath, "bin"));

  return {
    resourcesPath,
    cleanup: () => fs.rmSync(resourcesPath, { recursive: true, force: true }),
  };
}

function makeStagedRuntimeFixture(): { cleanup: () => void; projectRootPath: string } {
  const projectRootPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-project-"));
  writeRuntime(path.join(projectRootPath, ".generated", "codex-runtime", "bin"));

  return {
    projectRootPath,
    cleanup: () => fs.rmSync(projectRootPath, { recursive: true, force: true }),
  };
}

describe("codex-runtime", () => {
  test("resolves the bundled runtime from Electron Resources", () => {
    const fixture = makeBundledRuntimeFixture();

    try {
      const runtime = resolveCodexRuntime({
        isPackaged: true,
        resourcesPath: fixture.resourcesPath,
      });

      expect(runtime.source).toBe("bundled");
      expect(runtime.binaryPath).toBe(path.join(fixture.resourcesPath, "bin", "codex"));
      expect(runtime.additionalSearchPaths[0]).toBe(path.join(fixture.resourcesPath, "bin"));
      expect(runtime.version).toBe("0.115.0");
      expect(runtime.missingBinaryMessage).toBe("Bundled Codex runtime is missing or corrupted. Reinstall Nodex.");
    } finally {
      fixture.cleanup();
    }
  });

  test("throws before startup when the bundled runtime omits the code-mode host", () => {
    const fixture = makeBundledRuntimeFixture();
    let threw = false;

    try {
      fs.rmSync(path.join(fixture.resourcesPath, "bin", "codex-code-mode-host"));
      try {
        resolveCodexRuntime({
          isPackaged: true,
          resourcesPath: fixture.resourcesPath,
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
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
        "bin",
        "codex-code-mode-host",
      ), "tampered");

      expect(() => resolveCodexRuntime({
        isPackaged: false,
        projectRootPath: fixture.projectRootPath,
      })).toThrow("artifact size does not match metadata: codex-code-mode-host");
    } finally {
      fixture.cleanup();
    }
  });

  test("throws before startup when the staged runtime omits a search-path tool", () => {
    const fixture = makeStagedRuntimeFixture();

    try {
      fs.rmSync(path.join(
        fixture.projectRootPath,
        ".generated",
        "codex-runtime",
        "bin",
        "rg",
      ));

      expect(() => resolveCodexRuntime({
        isPackaged: false,
        projectRootPath: fixture.projectRootPath,
      })).toThrow("search-path tool is missing: rg");
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

      expect(runtime.source).toBe("staged");
      expect(runtime.binaryPath).toBe(path.join(fixture.projectRootPath, ".generated", "codex-runtime", "bin", "codex"));
      expect(runtime.additionalSearchPaths[0]).toBe(path.join(fixture.projectRootPath, ".generated", "codex-runtime", "bin"));
      expect(runtime.version).toBe("0.115.0");
      expect(runtime.metadataPath).toBe(path.join(fixture.projectRootPath, ".generated", "codex-runtime", "bin", "runtime.json"));
      expect(runtime.missingBinaryMessage).toBe("Pinned Codex runtime is missing or incomplete. Run `pnpm run stage:codex-runtime:mac`.");
    } finally {
      fixture.cleanup();
    }
  });

  test("throws when the staged runtime is missing", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-project-missing-"));
    let threw = false;

    try {
      try {
        resolveCodexRuntime({
          isPackaged: false,
          projectRootPath: fixture,
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
