import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { MainConfig } from "./MainConfig";
import { MainRuntime, type MainRuntimeError } from "./MainRuntimeLive";
import { MainShutdown } from "./MainShutdown";

export type MainStartupGateResult = "continue" | "moved" | "quit";

export interface MainAppOptions<R> {
  readonly initialEvents: readonly import("../bootstrap-events").BootstrapRuntimeEvent[];
  readonly runtimeLayer: Layer.Layer<MainRuntime, MainRuntimeError, R>;
  readonly runStartupGate: Effect.Effect<MainStartupGateResult, MainRuntimeError, R>;
  readonly onRuntimeReady?: (
    runtime: MainRuntime["Service"],
  ) => Effect.Effect<void, MainRuntimeError, R | Scope.Scope>;
}

const runRuntime = <R>(
  options: MainAppOptions<R>,
  onAcquired: (runtime: MainRuntime["Service"] | null) => void,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(options.runtimeLayer);
      const runtime = Context.get(context, MainRuntime);
      onAcquired(runtime);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          onAcquired(null);
        }),
      );
      yield* runtime.start;
      for (const event of options.initialEvents) yield* runtime.handleBootstrapEvent(event);
      if (options.onRuntimeReady) yield* options.onRuntimeReady(runtime);
      const shutdown = yield* MainShutdown;
      return yield* shutdown.awaitRequest;
    }),
  );

export const program = <R>(options: MainAppOptions<R>) =>
  Effect.gen(function* () {
    const electron = yield* ElectronApp;
    const config = yield* MainConfig;
    const shutdown = yield* MainShutdown;
    let quitAllowed = false;
    let activeRuntime: MainRuntime["Service"] | null = null;
    yield* electron.onBeforeQuit(() => ({
      preventDefault: !quitAllowed,
      task: quitAllowed
        ? Effect.void
        : (activeRuntime?.prepareQuit ?? Effect.void).pipe(
            Effect.andThen(shutdown.request({ _tag: "UserQuit" })),
            Effect.asVoid,
            Effect.orDie,
          ),
    }));
    yield* electron.onWindowAllClosed(
      config.platform === "darwin"
        ? Effect.void
        : shutdown.request({ _tag: "UserQuit" }).pipe(Effect.asVoid),
    );
    yield* electron.whenReady;
    const gate = yield* options.runStartupGate;
    if (gate === "moved") return;
    if (gate === "quit") {
      yield* electron.quit;
      return;
    }

    const runtimeExit = yield* Effect.exit(
      runRuntime(options, (runtime) => {
        activeRuntime = runtime;
      }),
    );
    yield* shutdown.markRuntimeClosed(Exit.asVoid(runtimeExit));
    if (Exit.isFailure(runtimeExit)) return yield* Effect.failCause(runtimeExit.cause);
    quitAllowed = true;
    if (runtimeExit.value._tag === "AuthorityDriftRelaunch") yield* electron.relaunch;
    yield* electron.quit;
  }).pipe(Effect.scoped);
