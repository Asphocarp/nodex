import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import type { Rollup } from "vite";
import { resolveRendererManualChunk } from "./config/renderer-manual-chunks";
import {
  createRendererVitePlugins,
  rendererViteCss,
  rendererViteResolve,
} from "./config/renderer-vite-shared";

function hasSentrySourceMapUploadConfig(): boolean {
  return Boolean(
    process.env.SENTRY_AUTH_TOKEN?.trim()
      && process.env.SENTRY_ORG?.trim()
      && process.env.SENTRY_PROJECT?.trim(),
  );
}

function shouldEmitSentrySourceMaps(): boolean {
  return Boolean(process.env.SENTRY_RELEASE?.trim() || hasSentrySourceMapUploadConfig());
}

function createSentryPlugins() {
  if (!hasSentrySourceMapUploadConfig()) return [];

  return sentryVitePlugin({
    release: {
      name: process.env.SENTRY_RELEASE?.trim() || undefined,
    },
    sourcemaps: {
      filesToDeleteAfterUpload: "out/**/*.map",
    },
    telemetry: false,
  });
}

const sentrySourcemapSetting = shouldEmitSentrySourceMaps() ? "hidden" : false;

function isKnownYProsemirrorAwarenessTypeImportWarning(
  warning: Rollup.RollupLog,
): boolean {
  const importer = warning.ids?.[0]?.replaceAll("\\", "/");

  return warning.code === "UNUSED_EXTERNAL_IMPORT"
    && warning.exporter === "y-protocols/awareness"
    && warning.names?.length === 1
    && warning.names[0] === "Awareness"
    && warning.ids?.length === 1
    && importer?.endsWith(
      "/node_modules/y-prosemirror/src/plugins/cursor-plugin.js",
    ) === true;
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), ...createSentryPlugins()],
    build: {
      sourcemap: sentrySourcemapSetting,
      rollupOptions: {
        input: {
          bootstrap: resolve(__dirname, "src/main/bootstrap.ts"),
          "git-worker": resolve(__dirname, "src/main/git-worker/entry.ts"),
        },
        onwarn(warning, defaultHandler) {
          if (isKnownYProsemirrorAwarenessTypeImportWarning(warning)) return;
          defaultHandler(warning);
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "[name]-[hash].js",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), ...createSentryPlugins()],
    build: {
      sourcemap: sentrySourcemapSetting,
      rollupOptions: {
        input: {
          "browser-guest": resolve(__dirname, "src/preload/browser-guest.ts"),
          index: resolve(__dirname, "src/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    server: {
      port: 51284,
    },
    root: resolve(__dirname, "src/renderer"),
    build: {
      sourcemap: sentrySourcemapSetting,
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
        },
        output: {
          manualChunks(id) {
            return resolveRendererManualChunk(id);
          },
        },
      },
    },
    resolve: rendererViteResolve,
    plugins: [...createRendererVitePlugins(), ...createSentryPlugins()],
    css: rendererViteCss,
  },
});
