import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type { BrowserUsePeerAuthorizationMode } from "../../shared/browser-use-host-capability";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { BrowserRuntimeAvailability } from "../codex/browser-runtime-bundle";
import type { ComputerUseRuntimeConfigInput } from "../codex/computer-use-runtime-config";
import {
  canonicalComputerUseExecutablePath,
  ComputerUseHostPlatformError,
  makeComputerUseHostPlatform,
  type ComputerUseHostPlatform,
  type ComputerUseHostServicesServer,
  type ComputerUseServiceAddon,
} from "../platform/electron/ComputerUseHostPlatform";
import { isMacOSVersionAtLeast } from "../sky-native";

type ComputerUseRuntimeUnavailableReason =
  | "architecture-unsupported"
  | "helper-invalid"
  | "helper-materialization-failed"
  | "host-services-failed"
  | "macos-version-unsupported"
  | "native-addon-unavailable"
  | "platform-unsupported"
  | "runtime-unavailable";

export type ComputerUseRuntimeResult =
  | {
      readonly appPath: string;
      readonly hostServicesPipePath: string;
      readonly serviceExecutablePath: string;
      readonly status: "available";
    }
  | {
      readonly message: string;
      readonly reason: ComputerUseRuntimeUnavailableReason;
      readonly status: "unavailable";
    };

export class ComputerUseRuntimeError extends Schema.TaggedError<ComputerUseRuntimeError>()(
  "ComputerUseRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class ComputerUseRuntime extends Context.Service<
  ComputerUseRuntime,
  {
    readonly current: () => ComputerUseRuntimeResult | null;
    readonly ensureReady: Effect.Effect<ComputerUseRuntimeResult, ComputerUseRuntimeError>;
  }
>()("nodex/main/host-runtime/ComputerUseRuntime") {}

export interface ComputerUseRuntimeOptions {
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly macOSRelease?: string;
  readonly peerAuthorizationMode: BrowserUsePeerAuthorizationMode;
  readonly platform: NodeJS.Platform;
  readonly runtimeConfig?: () => ComputerUseRuntimeConfigInput;
  readonly runtimeStateHome: string;
  readonly terminateManagedServiceOnDispose?: boolean;
}

interface ComputerUseRuntimeState {
  readonly addon: ComputerUseServiceAddon | null;
  readonly closed: boolean;
  readonly managedPid: number | null;
  readonly result: ComputerUseRuntimeResult | null;
  readonly server: ComputerUseHostServicesServer | null;
  readonly serviceExecutablePath: string | null;
}

interface ComputerUseRuntimeLayerOptions extends ComputerUseRuntimeOptions {
  readonly host: ComputerUseHostPlatform;
}

interface ComputerUseRuntimeStart {
  readonly addon: ComputerUseServiceAddon | null;
  readonly result: ComputerUseRuntimeResult;
  readonly server: ComputerUseHostServicesServer | null;
  readonly serviceExecutablePath: string | null;
}

const initialState: ComputerUseRuntimeState = {
  addon: null,
  closed: false,
  managedPid: null,
  result: null,
  server: null,
  serviceExecutablePath: null,
};

const runtimeError = (operation: string, cause: unknown): ComputerUseRuntimeError =>
  new ComputerUseRuntimeError({ operation, cause });

function boundedMessage(error: unknown): string {
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? Reflect.get(error, "cause")
      : error;
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, 2_048);
}

const unavailable = (
  reason: ComputerUseRuntimeUnavailableReason,
  message: string,
): ComputerUseRuntimeResult => ({ message, reason, status: "unavailable" });

