import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { MainRuntimeController } from "../main-runtime";
import {
  activateMainServiceComposition,
  createMainServiceComposition,
} from "../main-service-composition";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { MainConfig } from "./MainConfig";
import { MainRuntime, MainRuntimeError } from "./MainRuntimeLive";

type RuntimeModule = typeof import("../main-runtime");

const runtimeError = (operation: string, cause: unknown) =>
  new MainRuntimeError({ operation, cause });

/** Production Main runtime owner while feature Layers replace the remaining application Modules. */
export const live: Layer.Layer<MainRuntime, MainRuntimeError, ElectronApp | MainConfig> =
  Layer.effect(
    MainRuntime,
    Effect.gen(function* () {
      const electron = yield* ElectronApp;
      const config = yield* MainConfig;
      const locale = yield* electron.locale;
      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const composition = createMainServiceComposition({ locale: () => locale });
            return { release: activateMainServiceComposition(composition) };
          },
          catch: (cause) => runtimeError("activate-services", cause),
        }),
        ({ release }) => Effect.sync(release),
      );
      let runtimeModule: RuntimeModule | null = null;
      let controller: MainRuntimeController | null = null;
      yield* Effect.addFinalizer(() => {
        const release =
          controller !== null
            ? Effect.tryPromise({
                try: () => controller!.shutdown(),
                catch: (cause) => runtimeError("shutdown", cause),
              })
            : runtimeModule !== null
              ? Effect.tryPromise({
                  try: () => runtimeModule!.shutdownFailedMainAppStartup(),
                  catch: (cause) => runtimeError("startup-rollback", cause),
                })
              : Effect.void;
        return release.pipe(Effect.orDie);
      });

      const requireController = (
        operation: string,
      ): Effect.Effect<MainRuntimeController, MainRuntimeError> =>
        Effect.suspend(() =>
          controller === null
            ? Effect.fail(runtimeError(operation, new Error("Main runtime has not started")))
            : Effect.succeed(controller),
        );

      return MainRuntime.of({
        start: Effect.uninterruptible(
          Effect.tryPromise({
            try: () =>
              import("../main-runtime").then((module) => {
                runtimeModule = module;
                return module
                  .runMainAppStartup({
                    initialArgv: [...config.argv],
                    manageElectronLifecycle: false,
                    startupEvents: [],
                  })
                  .then((started) => {
                    controller = started;
                  });
              }),
            catch: (cause) => runtimeError("startup", cause),
          }),
        ),
        prepareQuit: requireController("prepare-quit").pipe(
          Effect.andThen((runtime) =>
            Effect.tryPromise({
              try: () => runtime.prepareQuit(),
              catch: (cause) => runtimeError("prepare-quit", cause),
            }),
          ),
        ),
        handleBootstrapEvent: (event) =>
          requireController("bootstrap-event").pipe(
            Effect.andThen((runtime) =>
              Effect.sync(() => {
                if (event.type === "open-url") runtime.handleOpenUrl(event.url);
                else runtime.handleSecondInstance([...event.argv]);
              }),
            ),
          ),
      });
    }),
  );
