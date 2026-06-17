import { describe, expect, test } from "bun:test";
import {
  runMacApplicationsInstallerGate,
  type MacApplicationsInstallerEnvironment,
  type MacApplicationsInstallerPromptChoice,
} from "./macos-applications-installer";

function makeEnvironment(
  overrides: Partial<MacApplicationsInstallerEnvironment> = {},
): MacApplicationsInstallerEnvironment {
  return {
    platform: "darwin",
    isPackaged: true,
    isInApplicationsFolder: () => false,
    showInstallPrompt: async () => "continue",
    showMoveFailedPrompt: async () => "quit",
    moveToApplicationsFolder: () => false,
    ...overrides,
  };
}

describe("runMacApplicationsInstallerGate", () => {
  test("skips non-mac, unpackaged, and already-installed launches", async () => {
    expect(await runMacApplicationsInstallerGate(makeEnvironment({ platform: "linux" }))).toBe("continue");
    expect(await runMacApplicationsInstallerGate(makeEnvironment({ isPackaged: false }))).toBe("continue");
    expect(await runMacApplicationsInstallerGate(makeEnvironment({ isInApplicationsFolder: () => true }))).toBe("continue");
  });

  test("honors continue and quit prompt choices", async () => {
    expect(await runMacApplicationsInstallerGate(makeEnvironment({
      showInstallPrompt: async () => "continue",
    }))).toBe("continue");
    expect(await runMacApplicationsInstallerGate(makeEnvironment({
      showInstallPrompt: async () => "quit",
    }))).toBe("quit");
  });

  test("moves to Applications and forwards conflict handling", async () => {
    let conflictHandlerResult = false;
    const result = await runMacApplicationsInstallerGate(makeEnvironment({
      showInstallPrompt: async () => "move",
      confirmMoveConflict: () => true,
      moveToApplicationsFolder: (options) => {
        conflictHandlerResult = options.conflictHandler?.("exists") ?? false;
        return true;
      },
    }));

    expect(result).toBe("moved");
    expect(conflictHandlerResult).toBeTrue();
  });

  test("uses the failed-move prompt when move returns false or throws", async () => {
    const failedChoices: MacApplicationsInstallerPromptChoice[] = [];
    const returnedFalse = await runMacApplicationsInstallerGate(makeEnvironment({
      showInstallPrompt: async () => "move",
      showMoveFailedPrompt: async () => {
        failedChoices.push("continue");
        return "continue";
      },
      moveToApplicationsFolder: () => false,
    }));
    const threw = await runMacApplicationsInstallerGate(makeEnvironment({
      showInstallPrompt: async () => "move",
      showMoveFailedPrompt: async () => {
        failedChoices.push("quit");
        return "quit";
      },
      moveToApplicationsFolder: () => {
        throw new Error("copy failed");
      },
    }));

    expect(returnedFalse).toBe("continue");
    expect(threw).toBe("quit");
    expect(failedChoices.join("|")).toBe("continue|quit");
  });
});
