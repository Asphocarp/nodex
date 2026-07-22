import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WORKTREE_ENVIRONMENT_ACTION_COMMAND_MAX_BYTES,
  WORKTREE_ENVIRONMENT_ACTION_MAX_COUNT,
  WORKTREE_ENVIRONMENT_ACTION_NAME_MAX_CHARS,
  WORKTREE_ENVIRONMENT_MAX_BYTES,
  WORKTREE_ENVIRONMENT_NAME_MAX_CHARS,
  WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES,
  listWorktreeEnvironmentConfigs,
  listWorktreeEnvironmentOptions,
  readWorktreeEnvironmentDefinition,
  readWorktreeEnvironmentSettingsSnapshot,
  saveWorktreeEnvironmentSettingsSnapshot,
  serializeWorktreeEnvironmentDefinition,
} from "./worktree-environment-service";

function createWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nodex-worktree-env-"));
}

function removeWorkspace(workspacePath: string) {
  fs.rmSync(workspacePath, { recursive: true, force: true });
}

function writeEnvironmentFile(workspacePath: string, fileName: string, contents: string) {
  const envDir = path.join(workspacePath, ".codex", "environments");
  fs.mkdirSync(envDir, { recursive: true });
  fs.writeFileSync(path.join(envDir, fileName), contents, "utf8");
}

