import { describe, expect, test } from "vitest";
import {
  loadLocalEnvironmentConfigSelection,
  localEnvironmentWorkspaceKey,
  resolveLocalEnvironmentConfigSelection,
  resolveStoredLocalEnvironmentSelection,
} from "./local-environment-selection";

const WORKSPACE_ROOT = "/repo/nodex";
const WORKSPACE_KEY = "local:/repo/nodex";

describe("local environment selection resolution", () => {
  test("distinguishes absent, explicit null, and a valid saved config", () => {
    expect(resolveLocalEnvironmentConfigSelection({
      canValidateSelection: true,
      candidates: [],
      selectionsByWorkspace: {},
      workspaceRoot: WORKSPACE_ROOT,
    })).toBe(null);
    expect(resolveLocalEnvironmentConfigSelection({
      canValidateSelection: true,
      candidates: [],
      selectionsByWorkspace: { [WORKSPACE_KEY]: null },
      workspaceRoot: WORKSPACE_ROOT,
    })).toBe(null);
    expect(resolveLocalEnvironmentConfigSelection({
      canValidateSelection: true,
      candidates: [{ configPath: "/repo/nodex/.codex/environments/dev.toml", state: "success" }],
      selectionsByWorkspace: {
        [WORKSPACE_KEY]: "/repo/nodex/.codex/environments/dev.toml",
      },
      workspaceRoot: WORKSPACE_ROOT,
    })).toBe("/repo/nodex/.codex/environments/dev.toml");
  });

  test("falls back to the preferred valid config only after validation", () => {
    const candidates = [
      { configPath: "/repo/nodex/.codex/environments/broken.toml", state: "parseError" as const },
      { configPath: "/repo/nodex/.codex/environments/dev.toml", state: "success" as const },
      { configPath: "/repo/nodex/.codex/environments/environment.toml", state: "success" as const },
    ];
    const selectionsByWorkspace = { [WORKSPACE_KEY]: "/repo/nodex/.codex/environments/missing.toml" };

    expect(resolveLocalEnvironmentConfigSelection({
      canValidateSelection: true,
      candidates,
      selectionsByWorkspace,
      workspaceRoot: WORKSPACE_ROOT,
    })).toBe("/repo/nodex/.codex/environments/environment.toml");
    expect(resolveLocalEnvironmentConfigSelection({
      canValidateSelection: false,
      candidates: [],
      selectionsByWorkspace,
      workspaceRoot: WORKSPACE_ROOT,
    })).toBe("/repo/nodex/.codex/environments/missing.toml");
  });

  test("reuses agreeing equivalent workspace aliases and rejects conflicts", () => {
    const workspaceKey = localEnvironmentWorkspaceKey("/mnt/c/repo/nodex");
    expect(resolveStoredLocalEnvironmentSelection({
      selectionsByWorkspace: {
        "local:C:\\repo\\nodex": "C:\\repo\\nodex\\.codex\\environments\\dev.toml",
        "local://wsl$/Ubuntu/mnt/c/repo/nodex": "/mnt/c/repo/nodex/.codex/environments/dev.toml",
      },
      workspaceKey,
    })).toBe("C:\\repo\\nodex\\.codex\\environments\\dev.toml");
    expect(resolveStoredLocalEnvironmentSelection({
      selectionsByWorkspace: {
        "local:C:\\repo\\nodex": null,
        "local://wsl$/Ubuntu/mnt/c/repo/nodex": "/mnt/c/repo/nodex/.codex/environments/dev.toml",
      },
      workspaceKey,
    })).toBe(undefined);
  });

  test("validates a saved selection against the exact conversation workspace", async () => {
    let requestedWorkspaceRoot = "";
    const resolved = await loadLocalEnvironmentConfigSelection({
      workspaceRoot: "/repo/nodex/packages/desktop",
      selectionsByWorkspace: {
        "local:/repo/nodex/packages/desktop": "/repo/nodex/packages/desktop/.codex/environments/missing.toml",
      },
      loadCandidates: async (workspaceRoot) => {
        requestedWorkspaceRoot = workspaceRoot;
        return [{
          configPath: "/repo/nodex/packages/desktop/.codex/environments/environment.toml",
          state: "success",
        }];
      },
    });

    expect(requestedWorkspaceRoot).toBe("/repo/nodex/packages/desktop");
    expect(resolved).toBe(
      "/repo/nodex/packages/desktop/.codex/environments/environment.toml",
    );
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
