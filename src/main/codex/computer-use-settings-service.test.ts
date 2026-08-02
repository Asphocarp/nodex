import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ComputerUseSettingsService } from "./computer-use-settings-service";

const temporaryDirectories: string[] = [];

function createTemporaryHome(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "nodex-computer-use-settings-"));
  temporaryDirectories.push(directory);
  return directory;
}

function approvalsDirectory(homeDirectory: string): string {
  return path.join(
    homeDirectory,
    "Library",
    "Group Containers",
    "2DC432GLL2.com.openai.sky.CUAService",
    "Library",
    "Application Support",
    "Software",
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ComputerUseSettingsService", () => {
  test("projects the target approvals, sound, locked-use, and PiP settings", async () => {
    const homeDirectory = createTemporaryHome();
    const settingsDirectory = approvalsDirectory(homeDirectory);
    mkdirSync(settingsDirectory, { recursive: true });
    writeFileSync(
      path.join(settingsDirectory, "ComputerUseAppApprovals.json"),
      JSON.stringify({
        approvedBundleIdentifiers: ["com.apple.Safari", "com.apple.Safari", ""],
      }),
    );
    writeFileSync(
      path.join(settingsDirectory, "MessagesSendApprovals.json"),
      JSON.stringify({ approvedChats: { guid2: "Work", guid1: "Alice" } }),
    );
    const exec = vi.fn(async (executablePath: string, args: readonly string[]) => {
      if (executablePath === "/usr/bin/defaults") {
        return { stdout: "foregroundAndBackgroundClicks\n", stderr: "" };
      }
      expect(args).toEqual(["status"]);
      return { stdout: "OK: installed\n", stderr: "" };
    });
    let alwaysHide = true;
    const service = new ComputerUseSettingsService({
      alwaysHidePictureInPicture: {
        get: () => alwaysHide,
        set: (value) => { alwaysHide = value; },
      },
      exec: exec as never,
      getRuntimeResult: () => ({
        appPath: "/canonical/Codex Computer Use.app",
        hostServicesPipePath: "/tmp/host.sock",
        serviceExecutablePath: "/canonical/service",
        status: "available",
      }),
      homeDirectory,
      platform: "darwin",
      readConfigRequirements: async () => ({
        requirements: {
          allowedApprovalPolicies: null,
          allowedApprovalsReviewers: null,
          allowedSandboxModes: null,
          allowedWindowsSandboxImplementations: null,
          allowedPermissionProfiles: null,
          defaultPermissions: null,
          allowedWebSearchModes: null,
          allowManagedHooksOnly: null,
          allowAppshots: null,
          allowRemoteControl: null,
          computerUse: { allowLockedComputerUse: true },
          featureRequirements: null,
          hooks: null,
          enforceResidency: null,
          network: null,
          models: null,
        },
      }),
    });

    const snapshot = await service.getSnapshot();

    expect(snapshot).toEqual({
      alwaysHidePictureInPicture: true,
      approvedApps: [{
        bundleIdentifier: "com.apple.Safari",
        displayName: "com.apple.Safari",
      }],
      approvedMessageThreads: [
        { chatGuid: "guid1", displayName: "Alice" },
        { chatGuid: "guid2", displayName: "Work" },
      ],
      available: true,
      lockedUseAllowed: true,
      lockedUseEnabled: true,
      message: null,
      soundMode: "foregroundAndBackgroundClicks",
    });
  });

  test("removes approvals atomically and routes native settings commands", async () => {
    const homeDirectory = createTemporaryHome();
    const settingsDirectory = approvalsDirectory(homeDirectory);
    mkdirSync(settingsDirectory, { recursive: true });
    writeFileSync(
      path.join(settingsDirectory, "ComputerUseAppApprovals.json"),
      JSON.stringify({ approvedBundleIdentifiers: ["one", "two"] }),
    );
    writeFileSync(
      path.join(settingsDirectory, "MessagesSendApprovals.json"),
      JSON.stringify({ approvedChats: { first: "First", second: "Second" } }),
    );
    const exec = vi.fn(async () => ({ stdout: "OK: installed\n", stderr: "" }));
    let alwaysHide = false;
    const service = new ComputerUseSettingsService({
      alwaysHidePictureInPicture: {
        get: () => alwaysHide,
        set: (value) => { alwaysHide = value; },
      },
      exec: exec as never,
      getRuntimeResult: () => ({
        appPath: "/canonical/Codex Computer Use.app",
        hostServicesPipePath: "/tmp/host.sock",
        serviceExecutablePath: "/canonical/service",
        status: "available",
      }),
      homeDirectory,
      platform: "darwin",
      readConfigRequirements: async () => ({
        requirements: {
          allowedApprovalPolicies: null,
          allowedApprovalsReviewers: null,
          allowedSandboxModes: null,
          allowedWindowsSandboxImplementations: null,
          allowedPermissionProfiles: null,
          defaultPermissions: null,
          allowedWebSearchModes: null,
          allowManagedHooksOnly: null,
          allowAppshots: null,
          allowRemoteControl: null,
          computerUse: { allowLockedComputerUse: true },
          featureRequirements: null,
          hooks: null,
          enforceResidency: null,
          network: null,
          models: null,
        },
      }),
    });

    await service.removeAppApproval("one");
    await service.removeMessageApproval("first");
    await service.setAlwaysHidePictureInPicture(true);
    await service.setSoundMode("off");
    await service.setLockedUseEnabled(false);

    expect(JSON.parse(readFileSync(
      path.join(settingsDirectory, "ComputerUseAppApprovals.json"),
      "utf8",
    ))).toEqual({ approvedBundleIdentifiers: ["two"] });
    expect(JSON.parse(readFileSync(
      path.join(settingsDirectory, "MessagesSendApprovals.json"),
      "utf8",
    ))).toEqual({ approvedChats: { second: "Second" } });
    expect(alwaysHide).toBe(true);
    expect(exec).toHaveBeenCalledWith(
      "/usr/bin/defaults",
      ["write", "com.openai.sky.CUAService", "computerUseSoundMode", "off"],
    );
    expect(exec).toHaveBeenCalledWith(
      path.join(
        "/canonical/Codex Computer Use.app",
        "Contents",
        "SharedSupport",
        "Codex Computer Use Installer.app",
        "Contents",
        "MacOS",
        "Codex Computer Use Installer",
      ),
      ["uninstall"],
      { timeout: 120_000 },
    );
  });

  test("fails closed when Locked use is not allowed", async () => {
    const service = new ComputerUseSettingsService({
      alwaysHidePictureInPicture: { get: () => false, set: () => {} },
      exec: vi.fn() as never,
      getRuntimeResult: () => ({
        appPath: "/canonical/Codex Computer Use.app",
        hostServicesPipePath: "/tmp/host.sock",
        serviceExecutablePath: "/canonical/service",
        status: "available",
      }),
      homeDirectory: createTemporaryHome(),
      platform: "darwin",
      readConfigRequirements: async () => ({ requirements: null }),
    });

    await expect(service.setLockedUseEnabled(true)).rejects.toThrow(
      "disabled by configuration requirements",
    );
  });

  test("serializes concurrent approval removals without losing either mutation", async () => {
    const homeDirectory = createTemporaryHome();
    const settingsDirectory = approvalsDirectory(homeDirectory);
    mkdirSync(settingsDirectory, { recursive: true });
    const approvalsPath = path.join(
      settingsDirectory,
      "ComputerUseAppApprovals.json",
    );
    writeFileSync(
      approvalsPath,
      JSON.stringify({ approvedBundleIdentifiers: ["one", "two", "three"] }),
    );
    const service = new ComputerUseSettingsService({
      alwaysHidePictureInPicture: { get: () => false, set: () => {} },
      exec: vi.fn(async () => ({ stdout: "foregroundClicks\n", stderr: "" })) as never,
      getRuntimeResult: () => null,
      homeDirectory,
      platform: "darwin",
      readConfigRequirements: async () => ({ requirements: null }),
    });

    await Promise.all([
      service.removeAppApproval("one"),
      service.removeAppApproval("two"),
    ]);

    expect(JSON.parse(readFileSync(approvalsPath, "utf8"))).toEqual({
      approvedBundleIdentifiers: ["three"],
    });
  });
});
