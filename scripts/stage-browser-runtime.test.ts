import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  BROWSER_PLUGIN_NODE_MODULE_DIR,
  BROWSER_RUNTIME_BUNDLE_DIRECTORY,
  BROWSER_RUNTIME_MANIFEST_FILENAME,
} from "../src/shared/browser-runtime-metadata";
import { writeBrowserRuntimeFixture } from "../src/main/codex/browser-runtime-test-fixture";
import { resolveBrowserRuntimeBundle } from "../src/main/codex/browser-runtime-bundle";
import { stageBrowserRuntime } from "./stage-browser-runtime";

const temporaryRoots: string[] = [];

function makeRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("stageBrowserRuntime", () => {
  test("atomically installs a source closure that passes runtime verification", () => {
    const sourceRoot = makeRoot("nodex-browser-source-");
    const runtimeRoot = makeRoot("nodex-browser-destination-");
    writeBrowserRuntimeFixture(sourceRoot);
    const previousRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
    fs.mkdirSync(previousRoot);
    fs.writeFileSync(path.join(previousRoot, "stale"), "stale");

    stageBrowserRuntime({
      expectedCodexCompatibilityVersion: "0.144.6",
      runtimeRoot,
      sourceRoot,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });

    expect(fs.existsSync(path.join(previousRoot, "stale"))).toBe(false);
    expect(
      resolveBrowserRuntimeBundle({
        expectedCodexCompatibilityVersion: "0.144.6",
        runtimeRoot,
        targetArch: "arm64",
        targetPlatform: "darwin",
      }).status,
    ).toBe("available");
  });

  test("installs a closure for an Agent version inside its sealed protocol window", () => {
    const sourceRoot = makeRoot("nodex-browser-source-");
    const runtimeRoot = makeRoot("nodex-browser-destination-");
    writeBrowserRuntimeFixture(sourceRoot, {
      codexCliVersion: "0.146.0-alpha.9",
      codexCompatibilityVersion: "0.144.5",
    });

    stageBrowserRuntime({
      expectedCodexCompatibilityVersion: "0.144.6",
      runtimeRoot,
      sourceRoot,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });

    expect(
      resolveBrowserRuntimeBundle({
        expectedCodexCompatibilityVersion: "0.144.6",
        runtimeRoot,
        targetArch: "arm64",
        targetPlatform: "darwin",
      }).status,
    ).toBe("available");
  });

  test("normalizes legacy Browser plugin module paths during staging", () => {
    const sourceRoot = makeRoot("nodex-browser-source-");
    const runtimeRoot = makeRoot("nodex-browser-destination-");
    writeBrowserRuntimeFixture(sourceRoot);
    const manifestPath = path.join(sourceRoot, BROWSER_RUNTIME_MANIFEST_FILENAME);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      browserPlugin: { nodeModuleDirs: string[] };
    };
    manifest.browserPlugin.nodeModuleDirs = manifest.browserPlugin.nodeModuleDirs.map(
      (directory) =>
        directory === BROWSER_PLUGIN_NODE_MODULE_DIR
          ? "marketplace/plugins/browser/scripts/node_modules"
          : directory,
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const stagedManifest = stageBrowserRuntime({
      expectedCodexCompatibilityVersion: "0.144.6",
      runtimeRoot,
      sourceRoot,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });

    expect(stagedManifest.browserPlugin.nodeModuleDirs).toContain(BROWSER_PLUGIN_NODE_MODULE_DIR);
    expect(stagedManifest.browserPlugin.nodeModuleDirs).not.toContain(
      "marketplace/plugins/browser/scripts/node_modules",
    );
    const activeRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
    const activeRootInode = fs.statSync(activeRoot).ino;

    stageBrowserRuntime({
      expectedCodexCompatibilityVersion: "0.144.6",
      runtimeRoot,
      sourceRoot,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });

    expect(
      resolveBrowserRuntimeBundle({
        expectedCodexCompatibilityVersion: "0.144.6",
        runtimeRoot,
        targetArch: "arm64",
        targetPlatform: "darwin",
      }).status,
    ).toBe("available");
    expect(fs.statSync(activeRoot).ino).toBe(activeRootInode);
  });

  test("preserves the previously active bundle when source verification fails", () => {
    const sourceRoot = makeRoot("nodex-browser-source-");
    const runtimeRoot = makeRoot("nodex-browser-destination-");
    writeBrowserRuntimeFixture(sourceRoot);
    fs.appendFileSync(
      path.join(sourceRoot, "marketplace", "plugins", "browser", "client.js"),
      "tampered",
    );
    const activeRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
    fs.mkdirSync(activeRoot);
    fs.writeFileSync(path.join(activeRoot, "preserved"), "active");

    expect(() =>
      stageBrowserRuntime({
        expectedCodexCompatibilityVersion: "0.144.6",
        runtimeRoot,
        sourceRoot,
        targetArch: "arm64",
        targetPlatform: "darwin",
      }),
    ).toThrow("does not match its manifest");
    expect(fs.readFileSync(path.join(activeRoot, "preserved"), "utf8")).toBe("active");
  });

  test("rejects undeclared payloads instead of silently expanding trust", () => {
    const sourceRoot = makeRoot("nodex-browser-source-");
    writeBrowserRuntimeFixture(sourceRoot);
    fs.writeFileSync(path.join(sourceRoot, "undeclared.js"), "payload");

    expect(() =>
      stageBrowserRuntime({
        expectedCodexCompatibilityVersion: "0.144.6",
        runtimeRoot: makeRoot("nodex-browser-destination-"),
        sourceRoot,
        targetArch: "arm64",
        targetPlatform: "darwin",
      }),
    ).toThrow("exactly the manifest-declared artifacts");
  });

  test("repairs an otherwise reusable active closure with an undeclared payload", () => {
    const sourceRoot = makeRoot("nodex-browser-source-");
    const runtimeRoot = makeRoot("nodex-browser-destination-");
    writeBrowserRuntimeFixture(sourceRoot);
    const options = {
      expectedCodexCompatibilityVersion: "0.144.6",
      runtimeRoot,
      sourceRoot,
      targetArch: "arm64" as const,
      targetPlatform: "darwin" as const,
    };
    stageBrowserRuntime(options);
    const undeclaredPath = path.join(
      runtimeRoot,
      BROWSER_RUNTIME_BUNDLE_DIRECTORY,
      "undeclared.js",
    );
    fs.writeFileSync(undeclaredPath, "payload");

    stageBrowserRuntime(options);

    expect(fs.existsSync(undeclaredPath)).toBe(false);
  });

  test("keeps the active bundle when platform verification rejects a staged native artifact", () => {
    const sourceRoot = makeRoot("nodex-browser-source-");
    const runtimeRoot = makeRoot("nodex-browser-destination-");
    writeBrowserRuntimeFixture(sourceRoot);
    const activeRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
    fs.mkdirSync(activeRoot);
    fs.writeFileSync(path.join(activeRoot, "preserved"), "active");

    expect(() =>
      stageBrowserRuntime({
        expectedCodexCompatibilityVersion: "0.144.6",
        platformArtifactVerifier: ({ artifact }) =>
          artifact.kind === "native-addon" ? "Node-API ABI mismatch" : null,
        runtimeRoot,
        sourceRoot,
        targetArch: "arm64",
        targetPlatform: "darwin",
      }),
    ).toThrow("Node-API ABI mismatch");
    expect(fs.readFileSync(path.join(activeRoot, "preserved"), "utf8")).toBe("active");
  });
});
