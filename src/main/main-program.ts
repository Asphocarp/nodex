import { app } from "electron";
import { Data, Effect, Exit, Scope } from "effect";
import type { BootstrapRuntimeEvent } from "./bootstrap-events";
import {
  activateMainServiceComposition,
  createMainServiceComposition,
} from "./main-service-composition";
import type { MainRuntimeController, MainRuntimeStartupContext } from "./main-runtime";

export interface MainProgramInput {
  readonly initialArgv: string[];
  readonly startupEvents?: BootstrapRuntimeEvent[];
}

export interface MainProgramController extends MainRuntimeController {}

export interface MainProgramServiceActivation {
  release(): void;
}

export interface MainProgramDependencies {
  acquireServices(): MainProgramServiceActivation;
  startRuntime(context: MainRuntimeStartupContext): Promise<MainRuntimeController>;
}

class MainProgramFailure extends Data.TaggedError("MainProgramFailure")<{
  readonly cause: unknown;
  readonly phase: "runtime" | "services";
}> {}

const liveMainProgramDependencies: MainProgramDependencies = {
  acquireServices: () => {
    const composition = createMainServiceComposition({ locale: () => app.getLocale() });
    return { release: activateMainServiceComposition(composition) };
  },
  startRuntime: (context) => {
    // This import must remain after service activation: ipc-handlers binds observers while its
    // module is evaluated and reads the active compatibility composition.
    return import("./main-runtime").then((runtime) =>
      runtime.runMainAppStartup(context).catch((startupError: unknown) =>
        runtime.shutdownFailedMainAppStartup().then(
          () => Promise.reject(startupError),
          (shutdownError: unknown) =>
            Promise.reject(
              new AggregateError(
                [startupError, shutdownError],
                "Main runtime startup and cleanup both failed",
              ),
            ),
        ),
      ),
    );
  },
};

const unwrapMainProgramFailure = (error: unknown): unknown =>
  error instanceof MainProgramFailure ? error.cause : error;

/**
 * Acquire the Electron process runtime into one long-lived Scope. The Promise facade is the
 * readiness boundary used by bootstrap; all app quit paths call the same idempotent scope close.
 */
// oxlint-disable-next-line effecttsgo/async-function -- bootstrap intentionally consumes a Promise.
export async function runMainProgram(
  input: MainProgramInput,
  dependencies: MainProgramDependencies = liveMainProgramDependencies,
): Promise<MainProgramController> {
  const scope = Scope.makeUnsafe("sequential");
  let shutdownPromise: Promise<void> | null = null;

  const closeScope = (exit: Exit.Exit<unknown, unknown>): Promise<void> => {
    shutdownPromise ??= Effect.runPromise(Scope.close(scope, exit));
    return shutdownPromise;
  };
  const requestShutdown = (): Promise<void> => closeScope(Exit.void);

  const acquire = Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => dependencies.acquireServices(),
        catch: (cause) => new MainProgramFailure({ cause, phase: "services" }),
      }),
      (activation) => Effect.sync(() => activation.release()),
    );
    return yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          dependencies.startRuntime({
            initialArgv: input.initialArgv,
            requestShutdown,
            startupEvents: input.startupEvents,
          }),
        catch: (cause) => new MainProgramFailure({ cause, phase: "runtime" }),
      }),
      (controller) => Effect.promise(() => controller.shutdown()),
    );
  }).pipe(Scope.provide(scope));

  let runtime: MainRuntimeController;
  try {
    runtime = await Effect.runPromise(acquire);
  } catch (error) {
    const startupError = unwrapMainProgramFailure(error);
    try {
      await closeScope(Exit.fail(error));
    } catch (releaseError) {
      throw new AggregateError(
        [startupError, releaseError],
        "Main program startup and rollback both failed",
      );
    }
    throw startupError;
  }

  return {
    handleOpenUrl: (url) => runtime.handleOpenUrl(url),
    handleSecondInstance: (argv) => runtime.handleSecondInstance(argv),
    shutdown: requestShutdown,
  };
}
