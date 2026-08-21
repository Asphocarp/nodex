import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

import { renderChangelogHtml } from "./src/changelog-renderer";

function replaceAllText(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function resolveRootPackageVersion(): string {
  const packageJsonPath = resolve(__dirname, "../../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };

  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error(`Expected a non-empty version in ${packageJsonPath}`);
  }

  return packageJson.version.trim();
}

function readRootChangelog(): string {
  const changelogPath = resolve(__dirname, "../../CHANGELOG.md");
  return readFileSync(changelogPath, "utf8");
}

function replaceLandingBuildTokens() {
  const landingVersionLabel = `v${resolveRootPackageVersion()}`;
  const changelogHtml = renderChangelogHtml(readRootChangelog());

  return {
    name: "nodex-landing-build-tokens",
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string) {
        const htmlWithVersion = replaceAllText(
          html,
          "__NODEX_LANDING_VERSION__",
          landingVersionLabel,
        );
        return replaceAllText(htmlWithVersion, "__NODEX_CHANGELOG_HTML__", changelogHtml);
      },
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [tailwindcss(), replaceLandingBuildTokens()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        changelog: resolve(__dirname, "changelog/index.html"),
        privacy: resolve(__dirname, "privacy/index.html"),
        terms: resolve(__dirname, "terms/index.html"),
      },
    },
  },
  preview: {
    host: "127.0.0.1",
  },
});
