import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { resolveRendererManualChunk } from "./config/renderer-manual-chunks";

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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), ...createSentryPlugins()],
    build: {
      sourcemap: sentrySourcemapSetting,
      rollupOptions: {
        input: {
          bootstrap: resolve(__dirname, "src/main/bootstrap.ts"),
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
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer"),
      },
    },
    plugins: [react(), ...createSentryPlugins()],
    css: {
      postcss: {
        plugins: [
          (await import("@tailwindcss/postcss")).default,
        ],
      },
    },
  },
});
