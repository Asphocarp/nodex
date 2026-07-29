import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  parseBrowserRuntimeReleaseLock,
  readBrowserRuntimeReleaseLock,
  resolveBrowserRuntimeReleaseLockPath,
} from "./browser-runtime-release-lock";
import {
  readOpenInterpreterReleaseLock,
  resolveOpenInterpreterReleaseLockPath,
} from "./agent-runtime-release-lock";

const HASH = "a".repeat(64);

function makeLock(): Record<string, unknown> {
  const asset = {
    archiveSha256: HASH,
    archiveSize: 123,
    assetName: "browser-runtime.tar.gz",
    manifestSha256: HASH,
    runtimeVersions: {
      codexCli: "0.146.0",
      cuaRuntime: "0.0.6/build",
      node: "24.14.0",
      peerAuthorization: `sha256:${HASH}`,
    },
    url: "https://github.com/example/nodex/releases/download/browser-runtime-v26.727.40816/browser-runtime.tar.gz",
  };
  return {
    assets: {
      "darwin-arm64": asset,
      "darwin-x64": {
        ...asset,
        assetName: "browser-runtime-x64.tar.gz",
        url: "https://github.com/example/nodex/releases/download/browser-runtime-v26.727.40816/browser-runtime-x64.tar.gz",
      },
    },
    browserPluginVersion: "26.727.40816",
    codexCompatibilityVersion: "0.144.5",
    repository: "example/nodex",
    runtimeFamily: "browser",
    schemaVersion: 1,
    source: {
      buildNumber: "6067",
      desktopBuild: "26.727.40816",
      product: "chatgpt-desktop",
    },
    tag: "browser-runtime-v26.727.40816",
  };
}

describe("parseBrowserRuntimeReleaseLock", () => {
  test("accepts an exact dual-architecture release contract", () => {
    const lock = parseBrowserRuntimeReleaseLock(makeLock());

    expect(lock.assets["darwin-arm64"].runtimeVersions.cuaRuntime).toBe(
      "0.0.6/build",
    );
    expect(lock.source.buildNumber).toBe("6067");
  });

  test("rejects locks that silently omit a supported architecture", () => {
    const lock = makeLock();
    delete (lock.assets as Record<string, unknown>)["darwin-x64"];

    expect(() => parseBrowserRuntimeReleaseLock(lock)).toThrow(
      "must contain exactly darwin-arm64 and darwin-x64",
    );
  });

  test("rejects non-HTTPS release assets", () => {
    const lock = makeLock();
    const assets = lock.assets as Record<string, Record<string, unknown>>;
    assets["darwin-arm64"]!.url = "file:///tmp/browser-runtime.tar.gz";

    expect(() => parseBrowserRuntimeReleaseLock(lock)).toThrow(
      "assets.darwin-arm64.url",
    );
  });

  test("keeps the committed Browser and Agent runtime locks compatible", () => {
    const projectRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const browserLockPath = resolveBrowserRuntimeReleaseLockPath(projectRoot);
    expect(fs.existsSync(browserLockPath)).toBe(true);
    const browserLock = readBrowserRuntimeReleaseLock(browserLockPath);
    const agentLock = readOpenInterpreterReleaseLock(
      resolveOpenInterpreterReleaseLockPath(projectRoot),
    );

    expect(browserLock.codexCompatibilityVersion).toBe(
      agentLock.codexCompatibilityVersion,
    );
  });
});
