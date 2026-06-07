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
    const builtChangelogHtml = readFileSync(join(outputDir, "changelog/index.html"), "utf8");

    expect(builtIndexHtml.includes(expectedVersionLabel)).toBeTrue();
    expect(builtIndexHtml.includes("Latest stable")).toBeFalse();
    expect(builtChangelogHtml.includes("<h1>Changelog</h1>")).toBeTrue();
    expect(builtChangelogHtml.includes("<h2>Unreleased</h2>")).toBeTrue();
    expect(builtChangelogHtml.includes("<p>In development</p>")).toBeTrue();
    expect(builtChangelogHtml.includes("Codex-style project session shell")).toBeTrue();
    expect(builtChangelogHtml.includes("__NODEX_CHANGELOG_HTML__")).toBeFalse();
  } finally {
    rmSync(outputDir, { force: true, recursive: true });
  }
});
