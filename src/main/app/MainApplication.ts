import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { BootstrapRuntimeEvent } from "../bootstrap-events";

export const MainApplicationPhase = Schema.Literals(["pre-ready", "startup", "runtime", "closing"]);

export type MainApplicationPhase = typeof MainApplicationPhase.Type;

/** The single typed failure crossing the Main application lifecycle boundary. */
export class MainApplicationError extends Schema.TaggedError<MainApplicationError>()(
  "MainApplicationError",
  {
    phase: MainApplicationPhase,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** A fully acquired desktop application. Layer acquisition is the readiness boundary. */
export class MainApplication extends Context.Service<
  MainApplication,
  {
    readonly activate: Effect.Effect<void, MainApplicationError>;
    readonly handleBootstrapEvent: (
      event: BootstrapRuntimeEvent,
    ) => Effect.Effect<void, MainApplicationError>;
  }
>()("nodex/main/app/MainApplication") {}
