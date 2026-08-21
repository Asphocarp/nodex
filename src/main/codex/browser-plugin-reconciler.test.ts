import { describe, expect, test, vi } from "vitest";
import { writeBrowserRuntimeFixture } from "./browser-runtime-test-fixture";
import { resolveBrowserRuntimeBundle } from "./browser-runtime-bundle";
import { BrowserPluginReconciler } from "./browser-plugin-reconciler";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-browser-plugin-"));
  writeBrowserRuntimeFixture(path.join(root, "browser-runtime"));
  const browserRuntime = resolveBrowserRuntimeBundle({
    expectedCodexCompatibilityVersion: "0.144.6",
    runtimeRoot: root,
    targetArch: "arm64",
    targetPlatform: "darwin",
  });
  if (browserRuntime.status === "unavailable") throw new Error(browserRuntime.message);
  const runtimeStateHome = path.join(root, "state");
  const marketplaceRoot = path.join(
    runtimeStateHome,
    ".tmp",
    "bundled-marketplaces",
    "openai-bundled",
  );
  return { browserRuntime, marketplaceRoot, root, runtimeStateHome };
}

function plugin(input: {
  enabled: boolean;
  installed: boolean;
  name?: "browser" | "computer-use";
  version: string;
}) {
  const name = input.name ?? "browser";
  return {
    authPolicy: "ON_INSTALL",
    availability: "AVAILABLE",
    enabled: input.enabled,
    id: `${name}@openai-bundled`,
    installPolicy: "AVAILABLE",
    installPolicySource: null,
    installed: input.installed,
    interface: null,
    keywords: [],
    localVersion: input.version,
    name,
    remotePluginId: null,
    shareContext: null,
    source: { type: "local", path: `/tmp/${name}` },
    version: input.version,
  };
}