const make = (options: ComputerUseRuntimeLayerOptions) =>
  Effect.gen(function* () {
    const state = yield* Ref.make(initialState);
    const readinessGate = yield* Semaphore.make(1);
    const serviceGate = yield* Semaphore.make(1);

    const validateManagedProcess = (
      addon: ComputerUseServiceAddon,
      pid: number,
      executablePath: string,
    ): boolean =>
      options.host.isProcessAlive(pid) &&
      options.host.processMatchesExecutable(addon, pid, executablePath);

    const terminateIfOwned = (
      addon: ComputerUseServiceAddon,
      pid: number,
      executablePath: string,
    ): Effect.Effect<void> => {
      if (!options.terminateManagedServiceOnDispose) return Effect.void;
      if (!validateManagedProcess(addon, pid, executablePath)) return Effect.void;
      return options.host
        .terminateProcess(pid)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not terminate Computer Use service").pipe(
              Effect.annotateLogs({ error: boundedMessage(error) }),
            ),
          ),
        );
    };

    const clearManagedService = serviceGate.withPermits(1)(
      Ref.modify(
        state,
        (current) =>
          [
            {
              addon: current.addon,
              executablePath: current.serviceExecutablePath,
              pid: current.managedPid,
            },
            { ...current, managedPid: null },
          ] as const,
      ).pipe(
        Effect.flatMap(({ addon, executablePath, pid }) => {
          if (!addon || !executablePath || pid === null) return Effect.void;
          return terminateIfOwned(addon, pid, executablePath);
        }),
      ),
    );

    const ensureService = (
      addon: ComputerUseServiceAddon,
      executablePath: string,
    ): Effect.Effect<{ readonly pid: number }, ComputerUseRuntimeError> =>
      serviceGate.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          if (current.closed) {
            return yield* runtimeError(
              "service.closed",
              new Error("Computer Use runtime is closed"),
            );
          }
          if (
            current.managedPid !== null &&
            validateManagedProcess(addon, current.managedPid, executablePath)
          ) {
            return { pid: current.managedPid };
          }

          yield* Ref.update(state, (latest) => ({ ...latest, managedPid: null }));
          const pid = yield* options.host
            .spawnService(addon, executablePath)
            .pipe(Effect.mapError((error) => runtimeError("service.spawn", error)));
          if (pid === null || !Number.isSafeInteger(pid) || pid <= 0) {
            return yield* runtimeError(
              "service.spawn",
              new Error("Computer Use native host did not return a valid process ID"),
            );
          }

          const startedAt = yield* Clock.currentTimeMillis;
          const deadline = startedAt + 2_000;
          let now = startedAt;
          while (now < deadline) {
            if (validateManagedProcess(addon, pid, executablePath)) {
              const committed = yield* Ref.modify(state, (latest) => {
                if (latest.closed) return [false, latest] as const;
                return [
                  true,
                  {
                    ...latest,
                    addon,
                    managedPid: pid,
                    serviceExecutablePath: executablePath,
                  },
                ] as const;
              });
              if (committed) return { pid };
              yield* terminateIfOwned(addon, pid, executablePath);
              return yield* runtimeError(
                "service.closed",
                new Error("Computer Use runtime is closed"),
              );
            }
            yield* Effect.sleep("50 millis");
            now = yield* Clock.currentTimeMillis;
          }

          return yield* runtimeError(
            "service.validate",
            new Error("Computer Use service did not become a valid managed process"),
          );
        }),
      );

    const start: Effect.Effect<ComputerUseRuntimeStart> = Effect.gen(function* () {
      if (options.host.platform !== "darwin") {
        return {
          addon: null,
          result: unavailable(
            "platform-unsupported",
            `Computer Use is unavailable on ${options.host.platform}`,
          ),
          server: null,
          serviceExecutablePath: null,
        };
      }
      const runtime = options.browserRuntime;
      if (runtime.status === "unavailable") {
        return {
          addon: null,
          result: unavailable("runtime-unavailable", runtime.message),
          server: null,
          serviceExecutablePath: null,
        };
      }
      const capability = runtime.bundle.manifest.capabilities.computerUse;
      if (capability.status === "unavailable") {
        return {
          addon: null,
          result: unavailable(
            "architecture-unsupported",
            "Computer Use is unavailable for this architecture",
          ),
          server: null,
          serviceExecutablePath: null,
        };
      }
      if (!isMacOSVersionAtLeast(capability.minimumMacOSVersion, options.host.macOSRelease)) {
        return {
          addon: null,
          result: unavailable(
            "macos-version-unsupported",
            `Computer Use requires macOS ${capability.minimumMacOSVersion} or later`,
          ),
          server: null,
          serviceExecutablePath: null,
        };
      }

      yield* options.host
        .writeRuntimeConfig({
          ...options.runtimeConfig?.(),
          runtimeStateHome: options.runtimeStateHome,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not write Computer Use runtime config").pipe(
              Effect.annotateLogs({ error: boundedMessage(error) }),
            ),
          ),
        );

      const addon = yield* options.host.loadAddon;
      if (!addon) {
        return {
          addon: null,
          result: unavailable(
            "native-addon-unavailable",
            "Computer Use native host is unavailable",
          ),
          server: null,
          serviceExecutablePath: null,
        };
      }
      if (!runtime.bundle.paths.computerUseApp) {
        return {
          addon: null,
          result: unavailable("helper-invalid", "Computer Use helper bundle is missing"),
          server: null,
          serviceExecutablePath: null,
        };
      }

      const helperExit = yield* Effect.exit(
        options.host.materializeApp({
          bundleIdentifier: capability.appBundleIdentifier,
          desktopBuild: runtime.bundle.manifest.desktopBuild,
          runtimeStateHome: options.runtimeStateHome,
          signingTeamId: capability.signingTeamId,
          sourceAppPath: runtime.bundle.paths.computerUseApp,
        }),
      );
      if (Exit.isFailure(helperExit)) {
        return {
          addon: null,
          result: unavailable(
            "helper-materialization-failed",
            `Computer Use helper materialization failed: ${boundedMessage(helperExit.cause)}`,
          ),
          server: null,
          serviceExecutablePath: null,
        };
      }

      const helper = helperExit.value;
      const serviceExecutablePath = canonicalComputerUseExecutablePath(
        helper.serviceExecutablePath,
      );
      const handler = (
        method: string,
        params: unknown,
      ): Effect.Effect<unknown, ComputerUseRuntimeError> => {
        if (method !== "ensureService") {
          return Effect.fail(
            runtimeError(
              "host-services.request",
              new Error(`Unsupported host-services method: ${method}`),
            ),
          );
        }
        const service =
          params && typeof params === "object" ? Reflect.get(params, "service") : null;
        if (service !== "computer-use") {
          return Effect.fail(
            runtimeError("host-services.request", new Error("Unsupported host service")),
          );
        }
        return ensureService(addon, serviceExecutablePath).pipe(Effect.as({}));
      };
      const serverExit = yield* Effect.exit(
        options.host.createNativePipeServer(
          (method, params) =>
            handler(method, params).pipe(
              Effect.mapError(
                (error) =>
                  new ComputerUseHostPlatformError({
                    operation: "native-pipe.request",
                    cause: error,
                  }),
              ),
            ),
          options.peerAuthorizationMode,
          runtime.bundle.paths.peerAuthorization,
        ),
      );
      if (Exit.isFailure(serverExit)) {
        return {
          addon: null,
          result: unavailable(
            "host-services-failed",
            `Computer Use host-services pipe failed: ${boundedMessage(serverExit.cause)}`,
          ),
          server: null,
          serviceExecutablePath: null,
        };
      }

      const server = serverExit.value;
      const started = yield* Effect.exit(server.start);
      if (Exit.isFailure(started)) {
        yield* Effect.all([Effect.exit(server.close), Effect.exit(clearManagedService)], {
          concurrency: 2,
        });
        return {
          addon: null,
          result: unavailable(
            "host-services-failed",
            `Computer Use host-services pipe failed: ${boundedMessage(started.cause)}`,
          ),
          server: null,
          serviceExecutablePath: null,
        };
      }

      return {
        result: {
          appPath: helper.appPath,
          hostServicesPipePath: server.pipePath,
          serviceExecutablePath,
          status: "available",
        } satisfies ComputerUseRuntimeResult,
        server,
        addon,
        serviceExecutablePath,
      };
    });

    const ensureReady = readinessGate.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (current.closed) {
          return yield* runtimeError(
            "ensure-ready.closed",
            new Error("Computer Use runtime is closed"),
          );
        }
        if (current.result?.status === "available") return current.result;

        const started = yield* start;
        const committed = yield* Ref.modify(state, (latest) => {
          if (latest.closed) return [false, latest] as const;
          return [
            true,
            {
              ...latest,
              addon: started.addon,
              result: started.result,
              server: started.server,
              serviceExecutablePath: started.serviceExecutablePath,
            },
          ] as const;
        });
        if (committed) return started.result;

        if (started.server) yield* started.server.close.pipe(Effect.ignore);
        yield* clearManagedService;
        return yield* runtimeError(
          "ensure-ready.closed",
          new Error("Computer Use runtime is closed"),
        );
      }),
    );

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Ref.update(state, (current) => ({ ...current, closed: true }));
        const resources = yield* readinessGate.withPermits(1)(
          serviceGate.withPermits(1)(
            Ref.modify(
              state,
              (current) =>
                [
                  {
                    addon: current.addon,
                    executablePath: current.serviceExecutablePath,
                    pid: current.managedPid,
                    server: current.server,
                  },
                  {
                    ...current,
                    addon: null,
                    managedPid: null,
                    result: null,
                    server: null,
                    serviceExecutablePath: null,
                  },
                ] as const,
            ),
          ),
        );
        const releases: Array<Effect.Effect<void, ComputerUseHostPlatformError>> = [];
        if (resources.server) releases.push(resources.server.close);
        if (
          options.terminateManagedServiceOnDispose &&
          resources.addon &&
          resources.executablePath &&
          resources.pid !== null &&
          validateManagedProcess(resources.addon, resources.pid, resources.executablePath)
        ) {
          releases.push(options.host.terminateProcess(resources.pid));
        }
        const exits = yield* Effect.forEach(releases, Effect.exit, { concurrency: "unbounded" });
        for (const exit of exits) {
          if (Exit.isSuccess(exit)) continue;
          yield* Effect.logWarning("Computer Use runtime cleanup failed").pipe(
            Effect.annotateLogs({ error: boundedMessage(exit.cause) }),
          );
        }
      }),
    );

    return ComputerUseRuntime.of({
      current: () => Ref.getUnsafe(state).result,
      ensureReady,
    });
  });

export const live = (
  options: ComputerUseRuntimeOptions,
): Layer.Layer<ComputerUseRuntime, never, ScopedCallbackRuntime> =>
  Layer.effect(
    ComputerUseRuntime,
    Effect.gen(function* () {
      const callbacks = yield* ScopedCallbackRuntime;
      return yield* make({
        ...options,
        host: makeComputerUseHostPlatform(
          { macOSRelease: options.macOSRelease, platform: options.platform },
          callbacks,
        ),
      });
    }),
  );

export const testLayer = (
  options: ComputerUseRuntimeOptions,
  host: ComputerUseHostPlatform,
): Layer.Layer<ComputerUseRuntime> => Layer.effect(ComputerUseRuntime, make({ ...options, host }));
