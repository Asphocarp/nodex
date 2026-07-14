import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexRuntimeTarget, stageCodexRuntime } from "./stage-codex-runtime";

function makeFakeCodexPackage(
  targetTriple: string,
  version: string,
): { cleanup: () => void; packageRoot: string } {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-codex-runtime-"));
  const vendorRoot = path.join(packageRoot, "vendor", targetTriple);
  const binRoot = path.join(vendorRoot, "bin");
  const rgPath = path.join(vendorRoot, "codex-path", "rg");

  fs.mkdirSync(binRoot, { recursive: true });
  fs.mkdirSync(path.dirname(rgPath), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version }), "utf8");
  for (const [name, body] of [
    ["codex", "#!/bin/sh\necho codex\n"],
    ["codex-code-mode-host", "#!/bin/sh\necho host\n"],
    ["future-helper", "#!/bin/sh\necho future\n"],
  ] as const) {
    const artifactPath = path.join(binRoot, name);
    fs.writeFileSync(artifactPath, body, "utf8");
    fs.chmodSync(artifactPath, 0o755);
  }
  fs.writeFileSync(rgPath, "#!/bin/sh\necho rg\n", "utf8");
  fs.chmodSync(rgPath, 0o755);

  return {
    packageRoot,
    cleanup: () => fs.rmSync(packageRoot, { recursive: true, force: true }),
  };
}

describe("stage-codex-runtime", () => {
  test("resolves the pinned darwin target metadata", () => {
    const target = resolveCodexRuntimeTarget("darwin", "arm64");

    expect(target.packageName).toBe("@openai/codex-darwin-arm64");
    expect(target.targetTriple).toBe("aarch64-apple-darwin");
  });

  test("stages the complete native bin closure, rg, and integrity metadata", () => {
    const fakePackage = makeFakeCodexPackage("aarch64-apple-darwin", "0.137.0-darwin-arm64");
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-codex-runtime-out-"));
    const outputPath = path.join(outputRoot, "codex-runtime");

    try {
      fs.mkdirSync(outputPath, { recursive: true });
      fs.writeFileSync(path.join(outputPath, "stale.txt"), "stale", "utf8");

      const metadata = stageCodexRuntime({
        targetPlatform: "darwin",
        targetArch: "arm64",
        outputPath,
        packageRoot: fakePackage.packageRoot,
      });

      expect(metadata.codexVersion).toBe("0.137.0");
      expect(metadata.targetTriple).toBe("aarch64-apple-darwin");
      expect(fs.existsSync(path.join(outputPath, "bin", "codex"))).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "bin", "codex-code-mode-host"))).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "bin", "future-helper"))).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "bin", "rg"))).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "bin", "runtime.json"))).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "stale.txt"))).toBe(false);

      const writtenMetadata = JSON.parse(
        fs.readFileSync(path.join(outputPath, "bin", "runtime.json"), "utf8"),
      ) as {
        artifacts?: Array<{ executable?: boolean; path?: string; sha256?: string; size?: number }>;
        layoutVersion?: number;
        searchPathTools?: string[];
        sourcePackage?: string;
      };

      expect(writtenMetadata.layoutVersion).toBe(1);
      expect(writtenMetadata.sourcePackage).toBe("@openai/codex-darwin-arm64@0.137.0-darwin-arm64");
      expect(writtenMetadata.artifacts?.map((artifact) => artifact.path)).toEqual([
        "codex",
        "codex-code-mode-host",
        "future-helper",
      ]);
      expect(writtenMetadata.searchPathTools).toEqual(["rg"]);
      expect(writtenMetadata.artifacts?.every((artifact) => (
        artifact.executable === true
        && typeof artifact.sha256 === "string"
        && artifact.sha256.length === 64
        && typeof artifact.size === "number"
        && artifact.size > 0
      ))).toBe(true);
    } finally {
      fakePackage.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("rejects a package whose native bin closure omits the code-mode host", () => {
    const fakePackage = makeFakeCodexPackage("aarch64-apple-darwin", "0.137.0-darwin-arm64");
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-codex-runtime-out-"));
    const outputPath = path.join(outputRoot, "codex-runtime");

    try {
      fs.rmSync(path.join(
        fakePackage.packageRoot,
        "vendor",
        "aarch64-apple-darwin",
        "bin",
        "codex-code-mode-host",
      ));
      expect(() => stageCodexRuntime({
        targetPlatform: "darwin",
        targetArch: "arm64",
        outputPath,
        packageRoot: fakePackage.packageRoot,
      })).toThrow("missing required executable codex-code-mode-host");
      expect(fs.readdirSync(outputRoot)).toEqual([]);
    } finally {
      fakePackage.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
