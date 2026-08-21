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
        architecture: "arm64",
        executable: false,
        kind: "native-addon",
        path: "native/sky.node",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "native/remote-hosted-pip/pop-in-window-egg@3x.png",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "native/remote-hosted-pip/pop-out-window-egg@3x.png",
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
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "marketplace/plugins/computer-use/manifest.json",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "marketplace/plugins/computer-use/client.mjs",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "any",
        executable: false,
        kind: "data",
        path: "marketplace/plugins/computer-use/docs/SKILL.md",
        sha256: HASH,
        size: 1,
      },
      {
        architecture: "arm64",
        executable: true,
        kind: "executable",
        path: "runtime/lib/node_modules/@oai/sky/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
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
    capabilities: {
      computerUse: {
        appBundle: "runtime/lib/node_modules/@oai/sky/Codex Computer Use.app",
        appBundleIdentifier: "com.openai.CodexComputerUse",
        client: "marketplace/plugins/computer-use/client.mjs",
        ipcProtocol: "CodexComputerUseIPC-2",
        minimumMacOSVersion: "14.4",
        plugin: {
          docs: "marketplace/plugins/computer-use/docs/SKILL.md",
          id: "computer-use@openai-bundled",
          manifest: "marketplace/plugins/computer-use/manifest.json",
          marketplaceManifest: "marketplace/.agents/plugins/marketplace.json",
          marketplaceRoot: "marketplace",
          nodeModuleDirs: ["runtime/lib/node_modules"],
          root: "marketplace/plugins/computer-use",
          version: "1.0.1000550",
        },
        serviceExecutable:
          "runtime/lib/node_modules/@oai/sky/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
        signingTeamId: "TESTTEAM",
        status: "available",
      },
      nativePip: {
        addon: "native/sky.node",
        controlAssets: [
          "native/remote-hosted-pip/pop-in-window-egg@3x.png",
          "native/remote-hosted-pip/pop-out-window-egg@3x.png",
        ],
        minimumMacOSVersion: "13.0",
      },
    },
    codexCompatibilityVersion: "0.144.6",
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
    schemaVersion: 4,
    supportedBackends: ["iab", "chrome"],
    targetArch: "arm64",
    targetPlatform: "darwin",
  };
}

describe("parseBrowserRuntimeManifest", () => {
  test("accepts a complete architecture-bound runtime contract", () => {
    expect(parseBrowserRuntimeManifest(makeManifest())).toEqual(makeManifest());
  });

  test("accepts an executable Computer Use launcher entrypoint", () => {
    const manifest = makeManifest();
    if (manifest.capabilities.computerUse.status !== "available") {
      throw new Error("Computer Use fixture is unavailable");
    }
    const computerUse = manifest.capabilities.computerUse;
    const client = manifest.artifacts.find((artifact) => artifact.path === computerUse.client);
    if (!client) throw new Error("Computer Use fixture client is missing");
    client.kind = "executable";
    client.executable = true;

    expect(parseBrowserRuntimeManifest(manifest)).toEqual(manifest);
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
