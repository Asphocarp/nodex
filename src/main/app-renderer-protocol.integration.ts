import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { _electron as electron, type ElectronApplication } from "playwright";
import { afterEach, describe, expect, test } from "vitest";
import { APP_RENDERER_URL } from "../shared/app-renderer-policy";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("production app renderer origin", () => {
  test("loads as a secure context with Web Crypto", async () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), "nodex-app-origin-integration-"));
    temporaryDirectories.push(outputDirectory);
    await build({
      bundle: true,
      entryPoints: {
        main: path.resolve("tests/fixtures/app-renderer-protocol/electron-main.ts"),
      },
      external: ["electron"],
      format: "cjs",
      outdir: outputDirectory,
      platform: "node",
      target: "node24",
    });
    const rendererDirectory = path.join(outputDirectory, "renderer");
    mkdirSync(rendererDirectory);
    writeFileSync(
      path.join(rendererDirectory, "index.html"),
      "<!doctype html><html><head><title>Nodex secure origin</title></head><body></body></html>",
    );

    const childEnvironment: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (value !== undefined) childEnvironment[name] = value;
    }
    delete childEnvironment.ELECTRON_RUN_AS_NODE;
    let application: ElectronApplication | null = null;
    try {
      application = await electron.launch({
        args: [path.join(outputDirectory, "main.js")],
        env: childEnvironment,
      });
      const page = await application.firstWindow();
      await expect.poll(() => page.url()).toBe(APP_RENDERER_URL);
      await expect(
        page.evaluate(() => ({
          origin: location.origin,
          randomUuidType: typeof crypto.randomUUID,
          secure: isSecureContext,
          subtleType: typeof crypto.subtle,
        })),
      ).resolves.toEqual({
        origin: "app://-",
        randomUuidType: "function",
        secure: true,
        subtleType: "object",
      });
    } finally {
      if (application) await application.close();
    }
  }, 30_000);
});