describe("worktree-environment-service", () => {
  test("lists configs and options with full local-environment metadata", async () => {
    const workspacePath = createWorkspace();

    writeEnvironmentFile(workspacePath, "environment.toml", [
      "version = 1",
      'name = "Studio"',
      "",
      "[setup]",
      'script = "bun install"',
      "",
      "[cleanup]",
      'script = "git clean -fd"',
      "",
      "[setup.darwin]",
      'script = "brew bundle"',
      "",
      "[[actions]]",
      'name = "Run tests"',
      'icon = "test"',
      'command = "bun test"',
      'platform = "darwin"',
      "",
    ].join("\n"));
    writeEnvironmentFile(workspacePath, "environment-2.toml", [
      'name = "Plain"',
      "",
    ].join("\n"));
    writeEnvironmentFile(workspacePath, "broken.toml", "name = ");

    try {
      const configs = await listWorktreeEnvironmentConfigs(workspacePath);
      const options = await listWorktreeEnvironmentOptions(workspacePath);

      expect(configs.length).toBe(3);
      expect(configs[0]?.configPath).toBe(".codex/environments/broken.toml");
      expect(configs[0]?.state).toBe("parseError");
      expect(Boolean(configs[0]?.parseErrorMessage)).toBe(true);

      expect(configs[1]?.configPath).toBe(".codex/environments/environment-2.toml");
      expect(configs[1]?.name).toBe("Plain");
      expect(configs[1]?.hasSetupScript).toBe(false);
      expect(configs[1]?.hasCleanupScript).toBe(false);
      expect(configs[1]?.actionCount).toBe(0);

      expect(configs[2]?.configPath).toBe(".codex/environments/environment.toml");
      expect(configs[2]?.name).toBe("Studio");
      expect(configs[2]?.hasSetupScript).toBe(true);
      expect(configs[2]?.hasCleanupScript).toBe(true);
      expect(configs[2]?.actionCount).toBe(1);
      expect(configs[2]?.environment?.setup.platformScripts.darwin).toBe("brew bundle");
      expect(configs[2]?.environment?.actions[0]?.icon).toBe("test");

      expect(options.length).toBe(2);
      expect(options[0]?.path).toBe(".codex/environments/environment-2.toml");
      expect(options[0]?.hasCleanupScript).toBe(false);
      expect(options[1]?.path).toBe(".codex/environments/environment.toml");
      expect(options[1]?.hasCleanupScript).toBe(true);
      expect(options[1]?.actionCount).toBe(1);
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("prefers environment.toml in settings snapshots and generates the next config path", async () => {
    const workspacePath = createWorkspace();

    writeEnvironmentFile(workspacePath, "environment.toml", [
      'name = "Preferred"',
      "",
    ].join("\n"));
    writeEnvironmentFile(workspacePath, "environment-2.toml", [
      'name = "Secondary"',
      "",
    ].join("\n"));

    try {
      const snapshot = await readWorktreeEnvironmentSettingsSnapshot({
        projectId: "proj_local_env",
        projectName: "Local env",
        workspacePath,
      });

      expect(snapshot.configPath).toBe(".codex/environments/environment.toml");
      expect(snapshot.configExists).toBe(true);
      expect(snapshot.environment?.name).toBe("Preferred");
      expect(snapshot.nextConfigPath).toBe(".codex/environments/environment-3.toml");
      expect(snapshot.configs.length).toBe(2);
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("saves and re-reads the structured local-environment definition", async () => {
    const workspacePath = createWorkspace();

    try {
      const savedSnapshot = await saveWorktreeEnvironmentSettingsSnapshot({
        projectId: "proj_local_env",
        projectName: "Local env",
        workspacePath,
        configPath: ".codex/environments/environment.toml",
        environment: {
          version: 1,
          name: "Workbench",
          setup: {
            script: "bun install",
            platformScripts: {
              linux: "sudo apt-get update",
            },
          },
          cleanup: {
            script: "git clean -fd",
            platformScripts: {
              win32: "git clean -fdx",
            },
          },
          actions: [
            {
              id: "action-1",
              name: "Run tests",
              icon: "test",
              command: "bun test",
              platform: null,
            },
            {
              id: "action-2",
              name: "Debug app",
              icon: "debug",
              command: "bun run dev",
              platform: "darwin",
            },
          ],
        },
      });

      expect(savedSnapshot.configExists).toBe(true);
      expect(savedSnapshot.environment?.name).toBe("Workbench");
      expect(savedSnapshot.environment?.setup.platformScripts.linux).toBe("sudo apt-get update");
      expect(savedSnapshot.environment?.cleanup.platformScripts.win32).toBe("git clean -fdx");
      expect(savedSnapshot.environment?.actions.length).toBe(2);

      const definition = await readWorktreeEnvironmentDefinition({
        workspacePath,
        environmentPath: ".codex/environments/environment.toml",
      });
      expect(definition.name).toBe("Workbench");
      expect(definition.setupScript).toBe("bun install");

      const raw = fs.readFileSync(path.join(workspacePath, ".codex", "environments", "environment.toml"), "utf8");
      expect(raw.includes("[cleanup]")).toBe(true);
      expect(raw.includes("[[actions]]")).toBe(true);
      expect(raw.includes('icon = "debug"')).toBe(true);
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("prefers the current platform setup script over the generic fallback", async () => {
    const workspacePath = createWorkspace();
    writeEnvironmentFile(workspacePath, "environment.toml", [
      'name = "Platform setup"',
      "",
      "[setup]",
      'script = "generic setup"',
      "",
      "[setup.darwin]",
      'script = "darwin setup"',
      "",
      "[setup.linux]",
      'script = "linux setup"',
      "",
      "[setup.win32]",
      'script = "windows setup"',
      "",
    ].join("\n"));

    try {
      const definition = await readWorktreeEnvironmentDefinition({
        workspacePath,
        environmentPath: ".codex/environments/environment.toml",
      });
      const expected = process.platform === "darwin"
        ? "darwin setup"
        : process.platform === "linux"
          ? "linux setup"
          : process.platform === "win32"
            ? "windows setup"
            : "generic setup";
      expect(definition.setupScript).toBe(expected);
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("serializes actions only when they are complete and rejects paths outside .codex/environments", async () => {
    const serialized = serializeWorktreeEnvironmentDefinition({
      version: 1,
      name: "Local",
      setup: {
        script: null,
        platformScripts: {},
      },
      cleanup: {
        script: null,
        platformScripts: {},
      },
      actions: [
        {
          id: "action-1",
          name: "Run tests",
          icon: "test",
          command: "bun test",
          platform: null,
        },
        {
          id: "action-2",
          name: "",
          icon: "tool",
          command: "",
          platform: null,
        },
      ],
    });

    expect(serialized.includes('name = "Run tests"')).toBe(true);
    expect(serialized.includes('icon = "tool"')).toBe(false);

    const workspacePath = createWorkspace();
    try {
      let failed = false;

      try {
        await readWorktreeEnvironmentDefinition({
          workspacePath,
          environmentPath: "../outside.toml",
        });
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        expect(message.includes("inside .codex/environments")).toBe(true);
      }

      expect(failed).toBe(true);
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("classifies oversized configs before reading or parsing them", async () => {
    const workspacePath = createWorkspace();
    writeEnvironmentFile(
      workspacePath,
      "huge.toml",
      "x".repeat(WORKTREE_ENVIRONMENT_MAX_BYTES + 1),
    );

    try {
      const configs = await listWorktreeEnvironmentConfigs(workspacePath);
      expect(configs[0]?.state).toBe("tooLarge");
      expect(configs[0]?.environment).toBe(null);
      expect(configs[0]?.parseErrorMessage).toBe(null);
      expect(configs[0]?.tooLargeMessage).toContain("exceeds");
      await expect(readWorktreeEnvironmentDefinition({
        workspacePath,
        environmentPath: ".codex/environments/huge.toml",
      })).rejects.toThrow("too large");
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("accepts an exact-size config and rejects oversized parsed fields", async () => {
    const workspacePath = createWorkspace();
    const prefix = 'name = "Boundary"\n';
    writeEnvironmentFile(
      workspacePath,
      "boundary.toml",
      `${prefix}#${"x".repeat(WORKTREE_ENVIRONMENT_MAX_BYTES - Buffer.byteLength(prefix) - 1)}`,
    );
    writeEnvironmentFile(
      workspacePath,
      "oversized-script.toml",
      [
        'name = "Oversized script"',
        "[setup]",
        `script = "${"x".repeat(WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES + 1)}"`,
      ].join("\n"),
    );

    try {
      const configs = await listWorktreeEnvironmentConfigs(workspacePath);
      expect(configs.find((config) => config.configPath.endsWith("boundary.toml"))?.state).toBe("success");
      const invalid = configs.find((config) => config.configPath.endsWith("oversized-script.toml"));
      expect(invalid?.state).toBe("parseError");
      expect(invalid?.parseErrorMessage).toContain("Setup script");
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("enforces field and aggregate limits at the serialization boundary", () => {
    const base = {
      version: 1,
      name: "Local",
      setup: { script: null, platformScripts: {} },
      cleanup: { script: null, platformScripts: {} },
      actions: [],
    } satisfies Parameters<typeof serializeWorktreeEnvironmentDefinition>[0];

    expect(() => serializeWorktreeEnvironmentDefinition({
      ...base,
      setup: {
        script: "x".repeat(WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES + 1),
        platformScripts: {},
      },
    })).toThrow("Setup script");
    expect(() => serializeWorktreeEnvironmentDefinition({
      ...base,
      actions: [{
        id: "action-1",
        name: "Run",
        icon: "run",
        command: "x".repeat(WORKTREE_ENVIRONMENT_ACTION_COMMAND_MAX_BYTES + 1),
        platform: null,
      }],
    })).toThrow("Action 1 command");
    expect(() => serializeWorktreeEnvironmentDefinition({
      ...base,
      actions: Array.from({ length: WORKTREE_ENVIRONMENT_ACTION_MAX_COUNT + 1 }, (_, index) => ({
        id: `action-${index}`,
        name: `Action ${index}`,
        icon: "run" as const,
        command: "true",
        platform: null,
      })),
    })).toThrow("at most 100 actions");
    expect(() => serializeWorktreeEnvironmentDefinition({
      ...base,
      setup: {
        script: "x".repeat(WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES),
        platformScripts: {},
      },
      cleanup: {
        script: "y".repeat(WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES),
        platformScripts: {},
      },
    })).toThrow("Environment file");

    expect(() => serializeWorktreeEnvironmentDefinition({
      ...base,
      name: "n".repeat(WORKTREE_ENVIRONMENT_NAME_MAX_CHARS),
      setup: {
        script: "s".repeat(WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES),
        platformScripts: {},
      },
      actions: [{
        id: "action-boundary",
        name: "a".repeat(WORKTREE_ENVIRONMENT_ACTION_NAME_MAX_CHARS),
        icon: "run",
        command: "c".repeat(WORKTREE_ENVIRONMENT_ACTION_COMMAND_MAX_BYTES),
        platform: null,
      }],
    })).not.toThrow();
    expect(() => serializeWorktreeEnvironmentDefinition({
      ...base,
      actions: Array.from({ length: WORKTREE_ENVIRONMENT_ACTION_MAX_COUNT }, (_, index) => ({
        id: `action-${index}`,
        name: `Action ${index}`,
        icon: "run" as const,
        command: "true",
        platform: null,
      })),
    })).not.toThrow();
  });
});
