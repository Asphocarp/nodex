import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
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
    readonly handleBootstrapEvent: (
      event: BootstrapRuntimeEvent,
    ) => Effect.Effect<void, MainRuntimeError>;
  }
>()("nodex/main/app/MainRuntime") {}
