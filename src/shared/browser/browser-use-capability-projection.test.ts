import { describe, expect, test } from "vitest";
import {
  BROWSER_USE_CAPABILITY_FORMAT_VERSION,
  projectBrowserUseCapabilities,
  type BrowserUseBackendInfo,
  type BrowserUseCompatibleArtifact,
  type BrowserUsePluginPolicy,
} from "./browser-use-capability-projection";

const artifact: BrowserUseCompatibleArtifact = {
  status: "compatible",
  contractVersion: BROWSER_USE_CAPABILITY_FORMAT_VERSION,
  apiMembers: [
    {
      id: "Tabs.new",
      unsupportedByDefaultIn: [],
      requiresFullCdpAccess: false,
    },
    {
      id: "BrowserUser.history",
      unsupportedByDefaultIn: ["iab", "cdp"],
      requiresFullCdpAccess: false,
    },
    {
      id: "TabDev.call",
      unsupportedByDefaultIn: [],
      requiresFullCdpAccess: true,
    },
  ],
  browserCapabilities: ["visibility"],
  tabCapabilities: ["webmcp", "viewport"],
};

const backend: BrowserUseBackendInfo = {
  id: "iab",
  name: "In-app browser",
  type: "iab",
  apiSupportOverrides: {
    "BrowserUser.history": true,
  },
  capabilities: {
    browser: [{ id: "visibility" }],
    tab: [{ id: "webmcp" }, { id: "viewport" }],
  },
  metadata: {},
  buildFlavor: "production",
  sessionId: "session-1",
};

const plugin: BrowserUsePluginPolicy = {
  local: { fullCdpAccess: "allow" },
  enterprise: { fullCdpAccess: "not-configured" },
  environment: {
    fullCdpAccess: "allow",
    availableBackends: ["iab"],
    disabledApiMembers: [],
    disabledBrowserCapabilities: [],
    disabledTabCapabilities: [],
  },
};

describe("Browser Use capability projection", () => {
  test("projects artifact defaults, backend overrides, and advertised capabilities", () => {
    const result = projectBrowserUseCapabilities({
      artifact,
      backend,
      plugin,
    });

    expect(result).toMatchObject({
      status: "available",
      backend: {
        id: "iab",
        name: "In-app browser",
        type: "iab",
        metadata: {},
        buildFlavor: "production",
        sessionId: "session-1",
      },
      fullCdpAccess: true,
      apiMembers: ["Tabs.new", "BrowserUser.history", "TabDev.call"],
      browserCapabilities: ["visibility"],
      tabCapabilities: ["webmcp", "viewport"],
      disabledApiMembers: [],
    });
  });

  test("applies backend false overrides and plugin environment disables last", () => {
    const result = projectBrowserUseCapabilities({
      artifact,
      backend: {
        ...backend,
        apiSupportOverrides: {
          "Tabs.new": false,
          "BrowserUser.history": true,
        },
      },
      plugin: {
        ...plugin,
        environment: {
          ...plugin.environment,
          disabledApiMembers: ["BrowserUser.history"],
          disabledBrowserCapabilities: ["visibility"],
          disabledTabCapabilities: ["viewport"],
        },
      },
    });

    expect(result.apiMembers).toEqual(["TabDev.call"]);
    expect(result.disabledApiMembers).toEqual(["Tabs.new", "BrowserUser.history"]);
    expect(result.browserCapabilities).toEqual([]);
    expect(result.tabCapabilities).toEqual(["webmcp"]);
    expect(result.reasons.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "backend-api-unsupported",
        "plugin-api-disabled",
        "plugin-capability-disabled",
      ]),
    );
  });

  test("fails closed only for Full CDP members when a policy cannot be verified", () => {
    const result = projectBrowserUseCapabilities({
      artifact,
      backend,
      plugin: {
        ...plugin,
        enterprise: {
          fullCdpAccess: "unverified",
        },
      },
    });

    expect(result.status).toBe("available");
    expect(result.fullCdpAccess).toBe(false);
    expect(result.apiMembers).toEqual(["Tabs.new", "BrowserUser.history"]);
    expect(result.disabledApiMembers).toEqual(["TabDev.call"]);
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "full-cdp-enterprise-unverified",
      }),
    );
  });

  test("closes the runtime for invalid stages and unavailable backends", () => {
    const invalidBackend = projectBrowserUseCapabilities({
      artifact,
      backend: {
        ...backend,
        apiSupportOverrides: {
          "Tabs.new": "yes",
        },
      },
      plugin,
    });
    const invalidPlugin = projectBrowserUseCapabilities({
      artifact,
      backend,
      plugin: {
        ...plugin,
        local: {
          fullCdpAccess: "unknown",
        },
      },
    });
    const unavailableBackend = projectBrowserUseCapabilities({
      artifact,
      backend,
      plugin: {
        ...plugin,
        environment: {
          ...plugin.environment,
          availableBackends: ["chrome"],
        },
      },
    });

    expect(invalidBackend.status).toBe("unavailable");
    expect(invalidBackend.reasons[0]?.code).toBe("backend-invalid");
    expect(invalidPlugin.status).toBe("unavailable");
    expect(invalidPlugin.reasons[0]?.code).toBe("plugin-invalid");
    expect(unavailableBackend.status).toBe("unavailable");
    expect(unavailableBackend.reasons[0]?.code).toBe("backend-unavailable");
  });

  test("rejects incompatible artifact contracts before backend projection", () => {
    const result = projectBrowserUseCapabilities({
      artifact: {
        ...artifact,
        contractVersion: "999.0.0",
      },
      backend,
      plugin,
    });

    expect(result.status).toBe("unavailable");
    expect(result.backend).toBe(null);
    expect(result.disabledApiMembers).toEqual(["Tabs.new", "BrowserUser.history", "TabDev.call"]);
    expect(result.reasons[0]?.code).toBe("artifact-contract-version-mismatch");
  });

  test("bounds diagnostics when a backend advertises unknown capabilities", () => {
    const result = projectBrowserUseCapabilities({
      artifact,
      backend: {
        ...backend,
        capabilities: {
          ...backend.capabilities,
          tab: Array.from({ length: 100 }, (_, index) => ({
            id: `Unknown.capability${index}`,
          })),
        },
      },
      plugin,
    });

    expect(result.status).toBe("available");
    expect(result.reasons.length).toBeLessThanOrEqual(64);
    expect(result.reasons.at(-1)?.code).toBe("reason-limit-reached");
    expect(result.reasons.every(({ message }) => message.length < 160)).toBe(true);
  });
});
