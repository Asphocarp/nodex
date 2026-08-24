import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { MainApplication } from "./MainApplication";
import { MainConfig } from "./MainConfig";
import { emptyCleanupReport, MainApplicationError, type MainExit } from "./MainExit";
import { MainShutdown } from "./MainShutdown";

export type MainStartupGateResult = "continue" | "moved" | "quit";

export interface MainAppOptions<R> {
  readonly initialEvents: readonly import("../bootstrap-events").BootstrapRuntimeEvent[];
  readonly applicationLayer: Layer.Layer<MainApplication, MainApplicationError, R>;
  readonly runStartupGate: Effect.Effect<MainStartupGateResult, MainApplicationError, R>;
  readonly onApplicationReady?: (
    application: MainApplication["Service"],
  ) => Effect.Effect<void, MainApplicationError, R | Scope.Scope>;
}

const runApplication = <R>(
  options: MainAppOptions<R>,
  onAcquired: (application: MainApplication["Service"] | null) => void,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const shutdown = yield* MainShutdown;
      return yield* Effect.raceFirst(
        Effect.gen(function* () {
          const context = yield* Layer.build(options.applicationLayer);
          const application = Context.get(context, MainApplication);
          onAcquired(application);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              onAcquired(null);
            }),
          );
          for (const event of options.initialEvents) yield* application.handleBootstrapEvent(event);
          if (options.onApplicationReady) yield* options.onApplicationReady(application);
          return yield* shutdown.awaitRequest;
        }),
        shutdown.awaitRequest,
      );
    }),
  );

export const program = <R>(options: MainAppOptions<R>) =>
  Effect.gen(function* () {
    const electron = yield* ElectronApp;
    const config = yield* MainConfig;
    const shutdown = yield* MainShutdown;
    let quitAllowed = false;
    let activeApplication: MainApplication["Service"] | null = null;
    yield* electron.onActivate(
      Effect.suspend(() => activeApplication?.activate ?? Effect.void).pipe(Effect.orDie),
    );
    yield* electron.onBeforeQuit(() => ({
      preventDefault: !quitAllowed,
      task: quitAllowed ? Effect.void : shutdown.request({ _tag: "UserQuit" }).pipe(Effect.asVoid),
    }));
    yield* electron.onWindowAllClosed(
      config.platform === "darwin"
        ? Effect.void
        : shutdown.request({ _tag: "UserQuit" }).pipe(Effect.asVoid),
    );
    yield* electron.onTerminationSignal((signal) =>
      shutdown.request({ _tag: "Signal", signal }).pipe(Effect.asVoid),
    );
    yield* electron.whenReady;
    const gate = yield* options.runStartupGate;
    if (gate === "moved") {
      return {
        _tag: "Shutdown",
        reason: { _tag: "UserQuit" },
        cleanup: emptyCleanupReport,
      } satisfies MainExit;
    }
    if (gate === "quit") {
      yield* electron.quit;
      return {
        _tag: "Shutdown",
        reason: { _tag: "UserQuit" },
        cleanup: emptyCleanupReport,
      } satisfies MainExit;
    }

    const applicationExit = yield* Effect.exit(
      runApplication(options, (application) => {
        activeApplication = application;
      }),
    );
    yield* shutdown.markRuntimeClosed(Exit.asVoid(applicationExit));
    if (Exit.isFailure(applicationExit)) {
      const typedFailure = Cause.findErrorOption(applicationExit.cause);
      return {
        _tag: "Failure",
        phase: typedFailure._tag === "Some" ? typedFailure.value.phase : "closing",
        cause: applicationExit.cause,
      } satisfies MainExit;
    }
    quitAllowed = true;
    if (applicationExit.value._tag === "RuntimeFatal") {
      return {
        _tag: "Failure",
        phase: "runtime",
        cause: Cause.fail(
          new MainApplicationError({
            phase: "runtime",
            operation: applicationExit.value.subsystem ?? "application-kernel",
            cause: applicationExit.value.cause ?? new Error("Application truth became unavailable"),
          }),
        ),
      } satisfies MainExit;
    }
    if (
      applicationExit.value._tag === "AuthorityDriftRelaunch" ||
      applicationExit.value._tag === "StoreRestoreRelaunch"
    ) {
      yield* electron.relaunch;
    }
    yield* electron.quit;
    return {
      _tag: "Shutdown",
      reason: applicationExit.value,
      cleanup: emptyCleanupReport,
    } satisfies MainExit;
  }).pipe(Effect.scoped);
