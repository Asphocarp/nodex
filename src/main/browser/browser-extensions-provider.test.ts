import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BrowserExtensionsProvider } from "./browser-extensions-provider";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("BrowserExtensionsProvider", () => {
  test("lists and loads unpacked extensions through Electron's public API", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-extension-"));
    roots.push(root);
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "Example",
        version: "1.0.0",
      }),
    );
    const loadExtension = vi.fn(async () => ({
      id: "extension-id",
      name: "Example",
      path: root,
      url: "chrome-extension://extension-id/",
      manifest: { version: "1.0.0" },
    }));
    const provider = new BrowserExtensionsProvider({
      getAllExtensions: () => [],
      loadExtension,
      removeExtension: vi.fn(),
    });

    expect(provider.capability().available).toBe(true);
    expect(await provider.load(root)).toMatchObject({
      id: "extension-id",
      version: "1.0.0",
    });
    expect(loadExtension).toHaveBeenCalledWith(root, {
      allowFileAccess: false,
    });
  });

  test("reports an explicit unavailable capability", () => {
    expect(new BrowserExtensionsProvider(null).snapshot()).toMatchObject({
      capability: {
        available: false,
        provider: "unavailable",
      },
      extensions: [],
    });
  });
});
