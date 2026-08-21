import { describe, expect, test } from "vitest";
import {
  loadLocalEnvironmentConfigSelection,
  loadLocalEnvironmentSelection,
  localEnvironmentWorkspaceKey,
  resolveLocalEnvironmentConfigSelection,
  resolveLocalEnvironmentSelection,
  resolveStoredLocalEnvironmentSelection,
} from "./local-environment-selection";

const WORKSPACE_ROOT = "/repo/nodex";
const WORKSPACE_KEY = "local:/repo/nodex";

describe("local environment selection resolution", () => {
  test.each([
    {
      name: "successful environment.toml",
      candidates: [
        { configPath: "/repo/nodex/.codex/environments/broken.toml", state: "parseError" as const },
        { configPath: "/repo/nodex/.codex/environments/dev.toml", state: "success" as const },
        {
          configPath: "/repo/nodex/.codex/environments/environment.toml",
          state: "success" as const,
        },
      ],
      expectedStatus: "selected",
      expectedResolvedPath: "/repo/nodex/.codex/environments/environment.toml",
      expectedRepairPath: null,
    },
    {
      name: "first other successful config",
      candidates: [
        { configPath: "/repo/nodex/.codex/environments/broken.toml", state: "readError" as const },
        { configPath: "/repo/nodex/.codex/environments/dev.toml", state: "success" as const },
      ],
      expectedStatus: "selected",
      expectedResolvedPath: "/repo/nodex/.codex/environments/dev.toml",
      expectedRepairPath: null,
    },
    {
      name: "first result when none are successful",
      candidates: [
        { configPath: "/repo/nodex/.codex/environments/broken.toml", state: "tooLarge" as const },
        {
          configPath: "/repo/nodex/.codex/environments/unreadable.toml",
          state: "readError" as const,
        },
      ],
      expectedStatus: "needs-attention",
      expectedResolvedPath: null,
      expectedRepairPath: "/repo/nodex/.codex/environments/broken.toml",
    },
  ])(
    "uses the $name default when the workspace has no saved choice",
    ({ candidates, expectedRepairPath, expectedResolvedPath, expectedStatus }) => {
      const result = resolveLocalEnvironmentSelection({
        candidateSource: { status: "loaded", candidates },
        selectionsByWorkspace: {},
        workspaceRoot: WORKSPACE_ROOT,
      });

      expect(result.status).toBe(expectedStatus);
      expect(result.defaultConfigPath).toBe(expectedRepairPath ?? expectedResolvedPath);
      expect(result.resolvedConfigPath).toBe(expectedResolvedPath);
      expect(result.repairConfigPath).toBe(expectedRepairPath);
    },
  );

  test("keeps an explicit without-environment choice instead of applying the default", () => {
    const result = resolveLocalEnvironmentSelection({
      candidateSource: {
        status: "loaded",
        candidates: [
          {
            configPath: "/repo/nodex/.codex/environments/environment.toml",
            state: "success",
          },
        ],
      },
      selectionsByWorkspace: { [WORKSPACE_KEY]: null },
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(result).toMatchObject({
      status: "without-environment",
      source: "saved",
      storedConfigPath: null,
      resolvedConfigPath: null,
      repairConfigPath: null,
    });
  });

  test("canonicalizes a valid saved environment path to the loaded candidate", () => {
    const result = resolveLocalEnvironmentSelection({
      candidateSource: {
        status: "loaded",
        candidates: [
          {
            configPath: "/mnt/c/repo/nodex/.codex/environments/dev.toml",
            state: "success",
          },
        ],
      },
      selectionsByWorkspace: {
        "local:/mnt/c/repo/nodex": "C:\\repo\\nodex\\.codex\\environments\\dev.toml",
      },
      workspaceRoot: "/mnt/c/repo/nodex",
    });

    expect(result).toMatchObject({
      status: "selected",
      source: "saved",
      storedConfigPath: "C:\\repo\\nodex\\.codex\\environments\\dev.toml",
      resolvedConfigPath: "/mnt/c/repo/nodex/.codex/environments/dev.toml",
      repairConfigPath: null,
    });
  });

  test.each([
    {
      name: "missing",
      candidates: [
        {
          configPath: "/repo/nodex/.codex/environments/environment.toml",
          state: "success" as const,
        },
      ],
      savedConfigPath: "/repo/nodex/.codex/environments/missing.toml",
      issue: "missing",
      repairConfigPath: "/repo/nodex/.codex/environments/missing.toml",
    },
    {
      name: "invalid",
      candidates: [
        {
          configPath: "/repo/nodex/.codex/environments/broken.toml",
          state: "parseError" as const,
        },
      ],
      savedConfigPath: "/repo/nodex/.codex/environments/broken.toml",
      issue: "parseError",
      repairConfigPath: "/repo/nodex/.codex/environments/broken.toml",
    },
  ])(
    "marks a saved $name environment for repair without falling back",
    ({ candidates, issue, repairConfigPath, savedConfigPath }) => {
      const result = resolveLocalEnvironmentSelection({
        candidateSource: { status: "loaded", candidates },
        selectionsByWorkspace: { [WORKSPACE_KEY]: savedConfigPath },
        workspaceRoot: WORKSPACE_ROOT,
      });

      expect(result).toMatchObject({
        status: "needs-attention",
        issue,
        resolvedConfigPath: null,
        repairConfigPath,
      });
    },
  );

  test("keeps candidate loading failures explicit and unresolved", async () => {
    const error = new Error("workspace unavailable");
    const result = await loadLocalEnvironmentSelection({
      workspaceRoot: WORKSPACE_ROOT,
      selectionsByWorkspace: {
        [WORKSPACE_KEY]: "/repo/nodex/.codex/environments/dev.toml",
      },
      loadCandidates: async () => {
        throw error;
      },
    });

    expect(result).toMatchObject({
      status: "unresolved",
      reason: "load-error",
      error,
      storedConfigPath: "/repo/nodex/.codex/environments/dev.toml",
      resolvedConfigPath: null,
      repairConfigPath: null,
    });
  });

  test("keeps conflicting equivalent-workspace selections unresolved", () => {
    const result = resolveLocalEnvironmentSelection({
      candidateSource: {
        status: "loaded",
        candidates: [
          {
            configPath: "/mnt/c/repo/nodex/.codex/environments/environment.toml",
            state: "success",
          },
        ],
      },
      selectionsByWorkspace: {
        "local:C:\\repo\\nodex": null,
        "local://wsl$/Ubuntu/mnt/c/repo/nodex": "/mnt/c/repo/nodex/.codex/environments/dev.toml",
      },
      workspaceRoot: "/mnt/c/repo/nodex",
    });

    expect(result).toMatchObject({
      status: "unresolved",
      reason: "ambiguous-saved-selection",
      resolvedConfigPath: null,
      repairConfigPath: null,
    });
  });

  test("projects runnable selections for legacy string-or-null consumers", () => {
    expect(
      resolveLocalEnvironmentConfigSelection({
        canValidateSelection: true,
        candidates: [
          {
            configPath: "/repo/nodex/.codex/environments/environment.toml",
            state: "success",
          },
        ],
        selectionsByWorkspace: {},
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toBe("/repo/nodex/.codex/environments/environment.toml");
    expect(
      resolveLocalEnvironmentConfigSelection({
        canValidateSelection: true,
        candidates: [
          {
            configPath: "/repo/nodex/.codex/environments/environment.toml",
            state: "success",
          },
        ],
        selectionsByWorkspace: { [WORKSPACE_KEY]: null },
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toBe(null);
    expect(
      resolveLocalEnvironmentConfigSelection({
        canValidateSelection: true,
        candidates: [{ configPath: "/repo/nodex/.codex/environments/dev.toml", state: "success" }],
        selectionsByWorkspace: {
          [WORKSPACE_KEY]: "/repo/nodex/.codex/environments/dev.toml",
        },
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toBe("/repo/nodex/.codex/environments/dev.toml");
  });

  test("withholds invalid saved selections from legacy consumers without falling back", () => {
    const candidates = [
      { configPath: "/repo/nodex/.codex/environments/broken.toml", state: "parseError" as const },
      { configPath: "/repo/nodex/.codex/environments/dev.toml", state: "success" as const },
      { configPath: "/repo/nodex/.codex/environments/environment.toml", state: "success" as const },
    ];
    const selectionsByWorkspace = {
      [WORKSPACE_KEY]: "/repo/nodex/.codex/environments/missing.toml",
    };

    expect(
      resolveLocalEnvironmentConfigSelection({
        canValidateSelection: true,
        candidates,
        selectionsByWorkspace,
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toBe(null);
    expect(
      resolveLocalEnvironmentConfigSelection({
        canValidateSelection: false,
        candidates: [],
        selectionsByWorkspace,
        workspaceRoot: WORKSPACE_ROOT,
      }),
    ).toBe("/repo/nodex/.codex/environments/missing.toml");
  });

  test("reuses agreeing equivalent workspace aliases and rejects conflicts", () => {
    const workspaceKey = localEnvironmentWorkspaceKey("/mnt/c/repo/nodex");
    expect(
      resolveStoredLocalEnvironmentSelection({
        selectionsByWorkspace: {
          "local:C:\\repo\\nodex": "C:\\repo\\nodex\\.codex\\environments\\dev.toml",
          "local://wsl$/Ubuntu/mnt/c/repo/nodex": "/mnt/c/repo/nodex/.codex/environments/dev.toml",
        },
        workspaceKey,
      }),
    ).toBe("C:\\repo\\nodex\\.codex\\environments\\dev.toml");
    expect(
      resolveStoredLocalEnvironmentSelection({
        selectionsByWorkspace: {
          "local:C:\\repo\\nodex": null,
          "local://wsl$/Ubuntu/mnt/c/repo/nodex": "/mnt/c/repo/nodex/.codex/environments/dev.toml",
        },
        workspaceKey,
      }),
    ).toBe(undefined);
  });

  test("loads the default selection against the exact conversation workspace", async () => {
    let requestedWorkspaceRoot = "";
    const resolved = await loadLocalEnvironmentConfigSelection({
      workspaceRoot: "/repo/nodex/packages/desktop",
      selectionsByWorkspace: {},
      loadCandidates: async (workspaceRoot) => {
        requestedWorkspaceRoot = workspaceRoot;
        return [
          {
            configPath: "/repo/nodex/packages/desktop/.codex/environments/environment.toml",
            state: "success",
          },
        ];
      },
    });

    expect(requestedWorkspaceRoot).toBe("/repo/nodex/packages/desktop");
    expect(resolved).toBe("/repo/nodex/packages/desktop/.codex/environments/environment.toml");
  });

  test("preserves the raw saved selection when workspace validation fails", async () => {
    const savedConfigPath = "/repo/nodex/packages/desktop/.codex/environments/dev.toml";
    const resolved = await loadLocalEnvironmentConfigSelection({
      workspaceRoot: "/repo/nodex/packages/desktop",
      selectionsByWorkspace: {
        "local:/repo/nodex/packages/desktop": savedConfigPath,
      },
      loadCandidates: async () => {
        throw new Error("workspace unavailable");
      },
    });

    expect(resolved).toBe(savedConfigPath);
  });
});
