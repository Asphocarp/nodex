import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import type { WorktreeEnvironmentDefinition } from "../../shared/types";
import { WORKTREE_ENVIRONMENT_MAX_BYTES } from "./worktree-environment-codec";
import {
  listWorktreeEnvironmentConfigs,
  listWorktreeEnvironmentOptions,
  readWorktreeEnvironmentDefinition,
  readWorktreeEnvironmentSettingsSnapshot,
  saveWorktreeEnvironmentConfigFile as saveWorktreeEnvironmentConfigFileTransaction,
} from "./worktree-environment-service";

const saveWorktreeEnvironmentConfigFile = (
  input: Parameters<typeof saveWorktreeEnvironmentConfigFileTransaction>[0],
) => saveWorktreeEnvironmentConfigFileTransaction(input);

function createWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nodex-worktree-env-"));
}

function removeWorkspace(workspacePath: string): void {
  fs.rmSync(workspacePath, { recursive: true, force: true });
}

function environmentPath(workspacePath: string, fileName = "environment.toml"): string {
  return path.join(workspacePath, ".codex", "environments", fileName);
}

function writeEnvironmentFile(workspacePath: string, fileName: string, contents: string): void {
  const absolutePath = environmentPath(workspacePath, fileName);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
}

function makeEnvironment(name: string): WorktreeEnvironmentDefinition {
  return {
    version: 1,
    name,
    setup: { script: "bun install", platformScripts: { linux: "pnpm install" } },
    cleanup: { script: null, platformScripts: {} },
    actions: [
      {
        name: "Test",
        icon: "test",
        command: "bun test",
        platform: null,
      },
    ],
  };
}

function referenceRaw(name: string): string {
  return [
    "version = 1",
    `name = ${JSON.stringify(name)}`,
    "[setup]",
    'script = "bun install"',
    "",
  ].join("\n");
}

