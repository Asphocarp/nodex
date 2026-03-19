import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import { build, mergeConfig, type UserConfig } from "vite";

import landingConfig from "../vite.config";

function readRootPackageVersion(): string {
  const packageJsonPath = resolve(import.meta.dir, "../../../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };

  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error(`Expected a non-empty version in ${packageJsonPath}`);
  }

  return packageJson.version.trim();
}

test("landing build renders the real app version in the release stamp", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "nodex-landing-build-"));
  const rootDir = resolve(import.meta.dir, "..");
  const expectedVersionLabel = `v${readRootPackageVersion()}`;

  try {
    const config = mergeConfig(landingConfig as UserConfig, {
      root: rootDir,
      logLevel: "silent",
      build: {
        outDir: outputDir,
      },
    });

    await build(config);

    const builtIndexHtml = readFileSync(join(outputDir, "index.html"), "utf8");

    expect(builtIndexHtml.includes(expectedVersionLabel)).toBeTrue();
    expect(builtIndexHtml.includes("Latest stable")).toBeFalse();
  } finally {
    rmSync(outputDir, { force: true, recursive: true });
  }
});
