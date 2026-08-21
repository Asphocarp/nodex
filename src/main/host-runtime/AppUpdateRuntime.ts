import { resolve } from "node:path";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type {
  AppUpdateSettings,
  AppUpdateStatus,
  UpdateAppUpdateSettingsInput,
} from "../../shared/types";
import { MainConfig, type MainConfigValue } from "../app/MainConfig";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import { getAppUpdateSettings, updateAppUpdateSettings } from "../local-store/config";
import { getLogger } from "../logging/logger";
import type { MacAppUpdater, MacAppUpdaterEvent } from "../mac-app-updater";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { ElectronWindowHost } from "../platform/electron/ElectronWindowHost";
import { createPackagedMacAppUpdater } from "../sparkle-mac-app-updater";
import {
  initialAppUpdateState,
  reduceAppUpdateStatus,
  resetStatusForChannel,
  withChannelChangeAvailability,
  type AppUpdateRuntimeState,
} from "./AppUpdatePolicy";

export class AppUpdateRuntimeError extends Schema.TaggedError<AppUpdateRuntimeError>()(
  "AppUpdateRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class AppUpdateRuntime extends Context.Service<
  AppUpdateRuntime,
  {
    readonly check: Effect.Effect<AppUpdateStatus, AppUpdateRuntimeError>;
    readonly currentSettings: Effect.Effect<AppUpdateSettings>;
    readonly currentStatus: Effect.Effect<AppUpdateStatus>;
    readonly install: Effect.Effect<boolean, AppUpdateRuntimeError>;
    readonly markApplicationReady: Effect.Effect<void>;
    readonly startAutomaticChecks: Effect.Effect<void, AppUpdateRuntimeError>;
    readonly updateSettings: (
      input: UpdateAppUpdateSettingsInput,
    ) => Effect.Effect<AppUpdateSettings, AppUpdateRuntimeError>;
  }
>()("nodex/main/host-runtime/AppUpdateRuntime") {}

export interface AppUpdateRuntimeOptions {
  readonly createUpdater?: (config: MainConfigValue) => MacAppUpdater | null;
  readonly readSettings?: (buildDefaultChannel: AppUpdateSettings["channel"]) => AppUpdateSettings;
  readonly persistSettings?: (
    input: UpdateAppUpdateSettingsInput,
    buildDefaultChannel: AppUpdateSettings["channel"],
  ) => AppUpdateSettings;
}

const createUpdater = (config: MainConfigValue): MacAppUpdater | null => {
  if (!config.isPackaged || config.platform !== "darwin") return null;
  if (config.arch !== "arm64" && config.arch !== "x64") return null;
  return createPackagedMacAppUpdater({
    applicationBundlePath: resolve(config.resourcesPath, "..", ".."),
    architecture: config.arch,
    resourcesPath: config.resourcesPath,
  });
};

const fromUpdater = <A>(operation: string, task: () => Promise<A>) =>
  Effect.tryPromise({
    try: task,
    catch: (cause) => new AppUpdateRuntimeError({ operation, cause }),
  });

export const layer = (
  options: AppUpdateRuntimeOptions = {},
): Layer.Layer<
  AppUpdateRuntime,
  never,
  ElectronApp | ElectronWindowHost | MainConfig | ScopedCallbackRuntime
> =>
  Layer.effect(
    AppUpdateRuntime,
    Effect.gen(function* () {
      const app = yield* ElectronApp;
      const callbacks = yield* ScopedCallbackRuntime;
      const config = yield* MainConfig;
      const windows = yield* ElectronWindowHost;
      const isInApplicationsFolder = yield* app.isInApplicationsFolder;
      const logger = getLogger({ component: "app-update-runtime" });
      const updater = yield* Effect.sync(() => {
        try {
          return (options.createUpdater ?? createUpdater)(config);
        } catch (cause) {
          logger.error("Packaged app updater is invalid", {
            error: cause instanceof Error ? cause.message : String(cause),
          });
          return null;
        }
      });
      const buildDefaultChannel = updater?.getBuildDefaultChannel() ?? "stable";
      const settings = (options.readSettings ?? getAppUpdateSettings)(buildDefaultChannel);
      const state = yield* Ref.make<AppUpdateRuntimeState>(
        initialAppUpdateState({
          buildDefaultChannel,
          currentVersion: config.appVersion,
          isInApplicationsFolder,
          isPackaged: config.isPackaged,
          platform: config.platform as NodeJS.Platform,
          settings,
          updaterAvailable: updater !== null,
        }),
      );
      const lock = yield* Semaphore.make(1);

      const checkedNow = Clock.currentTimeMillis.pipe(
        Effect.map((milliseconds) => new Date(milliseconds).toISOString()),
      );

      const publishStatus = Effect.fn("AppUpdateRuntime.publishStatus")(function* (
        nextStatus: AppUpdateStatus,
      ) {
        const current = yield* Ref.get(state);
        const status = withChannelChangeAvailability(nextStatus, current.errorAllowsChannelChange);
        yield* Ref.update(state, (value) => ({ ...value, status }));
        const all = yield* windows.all;
        yield* Effect.sync(() => safeBroadcastToWindows(all, "app:update-status", [status]));
        return status;
      });

      const publishError = Effect.fn("AppUpdateRuntime.publishError")(function* (
        error: AppUpdateRuntimeError,
      ) {
        const current = yield* Ref.get(state);
        const checkedAt = yield* checkedNow;
        return yield* publishStatus({
          ...current.status,
          checkedAt,
          message: error.cause instanceof Error ? error.cause.message : String(error.cause),
          status: "error",
        });
      });

      const handleEvent = Effect.fn("AppUpdateRuntime.handleEvent")(function* (
        event: MacAppUpdaterEvent,
      ) {
        yield* Ref.update(state, (current) => ({
          ...current,
          errorAllowsChannelChange: event.type === "error" && event.recoverable,
        }));
        if (event.type === "error") {
          yield* Effect.sync(() => {
            logger.error("App updater emitted an error", {
              code: event.code,
              message: event.message,
              recoverable: event.recoverable,
            });
          });
        }
        const current = yield* Ref.get(state);
        const checkedAt = yield* checkedNow;
        yield* publishStatus(reduceAppUpdateStatus(current.status, event, checkedAt));
      });
      const admitEvent = (event: MacAppUpdaterEvent): void => {
        callbacks.fork(lock.withPermits(1)(handleEvent(event)));
      };

      const initialize = yield* Effect.cached(
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          if (!current.status.supported || updater === null) return;
          yield* fromUpdater("initialize-channel", () =>
            updater.setChannel(current.settings.channel),
          );
          yield* fromUpdater("initialize-updater", () => updater.start(admitEvent));
          yield* Effect.sync(() => {
            logger.info("App updater initialized", {
              currentVersion: config.appVersion,
              platform: config.platform,
            });
          });
        }).pipe(
          Effect.tapError((error) =>
            Effect.gen(function* () {
              yield* Effect.sync(() => {
                logger.error("App updater initialization failed", { error: error.cause });
              });
              yield* publishError(error);
            }),
          ),
        ),
      );

      const check = Effect.fn("AppUpdateRuntime.check")(function* (
        reason: "startup" | "manual" = "manual",
      ) {
        const initialized = yield* Effect.result(initialize);
        if (Result.isFailure(initialized)) return (yield* Ref.get(state)).status;
        const current = yield* Ref.get(state);
        if (!current.status.supported || updater === null) return current.status;
        if (
          current.status.status === "checking" ||
          current.status.status === "downloading" ||
          current.status.status === "downloaded" ||
          current.status.status === "installing"
        ) {
          return current.status;
        }
        yield* Effect.sync(() => {
          logger.info("Checking for app updates", {
            currentVersion: config.appVersion,
            reason,
          });
        });
        const checkedAt = yield* checkedNow;
        yield* publishStatus(
          reduceAppUpdateStatus(
            current.status,
            { kind: reason === "startup" ? "background" : "user", type: "check-started" },
            checkedAt,
          ),
        );
        const result = yield* Effect.result(
          fromUpdater("check-for-updates", () =>
            updater.check(reason === "startup" ? "background" : "user"),
          ),
        );
        if (Result.isFailure(result)) {
          yield* Effect.sync(() => {
            logger.error("App update check failed", { error: result.failure.cause, reason });
          });
          yield* publishError(result.failure);
        }
        return (yield* Ref.get(state)).status;
      });
      const serializedCheck = (reason: "startup" | "manual" = "manual") =>
        lock.withPermits(1)(check(reason));

      const install = lock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          if (updater === null || current.status.status !== "downloaded") return false;
          yield* Effect.sync(() => {
            logger.info("Installing downloaded app update", {
              version: current.status.availableVersion,
            });
          });
          const checkedAt = yield* checkedNow;
          yield* publishStatus(
            reduceAppUpdateStatus(current.status, { type: "installing" }, checkedAt),
          );
          const result = yield* Effect.result(
            fromUpdater("install-downloaded-update", () => updater.installDownloadedUpdate()),
          );
          if (Result.isSuccess(result)) return true;
          yield* Effect.sync(() => {
            logger.error("Could not install downloaded app update", {
              error: result.failure.cause,
            });
          });
          yield* publishError(result.failure);
          return false;
        }),
      );

      const startAutomaticChecks = Effect.fn("AppUpdateRuntime.startAutomaticChecks")(function* () {
        const all = yield* windows.all;
        if (all.length === 0) return;
        const shouldStart = yield* lock.withPermits(1)(
          Ref.modify(state, (current) => {
            const start =
              current.applicationReady &&
              current.settings.automaticChecksEnabled &&
              !current.automaticCheckStarted;
            return [start, start ? { ...current, automaticCheckStarted: true } : current];
          }),
        );
        if (!shouldStart) return;
        yield* serializedCheck("startup");
      });

      const updateSettings = Effect.fn("AppUpdateRuntime.updateSettings")(function* (
        input: UpdateAppUpdateSettingsInput,
      ) {
        const persisted = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Ref.get(state);
            const next = { ...current.settings, ...input };
            const channelChanged = next.channel !== current.settings.channel;
            if (channelChanged && !current.status.channelChangeAllowed) {
              return yield* new AppUpdateRuntimeError({
                operation: "update-settings",
                cause: new Error("Update channel cannot change during an update session."),
              });
            }
            if (channelChanged && updater !== null) {
              yield* initialize;
              yield* fromUpdater("set-update-channel", () => updater.setChannel(next.channel));
            }
            const persisted = yield* Effect.try({
              try: () =>
                (options.persistSettings ?? updateAppUpdateSettings)(input, buildDefaultChannel),
              catch: (cause) =>
                new AppUpdateRuntimeError({ operation: "persist-update-settings", cause }),
            }).pipe(
              Effect.tapError(() =>
                channelChanged && updater !== null
                  ? fromUpdater("rollback-update-channel", () =>
                      updater.setChannel(current.settings.channel),
                    ).pipe(Effect.ignore)
                  : Effect.void,
              ),
            );
            yield* Ref.update(state, (value) => ({
              ...value,
              automaticCheckStarted: channelChanged ? false : value.automaticCheckStarted,
              settings: persisted,
            }));
            if (channelChanged) {
              const latest = yield* Ref.get(state);
              yield* publishStatus(resetStatusForChannel(latest.status, persisted.channel));
            }
            return persisted;
          }),
        );
        yield* startAutomaticChecks();
        return persisted;
      });

      if (updater !== null) {
        yield* Effect.addFinalizer(() =>
          fromUpdater("dispose-updater", () => updater.dispose()).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not dispose the app updater").pipe(
                Effect.annotateLogs({ error: String(error.cause) }),
              ),
            ),
          ),
        );
      }
      yield* lock.withPermits(1)(initialize).pipe(Effect.ignore, Effect.forkScoped);

      return AppUpdateRuntime.of({
        check: serializedCheck(),
        currentSettings: Ref.get(state).pipe(Effect.map((current) => current.settings)),
        currentStatus: Ref.get(state).pipe(Effect.map((current) => current.status)),
        install,
        markApplicationReady: Ref.update(state, (current) => ({
          ...current,
          applicationReady: true,
        })).pipe(Effect.andThen(startAutomaticChecks())),
        startAutomaticChecks: startAutomaticChecks(),
        updateSettings,
      });
    }),
  );

export const live = layer();
