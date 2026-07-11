import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexRuntimeTarget, stageCodexRuntime } from "./stage-codex-runtime";

function makeFakeCodexPackage(
  targetTriple: string,
  version: string,
  layout: "legacy" | "current" = "legacy",
): { cleanup: () => void; packageRoot: string } {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-codex-runtime-"));
  const vendorRoot = path.join(packageRoot, "vendor", targetTriple);
  const codexRelativePath = layout === "current" ? path.join("bin", "codex") : path.join("codex", "codex");
  const rgRelativePath = layout === "current" ? path.join("codex-path", "rg") : path.join("path", "rg");

  fs.mkdirSync(path.dirname(path.join(vendorRoot, codexRelativePath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(vendorRoot, rgRelativePath)), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version }), "utf8");
  fs.writeFileSync(path.join(vendorRoot, codexRelativePath), "#!/bin/sh\necho codex\n", "utf8");
  fs.writeFileSync(path.join(vendorRoot, rgRelativePath), "#!/bin/sh\necho rg\n", "utf8");

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

  test("stages codex, rg, and runtime metadata from the current package layout", () => {
    const fakePackage = makeFakeCodexPackage("aarch64-apple-darwin", "0.137.0-darwin-arm64", "current");
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
      expect(fs.existsSync(path.join(outputPath, "bin", "rg"))).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "bin", "runtime.json"))).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "stale.txt"))).toBe(false);

      const writtenMetadata = JSON.parse(
        fs.readFileSync(path.join(outputPath, "bin", "runtime.json"), "utf8"),
      ) as { sourcePackage?: string; binarySha256?: string; rgSha256?: string };

      expect(writtenMetadata.sourcePackage).toBe("@openai/codex-darwin-arm64@0.137.0-darwin-arm64");
      expect(typeof writtenMetadata.binarySha256 === "string" && writtenMetadata.binarySha256.length > 0).toBe(true);
      expect(typeof writtenMetadata.rgSha256 === "string" && writtenMetadata.rgSha256.length > 0).toBe(true);
    } finally {
      fakePackage.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("stages codex and rg from the legacy package layout", () => {
    const fakePackage = makeFakeCodexPackage("aarch64-apple-darwin", "0.115.0-darwin-arm64");
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-stage-codex-runtime-out-"));
    const outputPath = path.join(outputRoot, "codex-runtime");

    try {
      const metadata = stageCodexRuntime({
        targetPlatform: "darwin",
        targetArch: "arm64",
        outputPath,
        packageRoot: fakePackage.packageRoot,
      });

      expect(metadata.codexVersion).toBe("0.115.0");
      expect(fs.existsSync(path.join(outputPath, "bin", "codex"))).toBe(true);
      expect(fs.existsSync(path.join(outputPath, "bin", "rg"))).toBe(true);
    } finally {
      fakePackage.cleanup();
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
