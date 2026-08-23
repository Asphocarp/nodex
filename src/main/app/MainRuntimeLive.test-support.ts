import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { BootstrapRuntimeEvent } from "../bootstrap-events";
import { MainRuntime, type MainRuntimeError } from "./MainRuntimeLive";

export interface MainRuntimeTestHooks {
  readonly activate?: Effect.Effect<void, MainRuntimeError>;
  readonly start: Effect.Effect<void, MainRuntimeError>;
  readonly prepareQuit?: Effect.Effect<"continue" | "defer", MainRuntimeError>;
  readonly handleBootstrapEvent: (
    event: BootstrapRuntimeEvent,
  ) => Effect.Effect<void, MainRuntimeError>;
  readonly release?: Effect.Effect<void>;
}

export const mainRuntimeTestLayer = (hooks: MainRuntimeTestHooks): Layer.Layer<MainRuntime> =>
  Layer.effect(
    MainRuntime,
    Effect.gen(function* () {
      if (hooks.release) yield* Effect.addFinalizer(() => hooks.release ?? Effect.void);
      return MainRuntime.of({
        activate: hooks.activate ?? Effect.void,
        start: hooks.start,
        prepareQuit: hooks.prepareQuit ?? Effect.succeed("continue"),
        handleBootstrapEvent: hooks.handleBootstrapEvent,
      });
    }),
  );
