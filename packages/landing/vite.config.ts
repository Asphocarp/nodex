import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

function resolveRootPackageVersion(): string {
  const packageJsonPath = resolve(__dirname, "../../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };

  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error(`Expected a non-empty version in ${packageJsonPath}`);
  }

  return packageJson.version.trim();
}

function replaceLandingVersionToken() {
  const landingVersionLabel = `v${resolveRootPackageVersion()}`;

  return {
    name: "nodex-landing-version-token",
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string) {
        return html.replaceAll("__NODEX_LANDING_VERSION__", landingVersionLabel);
      },
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [tailwindcss(), replaceLandingVersionToken()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        privacy: resolve(__dirname, "privacy/index.html"),
        terms: resolve(__dirname, "terms/index.html"),
      },
    },
  },
  preview: {
    host: "127.0.0.1",
  },
});