describe("BrowserPluginReconciler", () => {
  test("reuses the exact installed bundled plugin without reinstalling", async () => {
    const fixture = makeRuntime();
    const request = vi.fn(async (method: string) => {
      if (method === "plugin/list") {
        return {
          featuredPluginIds: [],
          marketplaceLoadErrors: [],
          marketplaces: [
            {
              interface: null,
              name: "openai-bundled",
              path: fixture.marketplaceRoot,
              plugins: [plugin({ enabled: true, installed: true, version: "1.0.0-test" })],
            },
          ],
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });

    try {
      const reconciler = new BrowserPluginReconciler({
        browserRuntime: fixture.browserRuntime,
        client: { request },
        runtimeStateHome: fixture.runtimeStateHome,
      });
      await expect(reconciler.ensureInstalled()).resolves.toEqual({
        computerUse: {
          message: "Computer Use runtime capability is unavailable",
          reason: "capability-unavailable",
          status: "unavailable",
        },
        enabled: true,
        installedVersion: "1.0.0-test",
        marketplaceRoot: fixture.marketplaceRoot,
        status: "ready",
      });
      await reconciler.ensureInstalled();
      expect(request.mock.calls.filter(([method]) => method === "plugin/install")).toHaveLength(0);
      expect(request.mock.calls.filter(([method]) => method === "marketplace/add")).toHaveLength(0);
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  test("installs and verifies a missing or stale plugin", async () => {
    const fixture = makeRuntime();
    let marketplaceAdded = false;
    let installed = false;
    const request = vi.fn(async (method: string) => {
      if (method === "marketplace/add") {
        marketplaceAdded = true;
        return {
          marketplaceName: "openai-bundled",
          installedRoot: fixture.marketplaceRoot,
          alreadyAdded: false,
        };
      }
      if (method === "plugin/list") {
        return {
          featuredPluginIds: [],
          marketplaceLoadErrors: [],
          marketplaces: marketplaceAdded
            ? [
                {
                  interface: null,
                  name: "openai-bundled",
                  path: fixture.marketplaceRoot,
                  plugins: [
                    plugin({
                      enabled: installed,
                      installed,
                      version: installed ? "1.0.0-test" : "0.9.0",
                    }),
                  ],
                },
              ]
            : [],
        };
      }
      if (method === "plugin/install") {
        installed = true;
        return { appsNeedingAuth: [], authPolicy: "ON_INSTALL" };
      }
      if (method === "skills/list") return { data: [] };
      throw new Error(`Unexpected request: ${method}`);
    });

    try {
      const reconciler = new BrowserPluginReconciler({
        browserRuntime: fixture.browserRuntime,
        client: { request },
        runtimeStateHome: fixture.runtimeStateHome,
      });
      await expect(reconciler.ensureInstalled()).resolves.toMatchObject({ status: "ready" });
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        "plugin/list",
        "marketplace/add",
        "plugin/list",
        "plugin/install",
        "skills/list",
        "plugin/list",
      ]);
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  test("installs Browser and Computer Use from the materialized marketplace", async () => {
    const fixture = makeRuntime();
    const installed = new Set<string>();
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "plugin/list") {
        return {
          featuredPluginIds: [],
          marketplaceLoadErrors: [],
          marketplaces: [
            {
              interface: null,
              name: "openai-bundled",
              path: fixture.marketplaceRoot,
              plugins: [
                plugin({
                  enabled: installed.has("browser"),
                  installed: installed.has("browser"),
                  version: "1.0.0-test",
                }),
                plugin({
                  enabled: installed.has("computer-use"),
                  installed: installed.has("computer-use"),
                  name: "computer-use",
                  version: "1.0.0-test",
                }),
              ],
            },
          ],
        };
      }
      if (method === "plugin/install") {
        const pluginName = (params as { pluginName: string }).pluginName;
        installed.add(pluginName);
        return { appsNeedingAuth: [], authPolicy: "ON_INSTALL" };
      }
      if (method === "skills/list") return { data: [] };
      throw new Error(`Unexpected request: ${method}`);
    });

    try {
      const reconciler = new BrowserPluginReconciler({
        browserRuntime: fixture.browserRuntime,
        client: { request },
        computerUseAvailable: () => true,
        runtimeStateHome: fixture.runtimeStateHome,
      });

      await expect(reconciler.ensureInstalled()).resolves.toMatchObject({
        computerUse: {
          enabled: true,
          installedVersion: "1.0.0-test",
          pluginRoot: path.join(fixture.marketplaceRoot, "plugins", "computer-use"),
          status: "ready",
        },
        enabled: true,
        status: "ready",
      });
      expect(
        request.mock.calls
          .filter(([method]) => method === "plugin/install")
          .map(([, params]) => (params as { pluginName: string }).pluginName),
      ).toEqual(["browser", "computer-use"]);
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  test("replaces a stale bundled marketplace source before verification", async () => {
    const fixture = makeRuntime();
    let source = "/tmp/obsolete-openai-bundled";
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "plugin/list") {
        return {
          featuredPluginIds: [],
          marketplaceLoadErrors: [],
          marketplaces: [
            {
              interface: null,
              name: "openai-bundled",
              path: source,
              plugins: [
                plugin({
                  enabled: true,
                  installed: true,
                  version: "1.0.0-test",
                }),
              ],
            },
          ],
        };
      }
      if (method === "marketplace/remove") {
        expect(params).toEqual({ marketplaceName: "openai-bundled" });
        source = "";
        return {
          marketplaceName: "openai-bundled",
          installedRoot: "/tmp/obsolete-openai-bundled",
        };
      }
      if (method === "marketplace/add") {
        source = fixture.marketplaceRoot;
        return {
          marketplaceName: "openai-bundled",
          installedRoot: source,
          alreadyAdded: false,
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });

    try {
      const reconciler = new BrowserPluginReconciler({
        browserRuntime: fixture.browserRuntime,
        client: { request },
        runtimeStateHome: fixture.runtimeStateHome,
      });
      await expect(reconciler.ensureInstalled()).resolves.toMatchObject({
        status: "ready",
      });
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        "plugin/list",
        "marketplace/remove",
        "marketplace/add",
        "plugin/list",
      ]);
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  test("fails closed when installation cannot be verified", async () => {
    const fixture = makeRuntime();
    let shouldFail = true;
    try {
      const reconciler = new BrowserPluginReconciler({
        browserRuntime: fixture.browserRuntime,
        client: {
          request: async (method) => {
            if (shouldFail) throw new Error("unsupported");
            if (method === "plugin/list") {
              return {
                featuredPluginIds: [],
                marketplaceLoadErrors: [],
                marketplaces: [
                  {
                    interface: null,
                    name: "openai-bundled",
                    path: fixture.marketplaceRoot,
                    plugins: [
                      plugin({
                        enabled: true,
                        installed: true,
                        version: "1.0.0-test",
                      }),
                    ],
                  },
                ],
              };
            }
            throw new Error(`Unexpected request: ${method}`);
          },
        },
        runtimeStateHome: fixture.runtimeStateHome,
      });
      await expect(reconciler.ensureInstalled()).resolves.toEqual({
        message: "Desktop tool plugin reconciliation failed: unsupported",
        reason: "reconciliation-failed",
        status: "unavailable",
      });
      shouldFail = false;
      await expect(reconciler.ensureInstalled()).resolves.toMatchObject({
        status: "ready",
      });
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  test("removes an installed Browser plugin when no host backend is available", async () => {
    const fixture = makeRuntime();
    let availableBackends: Array<"iab"> = [];
    let installed = true;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "plugin/list") {
        return {
          featuredPluginIds: [],
          marketplaceLoadErrors: [],
          marketplaces: [
            {
              interface: null,
              name: "openai-bundled",
              path: fixture.marketplaceRoot,
              plugins: [
                plugin({
                  enabled: installed,
                  installed,
                  version: "1.0.0-test",
                }),
              ],
            },
          ],
        };
      }
      if (method === "plugin/uninstall") {
        expect(params).toEqual({ pluginId: "browser@openai-bundled" });
        installed = false;
        return {};
      }
      if (method === "plugin/install") {
        installed = true;
        return { appsNeedingAuth: [], authPolicy: "ON_INSTALL" };
      }
      if (method === "skills/list") return { data: [] };
      throw new Error(`Unexpected request: ${method}`);
    });

    try {
      const reconciler = new BrowserPluginReconciler({
        availableBackends: () => availableBackends,
        browserRuntime: fixture.browserRuntime,
        client: { request },
        runtimeStateHome: fixture.runtimeStateHome,
      });

      await expect(reconciler.ensureInstalled()).resolves.toEqual({
        message: "Desktop tool host backends are unavailable",
        reason: "backend-unavailable",
        status: "unavailable",
      });
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        "plugin/list",
        "plugin/uninstall",
        "skills/list",
        "plugin/list",
      ]);

      availableBackends = ["iab"];
      await expect(reconciler.ensureInstalled()).resolves.toEqual({
        computerUse: {
          message: "Computer Use runtime capability is unavailable",
          reason: "capability-unavailable",
          status: "unavailable",
        },
        enabled: true,
        installedVersion: "1.0.0-test",
        marketplaceRoot: fixture.marketplaceRoot,
        status: "ready",
      });
      expect(request.mock.calls.filter(([method]) => method === "plugin/uninstall")).toHaveLength(
        1,
      );
      expect(request.mock.calls.filter(([method]) => method === "plugin/install")).toHaveLength(1);
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  });
});