function revisionFor(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

describe("worktree-environment-service", () => {
  test("lists strict configs and options with local-environment metadata", async () => {
    const workspacePath = createWorkspace();
    writeEnvironmentFile(
      workspacePath,
      "environment.toml",
      [
        "version = 1",
        'name = "Studio"',
        "[setup]",
        'script = "bun install"',
        "[cleanup]",
        'script = "git clean -fd"',
        "[[actions]]",
        'name = "Run tests"',
        'icon = "test"',
        'command = "bun test"',
        "",
      ].join("\n"),
    );
    writeEnvironmentFile(
      workspacePath,
      "environment-2.toml",
      ['name = "Plain"', "[setup]", 'script = ""', ""].join("\n"),
    );
    writeEnvironmentFile(workspacePath, "broken.toml", "name = ");

    try {
      const configs = await listWorktreeEnvironmentConfigs(workspacePath);
      const options = await listWorktreeEnvironmentOptions(workspacePath);

      expect(configs.map((config) => config.state)).toEqual(["parseError", "success", "success"]);
      expect(configs[1]).toMatchObject({
        configPath: ".codex/environments/environment-2.toml",
        name: "Plain",
        hasSetupScript: false,
        hasCleanupScript: false,
        actionCount: 0,
      });
      expect(configs[2]).toMatchObject({
        configPath: ".codex/environments/environment.toml",
        name: "Studio",
        hasSetupScript: true,
        hasCleanupScript: true,
        actionCount: 1,
      });
      expect(options.map((option) => option.name)).toEqual(["Plain", "Studio"]);
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("returns the selected raw sha256 revision, including parse errors", async () => {
    const workspacePath = createWorkspace();
    const validRaw = referenceRaw("Preferred");
    writeEnvironmentFile(workspacePath, "environment.toml", validRaw);
    writeEnvironmentFile(workspacePath, "broken.toml", "name = ");

    try {
      const snapshot = await readWorktreeEnvironmentSettingsSnapshot({
        projectId: "project",
        projectName: "Project",
        workspacePath,
      });
      expect(snapshot).toMatchObject({
        configPath: ".codex/environments/environment.toml",
        configExists: true,
        revision: revisionFor(validRaw),
        nextConfigPath: ".codex/environments/environment-2.toml",
      });

      const brokenSnapshot = await readWorktreeEnvironmentSettingsSnapshot({
        projectId: "project",
        projectName: "Project",
        workspacePath,
        configPath: ".codex/environments/broken.toml",
      });
      expect(brokenSnapshot.environment).toBeNull();
      expect(brokenSnapshot.parseErrorMessage).not.toBeNull();
      expect(brokenSnapshot.revision).toBe(revisionFor("name = "));
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("uses exclusive create and treats identical retries as idempotent", async () => {
    const workspacePath = createWorkspace();
    const input = {
      projectId: "project",
      workspacePath,
      configPath: ".codex/environments/environment.toml",
      expectedRevision: null,
      environment: makeEnvironment("Created"),
    };

    try {
      await expect(saveWorktreeEnvironmentConfigFile(input)).resolves.toEqual({ type: "success" });
      await expect(saveWorktreeEnvironmentConfigFile(input)).resolves.toEqual({ type: "success" });
      await expect(
        saveWorktreeEnvironmentConfigFile({
          ...input,
          environment: makeEnvironment("Different"),
        }),
      ).resolves.toEqual({ type: "conflict" });
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("rejects stale external edits but permits idempotent and matching-revision saves", async () => {
    const workspacePath = createWorkspace();
    writeEnvironmentFile(workspacePath, "environment.toml", referenceRaw("Initial"));

    try {
      const initial = await readWorktreeEnvironmentSettingsSnapshot({
        projectId: "project",
        projectName: "Project",
        workspacePath,
      });
      const updated = makeEnvironment("Updated");
      await expect(
        saveWorktreeEnvironmentConfigFile({
          projectId: "project",
          workspacePath,
          configPath: initial.configPath,
          expectedRevision: initial.revision,
          environment: updated,
        }),
      ).resolves.toEqual({ type: "success" });

      await expect(
        saveWorktreeEnvironmentConfigFile({
          projectId: "project",
          workspacePath,
          configPath: initial.configPath,
          expectedRevision: initial.revision,
          environment: updated,
        }),
      ).resolves.toEqual({ type: "success" });

      fs.writeFileSync(environmentPath(workspacePath), referenceRaw("External"), "utf8");
      await expect(
        saveWorktreeEnvironmentConfigFile({
          projectId: "project",
          workspacePath,
          configPath: initial.configPath,
          expectedRevision: initial.revision,
          environment: makeEnvironment("Stale"),
        }),
      ).resolves.toEqual({ type: "conflict" });
      expect(fs.readFileSync(environmentPath(workspacePath), "utf8")).toBe(
        referenceRaw("External"),
      );
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("allows an explicit matching revision to replace a parse error", async () => {
    const workspacePath = createWorkspace();
    writeEnvironmentFile(workspacePath, "broken.toml", "name = ");

    try {
      const snapshot = await readWorktreeEnvironmentSettingsSnapshot({
        projectId: "project",
        projectName: "Project",
        workspacePath,
        configPath: ".codex/environments/broken.toml",
      });
      await expect(
        saveWorktreeEnvironmentConfigFile({
          projectId: "project",
          workspacePath,
          configPath: snapshot.configPath,
          expectedRevision: snapshot.revision,
          environment: makeEnvironment("Repaired"),
        }),
      ).resolves.toEqual({ type: "success" });
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("keeps oversized files non-overwritable without a revision", async () => {
    const workspacePath = createWorkspace();
    writeEnvironmentFile(
      workspacePath,
      "huge.toml",
      "x".repeat(WORKTREE_ENVIRONMENT_MAX_BYTES + 1),
    );

    try {
      const snapshot = await readWorktreeEnvironmentSettingsSnapshot({
        projectId: "project",
        projectName: "Project",
        workspacePath,
        configPath: ".codex/environments/huge.toml",
      });
      expect(snapshot.revision).toBeNull();
      await expect(
        saveWorktreeEnvironmentConfigFile({
          projectId: "project",
          workspacePath,
          configPath: snapshot.configPath,
          expectedRevision: snapshot.revision,
          environment: makeEnvironment("Unsafe"),
        }),
      ).resolves.toEqual({ type: "conflict" });
    } finally {
      removeWorkspace(workspacePath);
    }
  });

  test("rejects traversal and symlink escapes on read and write", async () => {
    const workspacePath = createWorkspace();
    const outsidePath = createWorkspace();
    fs.mkdirSync(path.join(workspacePath, ".codex"), { recursive: true });
    fs.symlinkSync(outsidePath, path.join(workspacePath, ".codex", "environments"));

    try {
      await expect(
        readWorktreeEnvironmentDefinition({
          workspacePath,
          environmentPath: "../outside.toml",
        }),
      ).rejects.toThrow("inside .codex/environments");
      await expect(
        saveWorktreeEnvironmentConfigFile({
          projectId: "project",
          workspacePath,
          configPath: ".codex/environments/environment.toml",
          expectedRevision: null,
          environment: makeEnvironment("Escape"),
        }),
      ).rejects.toThrow("inside the workspace");
      expect(fs.existsSync(path.join(outsidePath, "environment.toml"))).toBe(false);
    } finally {
      removeWorkspace(workspacePath);
      removeWorkspace(outsidePath);
    }
  });

  test("rejects a target-file symlink that escapes an otherwise safe environment root", async () => {
    const workspacePath = createWorkspace();
    const outsidePath = path.join(createWorkspace(), "outside.toml");
    fs.writeFileSync(outsidePath, referenceRaw("Outside"), "utf8");
    fs.mkdirSync(path.dirname(environmentPath(workspacePath)), { recursive: true });
    fs.symlinkSync(outsidePath, environmentPath(workspacePath));

    try {
      await expect(
        saveWorktreeEnvironmentConfigFile({
          projectId: "project",
          workspacePath,
          configPath: ".codex/environments/environment.toml",
          expectedRevision: null,
          environment: makeEnvironment("Escape"),
        }),
      ).rejects.toThrow("inside .codex/environments");
      expect(fs.readFileSync(outsidePath, "utf8")).toBe(referenceRaw("Outside"));
    } finally {
      removeWorkspace(workspacePath);
      removeWorkspace(path.dirname(outsidePath));
    }
  });

  test("resolves the current platform setup script with default fallback", async () => {
    const workspacePath = createWorkspace();
    writeEnvironmentFile(
      workspacePath,
      "environment.toml",
      [
        'name = "Platform setup"',
        "[setup]",
        'script = "generic setup"',
        "[setup.darwin]",
        'script = "darwin setup"',
        "[setup.linux]",
        'script = "linux setup"',
        "[setup.win32]",
        'script = "windows setup"',
        "",
      ].join("\n"),
    );

    try {
      const definition = await readWorktreeEnvironmentDefinition({
        workspacePath,
        environmentPath: ".codex/environments/environment.toml",
      });
      const expected =
        process.platform === "darwin"
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
});
