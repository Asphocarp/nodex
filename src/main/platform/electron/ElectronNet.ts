import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { app, net } from "electron";

export class ElectronNetError extends Schema.TaggedError<ElectronNetError>()("ElectronNetError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class ElectronNet extends Context.Service<
  ElectronNet,
  {
    readonly appVersion: string;
    readonly fetch: (input: string, init: RequestInit) => Effect.Effect<Response, ElectronNetError>;
  }
>()("nodex/main/platform/electron/ElectronNet") {}

export const live: Layer.Layer<ElectronNet> = Layer.effect(
  ElectronNet,
  Effect.sync(() =>
    ElectronNet.of({
      appVersion: app.getVersion(),
      fetch: (input, init) =>
        Effect.tryPromise({
          try: () => net.fetch(input, init),
          catch: (cause) => new ElectronNetError({ operation: "fetch", cause }),
        }),
    }),
  ),
);
