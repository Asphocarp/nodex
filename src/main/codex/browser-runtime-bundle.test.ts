import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  BROWSER_RUNTIME_BUNDLE_DIRECTORY,
  BROWSER_RUNTIME_MANIFEST_FILENAME,
} from "../../shared/browser-runtime-metadata";
import { resolveBrowserRuntimeBundle } from "./browser-runtime-bundle";
import { writeBrowserRuntimeFixture } from "./browser-runtime-test-fixture";

const temporaryRoots: string[] = [];

function makeRuntimeRoot(): string {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-browser-runtime-"));
  temporaryRoots.push(runtimeRoot);
  return runtimeRoot;
}

function resolveFixture(runtimeRoot: string) {
  return resolveBrowserRuntimeBundle({
    expectedCodexCompatibilityVersion: "0.144.6",
    runtimeRoot,
    targetArch: "arm64",
    targetPlatform: "darwin",
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("resolveBrowserRuntimeBundle", () => {
  test("returns an explicit unavailable state when no bundle is installed", () => {
    const result = resolveFixture(makeRuntimeRoot());

    expect(result).toMatchObject({
      reason: "manifest-missing",
      status: "unavailable",
    });
  });

  test("exposes only verified absolute bundle paths", () => {
    const runtimeRoot = makeRuntimeRoot();
    const bundleRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
    const manifest = writeBrowserRuntimeFixture(bundleRoot);

    const result = resolveFixture(runtimeRoot);

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.bundle.paths.nodeRepl).toBe(path.join(bundleRoot, "bin", "node_repl"));
    expect(result.bundle.browserPluginRoot).toBe(
      path.join(bundleRoot, "marketplace", "plugins", "browser"),
    );
    expect(result.bundle.browserPluginClientSha256).toBe(
      manifest.artifacts.find((artifact) => artifact.path === manifest.browserPlugin.client)
        ?.sha256,
    );
  });

  test("makes a tampered payload unavailable before it reaches thread config", () => {
    const runtimeRoot = makeRuntimeRoot();
    const bundleRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
    writeBrowserRuntimeFixture(bundleRoot);
    fs.appendFileSync(
      path.join(bundleRoot, "marketplace", "plugins", "browser", "client.js"),
      "tampered",
    );

    expect(resolveFixture(runtimeRoot)).toMatchObject({
      reason: "artifact-integrity",
      status: "unavailable",
    });
  });

  test("rejects symlinked artifact parents even when their payload is valid", () => {
    const runtimeRoot = makeRuntimeRoot();
    const bundleRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
    writeBrowserRuntimeFixture(bundleRoot);
    const pluginRoot = path.join(bundleRoot, "marketplace");
    const relocatedPluginRoot = path.join(runtimeRoot, "relocated-plugins");
    fs.renameSync(pluginRoot, relocatedPluginRoot);
    fs.symlinkSync(relocatedPluginRoot, pluginRoot);

    expect(resolveFixture(runtimeRoot)).toMatchObject({
      reason: "artifact-invalid",
      status: "unavailable",
    });
  });

  test("rejects a bundle for a different Codex compatibility version", () => {
    const runtimeRoot = makeRuntimeRoot();
    writeBrowserRuntimeFixture(path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY), {
      codexCompatibilityVersion: "0.145.0",
    });

    expect(resolveFixture(runtimeRoot)).toMatchObject({
      reason: "incompatible-codex",
      status: "unavailable",
    });
  });

  test("accepts a stable Codex version inside the closure's sealed protocol window", () => {
    const runtimeRoot = makeRuntimeRoot();
    writeBrowserRuntimeFixture(path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY), {
      codexCliVersion: "0.146.0-alpha.9",
      codexCompatibilityVersion: "0.144.5",
    });

    expect(resolveFixture(runtimeRoot).status).toBe("available");
  });

  test("rejects the stable release at a prerelease upper boundary", () => {
    const runtimeRoot = makeRuntimeRoot();
    writeBrowserRuntimeFixture(path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY), {
      codexCliVersion: "0.144.6-alpha.9",
      codexCompatibilityVersion: "0.144.5",
    });

    expect(resolveFixture(runtimeRoot)).toMatchObject({
      reason: "incompatible-codex",
      status: "unavailable",
    });
  });

  test("provides a platform verification seam for architecture and signing checks", () => {
    const runtimeRoot = makeRuntimeRoot();
    writeBrowserRuntimeFixture(path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY));

    const result = resolveBrowserRuntimeBundle({
      expectedCodexCompatibilityVersion: "0.144.6",
      platformArtifactVerifier: ({ artifact, manifest }) =>
        artifact.kind === "native-addon" && manifest.peerAuthorization.signingTeamId !== "REALTEAM"
          ? "unexpected signing team"
          : null,
      runtimeRoot,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });

    expect(result).toMatchObject({
      reason: "platform-verification-failed",
      status: "unavailable",
    });
  });

  test("rejects an invalid manifest without reading undeclared paths", () => {
    const runtimeRoot = makeRuntimeRoot();
    const bundleRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
    fs.mkdirSync(bundleRoot);
    fs.writeFileSync(path.join(bundleRoot, BROWSER_RUNTIME_MANIFEST_FILENAME), "{}");

    expect(resolveFixture(runtimeRoot)).toMatchObject({
      reason: "invalid-manifest",
      status: "unavailable",
    });
  });
});
