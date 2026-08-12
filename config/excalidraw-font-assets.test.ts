import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { afterEach, describe, expect, test } from "vitest";
import {
  build as viteBuild,
  createLogger,
  createServer as createViteServer,
  resolveConfig,
  type Logger,
  type Plugin,
  type Rollup,
  type ViteDevServer,
} from "vite";
import { createExcalidrawFontAssetPlugins } from "./excalidraw-font-assets";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excalidrawRuntimeEntry = resolve(
  repositoryRoot,
  "node_modules/@excalidraw/excalidraw/dist/dev/index.js",
);
const representativeFontPath = "Assistant/Assistant-Regular.woff2";

const virtualEntryPlugin: Plugin = {
  name: "test:virtual-entry",
  resolveId(id) {
    return id === "virtual:test-entry" ? `\0${id}` : null;
  },
  load(id) {
    return id === "\0virtual:test-entry" ? "export default true;" : null;
  },
};

const listen = (server: ReturnType<typeof createHttpServer>): Promise<number> =>
  new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test HTTP server has no TCP address"));
        return;
      }
      resolveListen(address.port);
    });
  });

const closeHttpServer = (
  server: ReturnType<typeof createHttpServer>,
): Promise<void> =>
  new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });

describe("createExcalidrawFontAssetPlugins", () => {
  let viteServer: ViteDevServer | undefined;
  let httpServer: ReturnType<typeof createHttpServer> | undefined;

  afterEach(async () => {
    await viteServer?.close();
    if (httpServer?.listening) await closeHttpServer(httpServer);
    viteServer = undefined;
    httpServer = undefined;
  });

  test("keeps Excalidraw prebundled with nested CommonJS interop", async () => {
    const config = await resolveConfig(
      {
        configFile: false,
        plugins: createExcalidrawFontAssetPlugins(),
      },
      "serve",
    );
    const optimizerPlugins = config.optimizeDeps.esbuildOptions?.plugins ?? [];

    expect(config.optimizeDeps.exclude).not.toContain("@excalidraw/excalidraw");
    expect(optimizerPlugins.map((plugin) => plugin.name)).toContain(
      "nodex:excalidraw-font-assets:optimizer",
    );

    const result = await esbuild({
      entryPoints: [excalidrawRuntimeEntry],
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      plugins: optimizerPlugins,
      target: "es2022",
      treeShaking: true,
      write: false,
    });

    expect(
      Object.keys(result.metafile.inputs).some((input) =>
        input.includes("es6-promise-pool"),
      ),
    ).toBe(true);
    expect(result.outputFiles[0]?.text).toContain(
      "urls.length === 0 && urls.push(new URL",
    );
  });

  test("serves fonts without installing build-only hooks in development", async () => {
    const warnings: string[] = [];
    const logger: Logger = createLogger("info", { allowClearScreen: false });
    logger.warn = (message) => warnings.push(message);
    logger.warnOnce = (message) => warnings.push(message);

    viteServer = await createViteServer({
      configFile: false,
      customLogger: logger,
      plugins: createExcalidrawFontAssetPlugins(),
      server: { middlewareMode: true },
    });
    httpServer = createHttpServer(viteServer.middlewares);
    const port = await listen(httpServer);
    const response = await fetch(
      `http://127.0.0.1:${port}/excalidraw-assets/fonts/${representativeFontPath}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/woff2");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    const missing = await fetch(
      `http://127.0.0.1:${port}/excalidraw-assets/fonts/missing.woff2`,
    );
    const traversal = await fetch(
      `http://127.0.0.1:${port}/excalidraw-assets/fonts/%2e%2e%2fpackage.json`,
    );
    expect(missing.status).toBe(404);
    expect(traversal.status).toBe(404);
    expect(
      warnings.filter((warning) => warning.includes("emitFile() is not supported")),
    ).toEqual([]);
  });

  test("emits the complete font tree in build mode", async () => {
    const result = await viteBuild({
      build: {
        rollupOptions: { input: "virtual:test-entry" },
        write: false,
      },
      configFile: false,
      logLevel: "silent",
      plugins: [...createExcalidrawFontAssetPlugins(), virtualEntryPlugin],
    });
    const outputs: Rollup.Output[] = (Array.isArray(result) ? result : [result])
      .flatMap((entry) => entry.output);
    const fileNames = outputs.map((output) => output.fileName);

    expect(fileNames).toContain(
      `excalidraw-assets/fonts/${representativeFontPath}`,
    );
    expect(
      fileNames.filter((fileName) =>
        fileName.startsWith("excalidraw-assets/fonts/"),
      ).length,
    ).toBeGreaterThan(200);
  });
});
