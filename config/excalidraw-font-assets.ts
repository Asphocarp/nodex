import { readFile, readFileSync, readdirSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin as EsbuildPlugin } from "esbuild";
import type { Plugin } from "vite";

const EXCALIDRAW_FONT_REQUEST_PREFIX = "/excalidraw-assets/fonts/";
const EXCALIDRAW_FONT_OUTPUT_PREFIX = "excalidraw-assets/fonts";
const EXCALIDRAW_DISTRIBUTION_PATH = "/@excalidraw/excalidraw/dist/";
const EXCALIDRAW_DISTRIBUTION_FILE_PATTERN = /[/\\]@excalidraw[/\\]excalidraw[/\\]dist[/\\].*\.js$/;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE_FONT_FALLBACK_APPEND_PATTERN =
  /([A-Za-z_$][\w$]*)\.push\(new URL\([A-Za-z_$][\w$]*,\s*[A-Za-z_$][\w$]*\.ASSETS_FALLBACK_URL\)\)/g;

function removeConfiguredRemoteFontFallback(source: string): {
  code: string;
  replacementCount: number;
} {
  let replacementCount = 0;
  const code = source.replace(
    REMOTE_FONT_FALLBACK_APPEND_PATTERN,
    (appendExpression, urlsVariable: string) => {
      replacementCount += 1;
      return `${urlsVariable}.length === 0 && ${appendExpression}`;
    },
  );

  return { code, replacementCount };
}

function transformExcalidrawFontModule(source: string, id: string): string | null {
  const normalizedId = id.replaceAll("\\", "/");
  if (!normalizedId.includes(EXCALIDRAW_DISTRIBUTION_PATH)) return null;
  if (!source.includes("ASSETS_FALLBACK_URL")) return null;
  if (!source.includes("EXCALIDRAW_ASSET_PATH")) return null;

  const transformed = removeConfiguredRemoteFontFallback(source);
  if (transformed.replacementCount !== 1) {
    throw new Error(
      "Expected exactly one Excalidraw remote font fallback append; " +
        `found ${transformed.replacementCount}.`,
    );
  }
  return transformed.code;
}

/**
 * Keep Excalidraw inside Vite's dependency prebundle so its nested CommonJS
 * packages receive esbuild interop. The optimizer does not run normal Vite
 * transform hooks, so apply the offline-font rewrite at that boundary too.
 */
export function createExcalidrawDependencyOptimizerPlugin(): EsbuildPlugin {
  return {
    name: "nodex:excalidraw-font-assets:optimizer",
    setup(build) {
      build.onLoad({ filter: EXCALIDRAW_DISTRIBUTION_FILE_PATTERN }, async (args) => {
        const source = await readFileAsync(args.path, "utf8");
        const code = transformExcalidrawFontModule(source, args.path);
        if (code === null) return undefined;
        return { contents: code, loader: "js" };
      });
    },
  };
}

function listFilesRecursively(rootDirectory: string): string[] {
  return readdirSync(rootDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = resolve(rootDirectory, entry.name);
      if (entry.isDirectory()) return listFilesRecursively(absolutePath);
      if (!entry.isFile()) return [];
      return [absolutePath];
    })
    .sort();
}

type FontRequest =
  | { kind: "unhandled" }
  | { kind: "invalid" }
  | { kind: "file"; absolutePath: string };

function resolveFontRequest(fontRoot: string, requestUrl: string | undefined): FontRequest {
  if (!requestUrl) return { kind: "unhandled" };

  const pathname = new URL(requestUrl, "http://nodex.local").pathname;
  if (!pathname.startsWith(EXCALIDRAW_FONT_REQUEST_PREFIX)) {
    return { kind: "unhandled" };
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice(EXCALIDRAW_FONT_REQUEST_PREFIX.length));
  } catch {
    return { kind: "invalid" };
  }

  if (!relativePath || relativePath.includes("\0")) return { kind: "invalid" };
  const absolutePath = resolve(fontRoot, relativePath);
  const fontRootPrefix = `${fontRoot}${sep}`;
  if (!absolutePath.startsWith(fontRootPrefix)) return { kind: "invalid" };
  return { kind: "file", absolutePath };
}

/**
 * Excalidraw resolves unicode font shards at runtime instead of importing them
 * through Vite. Emit the dependency's complete font tree with stable paths and
 * serve that same tree in development. Excalidraw otherwise appends its CDN to
 * every configured FontFace source; Chromium performs CSP validation for that
 * unused fallback even after the local source succeeds. Keep the CDN only for
 * hosts that did not explicitly configure an asset root.
 */
export function createExcalidrawFontAssetPlugins(): Plugin[] {
  const fontRoot = resolve(REPOSITORY_ROOT, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");

  const transformPlugin: Plugin = {
    name: "nodex:excalidraw-font-assets:transform",
    enforce: "pre",
    transform(source, id) {
      try {
        const code = transformExcalidrawFontModule(source, id);
        if (code === null) return null;
        return { code, map: null };
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    },
  };
  const servePlugin: Plugin = {
    name: "nodex:excalidraw-font-assets:serve",
    apply: "serve",
    enforce: "pre",
    config() {
      return {
        optimizeDeps: {
          esbuildOptions: {
            target: "es2022",
            treeShaking: true,
            plugins: [createExcalidrawDependencyOptimizerPlugin()],
          },
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const fontRequest = resolveFontRequest(fontRoot, request.url);
        if (fontRequest.kind === "unhandled") {
          next();
          return;
        }
        if (fontRequest.kind === "invalid") {
          response.statusCode = 404;
          response.end();
          return;
        }

        readFile(fontRequest.absolutePath, (error, source) => {
          if (error) {
            response.statusCode = 404;
            response.end();
            return;
          }

          response.statusCode = 200;
          response.setHeader("Content-Type", "font/woff2");
          response.setHeader("Cache-Control", "no-cache");
          response.end(source);
        });
      });
    },
  };
  const buildPlugin: Plugin = {
    name: "nodex:excalidraw-font-assets:build",
    apply: "build",
    buildStart() {
      for (const absolutePath of listFilesRecursively(fontRoot)) {
        const relativePath = relative(fontRoot, absolutePath).split(sep).join("/");
        this.emitFile({
          type: "asset",
          fileName: `${EXCALIDRAW_FONT_OUTPUT_PREFIX}/${relativePath}`,
          source: readFileSync(absolutePath),
        });
      }
    },
  };

  return [transformPlugin, servePlugin, buildPlugin];
}
