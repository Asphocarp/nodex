import { app, BrowserWindow, dialog } from "electron";
import { configureInstanceScopePaths } from "./instance-scope";
import { resolveBootstrapKanbanDir } from "./bootstrap-config";
import { BootstrapRuntimeEventQueue } from "./bootstrap-events";
import { writeBootstrapLog } from "./bootstrap-log";
import { getDiagnosticsSettings } from "./kanban/config";
import {
  captureMainException,
  initializeMainSentry,
} from "./observability/sentry-main";
import { electronMainSentryAdapter } from "./observability/sentry-electron-main-adapter";
import {
  runMacApplicationsInstallerGate,
  type MacApplicationsInstallerEnvironment,
} from "./macos-applications-installer";
import type { MainRuntimeController } from "./main-runtime";

process.env.NODEX_INTERNAL_APP_PACKAGED = app.isPackaged ? "true" : "false";

const kanbanDir = resolveBootstrapKanbanDir();
configureInstanceScopePaths(app, kanbanDir);

const runtimeQueue = new BootstrapRuntimeEventQueue();

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  return fallback;
}

function logBootstrap(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const defaultSinkEnabled = !app.isPackaged;
  writeBootstrapLog(kanbanDir, level, message, fields, {
    consoleEnabled: parseBooleanEnv(process.env.NODEX_LOG_CONSOLE, defaultSinkEnabled),
    fileEnabled: parseBooleanEnv(process.env.NODEX_LOG_FILE, defaultSinkEnabled),
  });
}

function initializeBootstrapDiagnostics(): Promise<boolean> {
  try {
    return initializeMainSentry({
      appVersion: app.getVersion(),
      arch: process.arch,
      isPackaged: app.isPackaged,
      platform: process.platform,
      settings: getDiagnosticsSettings(),
      adapter: electronMainSentryAdapter,
    }).catch((error: unknown) => {
      logBootstrap("warn", "Sentry diagnostics failed to initialize", { error });
      return false;
    });
  } catch (error) {
    logBootstrap("warn", "Sentry diagnostics failed to initialize", { error });
    return Promise.resolve(false);
  }
}

const mainSentryInitialization = initializeBootstrapDiagnostics();

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
  captureMainException(error, {
    tags: { phase: "startup" },
  });

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
  await mainSentryInitialization;

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
    captureMainException(error, {
      tags: { phase: "bootstrap", kind: "uncaughtException" },
    });
  });

  process.on("unhandledRejection", (reason) => {
    logBootstrap("error", "Unhandled rejection before runtime startup", { reason });
    captureMainException(reason, {
      tags: { phase: "bootstrap", kind: "unhandledRejection" },
    });
  });

  app.whenReady()
    .then(startRuntime)
    .catch((error: unknown) => {
      void handleStartupFailure(error);
    });
}
