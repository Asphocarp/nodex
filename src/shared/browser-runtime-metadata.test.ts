import { describe, expect, test } from "vitest";
import {
  parseBrowserRuntimeManifest,
  type BrowserRuntimeManifest,
} from "./browser-runtime-metadata";

const HASH = "a".repeat(64);

function makeManifest(): BrowserRuntimeManifest {
  return {
    artifacts: [
      {
        architecture: "arm64",
        executable: true,
        kind: "executable",
        path: "bin/codex",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "arm64",
        executable: true,
        kind: "executable",
        path: "bin/node",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "arm64",
        executable: true,
        kind: "executable",
        path: "bin/node_repl",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "arm64",
        executable: false,
        kind: "native-addon",
        path: "peer/authorize.node",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "marketplace/plugins/browser/manifest.json",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "marketplace/plugins/browser/client.js",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "marketplace/plugins/browser/docs/SKILL.md",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "marketplace/.agents/plugins/marketplace.json",
        sha256: HASH,
        size: 1,
      },
    ],
    browserPlugin: {
      client: "marketplace/plugins/browser/client.js",
      docs: "marketplace/plugins/browser/docs/SKILL.md",
      id: "browser@openai-bundled",
      manifest: "marketplace/plugins/browser/manifest.json",
      marketplaceManifest: "marketplace/.agents/plugins/marketplace.json",
      marketplaceRoot: "marketplace",
      nodeModuleDirs: ["runtime/lib/node_modules"],
      root: "marketplace/plugins/browser",
      version: "1.0.0",
    },
    buildFlavor: "test",
    codexCompatibilityVersion: "0.144.6",
    contractVersion: 1,
    desktopBuild: "test-build",
    desktopBuildNumber: "123",
    entrypoints: {
      codexCli: "bin/codex",
      node: "bin/node",
      nodeRepl: "bin/node_repl",
      peerAuthorization: "peer/authorize.node",
    },
    peerAuthorization: {
      nodeApiVersion: "127",
      signingTeamId: "TESTTEAM",
    },
    runtimeVersions: {
      codexCli: "0.144.6",
      cuaRuntime: "0.0.6/test",
      node: "24.0.0",
      peerAuthorization: "test",
    },
    schemaVersion: 3,
    supportedBackends: ["iab", "chrome"],
    targetArch: "arm64",
    targetPlatform: "darwin",
  };
}

describe("parseBrowserRuntimeManifest", () => {
  test("accepts a complete architecture-bound runtime contract", () => {
    expect(parseBrowserRuntimeManifest(makeManifest())).toEqual(makeManifest());
  });

  test("rejects paths that escape the bundle root", () => {
    const manifest = makeManifest();
    manifest.browserPlugin.client = "../client.js";

    expect(parseBrowserRuntimeManifest(manifest)).toBeNull();
  });

  test("rejects plugin entrypoints missing from the artifact closure", () => {
    const manifest = makeManifest();
    manifest.artifacts = manifest.artifacts.filter(
      (artifact) => artifact.path !== manifest.browserPlugin.client,
    );

    expect(parseBrowserRuntimeManifest(manifest)).toBeNull();
  });

  test("rejects binary entrypoints built for another architecture", () => {
    const manifest = makeManifest();
    manifest.artifacts[0] = { ...manifest.artifacts[0]!, architecture: "x64" };

    expect(parseBrowserRuntimeManifest(manifest)).toBeNull();
  });

  test("rejects trust-all backend declarations and duplicate backends", () => {
    const manifest = makeManifest() as unknown as Record<string, unknown>;
    manifest.supportedBackends = ["iab", "iab"];

    expect(parseBrowserRuntimeManifest(manifest)).toBeNull();
  });
});
