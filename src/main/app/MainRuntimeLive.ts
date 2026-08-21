import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { BootstrapRuntimeEvent } from "../bootstrap-events";

export class MainRuntimeError extends Schema.TaggedError<MainRuntimeError>()("MainRuntimeError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class MainRuntime extends Context.Service<
  MainRuntime,
  {
    readonly activate: Effect.Effect<void, MainRuntimeError>;
    readonly start: Effect.Effect<void, MainRuntimeError>;
    readonly prepareQuit: Effect.Effect<"continue" | "defer", MainRuntimeError>;
    readonly handleBootstrapEvent: (
      event: BootstrapRuntimeEvent,
    ) => Effect.Effect<void, MainRuntimeError>;
  }
>()("nodex/main/app/MainRuntime") {}

export interface MainRuntimeHooks {
  readonly activate?: Effect.Effect<void, MainRuntimeError>;
  readonly start: Effect.Effect<void, MainRuntimeError>;
  readonly prepareQuit?: Effect.Effect<"continue" | "defer", MainRuntimeError>;
  readonly handleBootstrapEvent: (
    event: BootstrapRuntimeEvent,
  ) => Effect.Effect<void, MainRuntimeError>;
  readonly release?: Effect.Effect<void>;
}

/** Test and migration constructor. Production feature layers merge into this owner directly. */
export const fromHooks = (hooks: MainRuntimeHooks): Layer.Layer<MainRuntime> =>
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
