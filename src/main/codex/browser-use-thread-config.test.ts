import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { BROWSER_RUNTIME_BUNDLE_DIRECTORY } from "../../shared/browser-runtime-metadata";
import { resolveBrowserRuntimeBundle } from "./browser-runtime-bundle";
import { writeBrowserRuntimeFixture } from "./browser-runtime-test-fixture";
import { BrowserUseThreadConfigBuilder } from "./browser-use-thread-config";

const temporaryRoots: string[] = [];

function makeVerifiedRuntime() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-browser-config-"));
  temporaryRoots.push(runtimeRoot);
  const bundleRoot = path.join(runtimeRoot, BROWSER_RUNTIME_BUNDLE_DIRECTORY);
  writeBrowserRuntimeFixture(bundleRoot);
  const browserRuntime = resolveBrowserRuntimeBundle({
    expectedCodexCompatibilityVersion: "0.144.6",
    runtimeRoot,
    targetArch: "arm64",
    targetPlatform: "darwin",
  });
  if (browserRuntime.status !== "available") {
    throw new Error(browserRuntime.message);
  }
  return { browserRuntime, bundleRoot };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("BrowserUseThreadConfigBuilder", () => {
  test("returns null with a queryable reason when the bundle is unavailable", async () => {
    const builder = new BrowserUseThreadConfigBuilder({
      browserRuntime: {
        message: "Browser bundle is not installed",
        reason: "manifest-missing",
        status: "unavailable",
      },
      runtimeStateHome: "/tmp/nodex-agent",
    });

    expect(builder.buildResult()).toEqual({
      message: "Browser bundle is not installed",
      reason: "manifest-missing",
      status: "unavailable",
    });
    await expect(builder.build()).resolves.toBeNull();
  });

  test("builds the pinned Node REPL config only from verified paths and hashes", async () => {
    const { browserRuntime, bundleRoot } = makeVerifiedRuntime();
    const runtimeStateHome = path.join(bundleRoot, "..", "state");
    const builder = new BrowserUseThreadConfigBuilder({
      browserRuntime,
      runtimeStateHome,
    });

    const config = await builder.build();

    expect(config).not.toBeNull();
    expect(config?.["features.js_repl"]).toBe(false);
    expect(config?.["mcp_servers.node_repl"]).toMatchObject({
      args: [],
      command: path.join(bundleRoot, "bin", "node_repl"),
      startup_timeout_sec: 120,
      env: {
        BROWSER_USE_AVAILABLE_BACKENDS: "iab",
        CODEX_CLI_PATH: path.join(bundleRoot, "bin", "codex"),
        CODEX_HOME: path.resolve(runtimeStateHome),
        NODE_REPL_NODE_MODULE_DIRS: path.join(
          bundleRoot,
          "marketplace",
          "plugins",
          "browser",
          "node_modules",
        ),
        NODE_REPL_NODE_PATH: path.join(bundleRoot, "bin", "node"),
        NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S:
          browserRuntime.bundle.browserPluginClientSha256,
        NODE_REPL_TRUSTED_CODE_PATHS: path.join(
          bundleRoot,
          "marketplace",
          "plugins",
          "browser",
        ),
      },
    });
    expect(JSON.stringify(config)).not.toContain("NODE_REPL_TRUST_ALL_CODE");
    expect(JSON.stringify(config)).not.toContain("experimental_thread_config_endpoint");
  });

  test("advertises Chrome only when an active backend resolver supplies it", async () => {
    const { browserRuntime } = makeVerifiedRuntime();
    const builder = new BrowserUseThreadConfigBuilder({
      availableBackends: () => ["iab", "chrome"],
      browserRuntime,
      runtimeStateHome: "/tmp/nodex-agent",
    });

    const config = await builder.build();
    const nodeRepl = config?.["mcp_servers.node_repl"] as {
      env?: Record<string, string>;
    };

    expect(nodeRepl.env?.BROWSER_USE_AVAILABLE_BACKENDS).toBe("iab,chrome");
    expect(nodeRepl.env?.NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME).toContain("Chrome browser");
  });
});
