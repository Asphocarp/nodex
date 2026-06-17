import { app, BrowserWindow, dialog } from "electron";
import { configureInstanceScopePaths } from "./instance-scope";
import { resolveBootstrapKanbanDir } from "./bootstrap-config";
import { BootstrapRuntimeEventQueue } from "./bootstrap-events";
import { writeBootstrapLog } from "./bootstrap-log";
import {
  runMacApplicationsInstallerGate,
  type MacApplicationsInstallerEnvironment,
} from "./macos-applications-installer";
import type { MainRuntimeController } from "./main-runtime";

const kanbanDir = resolveBootstrapKanbanDir();
configureInstanceScopePaths(app, kanbanDir);

const runtimeQueue = new BootstrapRuntimeEventQueue();

function logBootstrap(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  writeBootstrapLog(kanbanDir, level, message, fields);
}

function formatStartupError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function createMacApplicationsInstallerEnvironment(): MacApplicationsInstallerEnvironment {
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    isInApplicationsFolder: () => {
      if (typeof app.isInApplicationsFolder !== "function") return true;
      return app.isInApplicationsFolder();
    },
    showInstallPrompt: async () => {
      const response = await dialog.showMessageBox({
        type: "question",
        buttons: ["Move to Applications", "Continue Anyway", "Quit"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        message: "Move Nodex to Applications?",
        detail:
          "Nodex is running from outside the Applications folder. Moving it to Applications improves launch, update, and permission behavior on macOS.",
      });

      if (response.response === 0) return "move";
      if (response.response === 1) return "continue";
      return "quit";
    },
    showMoveFailedPrompt: async (error) => {
      const response = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Continue Anyway", "Quit"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: "Nodex could not move itself to Applications.",
        detail:
          error instanceof Error
            ? error.message
            : "You can continue from the current location or quit and move Nodex manually.",
      });

      return response.response === 0 ? "continue" : "quit";
    },
    confirmMoveConflict: () => {
      const response = dialog.showMessageBoxSync({
        type: "warning",
        buttons: ["Cancel Move", "Replace Existing App"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: "Replace the existing Nodex app in Applications?",
        detail: "A copy of Nodex already exists in the Applications folder.",
      });

      return response === 1;
    },
    moveToApplicationsFolder: (options) => app.moveToApplicationsFolder(options),
    log: logBootstrap,
  };
}

async function handleStartupFailure(error: unknown): Promise<void> {
  logBootstrap("error", "Nodex failed to start", { error });

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.destroy();
  }

  await dialog.showMessageBox({
    type: "error",
    buttons: ["Quit"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: "Nodex failed to start",
    detail: formatStartupError(error),
  });

  app.quit();
}

async function startRuntime(): Promise<void> {
  const installerResult = await runMacApplicationsInstallerGate(
    createMacApplicationsInstallerEnvironment(),
  );

  if (installerResult === "quit") {
    app.quit();
    return;
  }
  if (installerResult === "moved") {
    return;
  }

  const startupEvents = runtimeQueue.takePendingEvents();
  const { runMainAppStartup } = await import("./main-runtime");
  const controller: MainRuntimeController = await runMainAppStartup({
    initialArgv: process.argv,
    startupEvents,
  });
  await runtimeQueue.attachController(controller);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logBootstrap("info", "Another Nodex instance already owns this profile");
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    void runtimeQueue.enqueueSecondInstance(argv);
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    void runtimeQueue.enqueueOpenUrl(url);
  });

  process.on("uncaughtException", (error) => {
    logBootstrap("error", "Uncaught exception before runtime startup", { error });
  });

  process.on("unhandledRejection", (reason) => {
    logBootstrap("error", "Unhandled rejection before runtime startup", { reason });
  });

  app.whenReady()
    .then(startRuntime)
    .catch((error: unknown) => {
      void handleStartupFailure(error);
    });
}
