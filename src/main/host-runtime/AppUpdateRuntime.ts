import { resolve } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type {
  AppUpdateSettings,
  AppUpdateStatus,
  UpdateAppUpdateSettingsInput,
} from "../../shared/types";
import { AppUpdateService } from "../app-update-service";
import { MainConfig } from "../app/MainConfig";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import { getAppUpdateSettings, updateAppUpdateSettings } from "../local-store/config";
import { getLogger } from "../logging/logger";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { ElectronWindowHost } from "../platform/electron/ElectronWindowHost";
import { createPackagedMacAppUpdater } from "../sparkle-mac-app-updater";

export class AppUpdateRuntimeError extends Schema.TaggedError<AppUpdateRuntimeError>()(
  "AppUpdateRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class AppUpdateRuntime extends Context.Service<
  AppUpdateRuntime,
  {
    readonly check: Effect.Effect<AppUpdateStatus, AppUpdateRuntimeError>;
    readonly currentSettings: () => AppUpdateSettings;
    readonly currentStatus: () => AppUpdateStatus;
    readonly install: Effect.Effect<boolean, AppUpdateRuntimeError>;
    readonly markApplicationReady: Effect.Effect<void>;
    readonly startAutomaticChecks: Effect.Effect<void>;
    readonly updateSettings: (
      input: UpdateAppUpdateSettingsInput,
    ) => Effect.Effect<AppUpdateSettings, AppUpdateRuntimeError>;
  }
>()("nodex/main/host-runtime/AppUpdateRuntime") {}

export const live: Layer.Layer<
  AppUpdateRuntime,
  never,
  ElectronApp | ElectronWindowHost | MainConfig | ScopedCallbackRuntime
> = Layer.effect(
  AppUpdateRuntime,
  Effect.gen(function* () {
    const app = yield* ElectronApp;
    const callbacks = yield* ScopedCallbackRuntime;
    const config = yield* MainConfig;
    const windows = yield* ElectronWindowHost;
    const isInApplicationsFolder = yield* app.isInApplicationsFolder;
    const logger = getLogger({ component: "app-update-runtime" });
    let applicationReady = false;
    const updater = (() => {
      if (!config.isPackaged || config.platform !== "darwin") return null;
      if (config.arch !== "arm64" && config.arch !== "x64") return null;
      try {
        return createPackagedMacAppUpdater({
          applicationBundlePath: resolve(config.resourcesPath, "..", ".."),
          architecture: config.arch,
          resourcesPath: config.resourcesPath,
        });
      } catch (cause) {
        logger.error("Packaged app updater is invalid", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return null;
      }
    })();
    const buildDefaultChannel = updater?.getBuildDefaultChannel() ?? "stable";
    const service = new AppUpdateService({
      currentVersion: config.appVersion,
      isInApplicationsFolder,
      isPackaged: config.isPackaged,
      logger,
      platform: config.platform as NodeJS.Platform,
      updater,
      initialSettings: getAppUpdateSettings(buildDefaultChannel),
      persistSettings: (input) => updateAppUpdateSettings(input, buildDefaultChannel),
    });
    const releaseStatus = service.onStatusChange((status) => {
      callbacks.fork(
        windows.all.pipe(
          Effect.tap((all) =>
            Effect.sync(() => safeBroadcastToWindows(all, "app:update-status", [status])),
          ),
          Effect.asVoid,
        ),
      );
    });
    service.initialize();
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        releaseStatus();
        yield* Effect.tryPromise({
          try: () => service.dispose(),
          catch: (cause) => new AppUpdateRuntimeError({ operation: "dispose", cause }),
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not dispose the app updater").pipe(
              Effect.annotateLogs({ error: String(error.cause) }),
            ),
          ),
        );
      }),
    );

    const startAutomaticChecks = Effect.gen(function* () {
      if (!applicationReady) return;
      const all = yield* windows.all;
      if (all.length === 0) return;
      yield* Effect.sync(() => service.maybeStartAutomaticChecks());
    });

    return AppUpdateRuntime.of({
      check: Effect.tryPromise({
        try: () => service.checkForUpdates("manual"),
        catch: (cause) => new AppUpdateRuntimeError({ operation: "check", cause }),
      }),
      currentSettings: () => service.getSettings(),
      currentStatus: () => service.getStatus(),
      install: Effect.tryPromise({
        try: () => service.installUpdateAndRestart(),
        catch: (cause) => new AppUpdateRuntimeError({ operation: "install", cause }),
      }),
      markApplicationReady: Effect.sync(() => {
        applicationReady = true;
      }).pipe(Effect.andThen(startAutomaticChecks)),
      startAutomaticChecks,
      updateSettings: (input) =>
        Effect.tryPromise({
          try: () => service.updateSettings(input),
          catch: (cause) => new AppUpdateRuntimeError({ operation: "update-settings", cause }),
        }).pipe(Effect.tap(() => startAutomaticChecks)),
    });
  }),
);
