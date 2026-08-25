import { isAbsolute, resolve, sep } from "node:path";
import { describe, expect, test } from "vitest";
import {
  resolveBundledElectronPreload,
  type BundledElectronPreload,
} from "./electron-preload-path";

const preloads: readonly BundledElectronPreload[] = [
  "browser-guest.js",
  "global-dictation.js",
  "index.js",
  "mcp-app-sandbox-guest.js",
];

describe("resolveBundledElectronPreload", () => {
  test.each(preloads)("returns a canonical absolute path for %s", (preload) => {
    const path = resolveBundledElectronPreload(resolve("out/main"), preload);

    expect(path).toBe(resolve("out/preload", preload));
    expect(isAbsolute(path)).toBe(true);
    expect(path.split(sep)).not.toContain("..");
  });
});
