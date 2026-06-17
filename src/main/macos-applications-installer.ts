export type MacApplicationsInstallerPromptChoice = "move" | "continue" | "quit";
export type MacApplicationsInstallerResult = "continue" | "quit" | "moved";

export interface MoveToApplicationsFolderOptions {
  conflictHandler?: (conflictType: string) => boolean;
}

export interface MacApplicationsInstallerEnvironment {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  isInApplicationsFolder: () => boolean;
  showInstallPrompt: () => Promise<MacApplicationsInstallerPromptChoice>;
  showMoveFailedPrompt: (error: unknown) => Promise<Exclude<MacApplicationsInstallerPromptChoice, "move">>;
  moveToApplicationsFolder: (options: MoveToApplicationsFolderOptions) => boolean;
  confirmMoveConflict?: (conflictType: string) => boolean;
  log?: (level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>) => void;
}

export async function runMacApplicationsInstallerGate(
  environment: MacApplicationsInstallerEnvironment,
): Promise<MacApplicationsInstallerResult> {
  if (environment.platform !== "darwin" || !environment.isPackaged) {
    return "continue";
  }

  if (environment.isInApplicationsFolder()) {
    return "continue";
  }

  const choice = await environment.showInstallPrompt();
  if (choice === "continue") {
    environment.log?.("info", "Continuing packaged macOS launch outside Applications");
    return "continue";
  }
  if (choice === "quit") {
    environment.log?.("info", "User quit packaged macOS launch outside Applications");
    return "quit";
  }

  try {
    const moved = environment.moveToApplicationsFolder({
      conflictHandler: environment.confirmMoveConflict,
    });
    if (moved) {
      environment.log?.("info", "Moving app to Applications");
      return "moved";
    }

    environment.log?.("warn", "Move to Applications was cancelled");
    return await environment.showMoveFailedPrompt(null);
  } catch (error) {
    environment.log?.("error", "Move to Applications failed", { error });
    return await environment.showMoveFailedPrompt(error);
  }
}
