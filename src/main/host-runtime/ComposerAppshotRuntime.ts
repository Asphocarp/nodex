import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { BrowserWindow } from "electron";
import type {
  CodexComposerAppshotContext,
  CodexComposerAppshotTargetResult,
} from "../../shared/types";
import { MainConfig } from "../app/MainConfig";
import {
  ComposerAppshotService,
  makeComposerAppshotLiveDependencies,
  type ComposerAppshotServiceDependencies,
} from "../composer-appshot-service";

export class ComposerAppshotRuntimeError extends Schema.TaggedError<ComposerAppshotRuntimeError>()(
  "ComposerAppshotRuntimeError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class ComposerAppshotRuntime extends Context.Service<
  ComposerAppshotRuntime,
  {
    readonly readTarget: Effect.Effect<
      CodexComposerAppshotTargetResult,
      ComposerAppshotRuntimeError
    >;
    readonly capture: (
      targetId: string,
    ) => Effect.Effect<CodexComposerAppshotContext, ComposerAppshotRuntimeError>;
    /** Registers a Window-owned observation with the process-scoped Appshot owner. */
    readonly observeWindow: (window: BrowserWindow) => void;
  }
>()("nodex/main/host-runtime/ComposerAppshotRuntime") {}

export const liveWithDependencies = (
  dependencies: ComposerAppshotServiceDependencies,
): Layer.Layer<ComposerAppshotRuntime> =>
  Layer.effect(
    ComposerAppshotRuntime,
    Effect.gen(function* () {
      const service = new ComposerAppshotService(dependencies);
      yield* Effect.addFinalizer(() => Effect.sync(() => service.dispose()));
      const error = (operation: string, cause: unknown) =>
        new ComposerAppshotRuntimeError({ operation, cause });
      return ComposerAppshotRuntime.of({
        readTarget: Effect.tryPromise({
          try: () => service.readTarget(),
          catch: (cause) => error("read-target", cause),
        }),
        capture: (targetId) =>
          Effect.tryPromise({
            try: () => service.capture(targetId),
            catch: (cause) => error("capture", cause),
          }),
        observeWindow: (window) => {
          service.observeWindow(window);
        },
      });
    }),
  );

export const live: Layer.Layer<ComposerAppshotRuntime, never, MainConfig> = Layer.unwrap(
  MainConfig.use((config) =>
    Effect.succeed(
      liveWithDependencies(
        makeComposerAppshotLiveDependencies({
          configuredHelperPath: config.composerAppshotHelperPath,
          isPackaged: config.isPackaged,
          platform: config.platform,
          projectRootPath: config.projectRootPath,
          resourcesPath: config.resourcesPath,
        }),
      ),
    ),
  ),
);
