import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CANVAS_PRESENCE_SWEEP_MS } from "../../shared/block-documents/document-presence";
import { createCanvasPresenceHub, type CanvasPresenceHub } from "../canvas-presence-hub";

export class CanvasPresenceRuntime extends Context.Service<
  CanvasPresenceRuntime,
  { readonly hub: CanvasPresenceHub }
>()("nodex/main/host-runtime/CanvasPresenceRuntime") {}

export interface CanvasPresenceRuntimeOptions {
  readonly hub?: CanvasPresenceHub;
  readonly sweepIntervalMs?: number;
}

export const live = (
  options: CanvasPresenceRuntimeOptions = {},
): Layer.Layer<CanvasPresenceRuntime> =>
  Layer.effect(
    CanvasPresenceRuntime,
    Effect.gen(function* () {
      const hub = options.hub ?? createCanvasPresenceHub();
      const sweepIntervalMs = Math.max(
        1,
        Math.trunc(options.sweepIntervalMs ?? CANVAS_PRESENCE_SWEEP_MS),
      );
      yield* Effect.forever(
        Effect.sleep(sweepIntervalMs).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.tap((currentTime) => Effect.sync(() => hub.sweep(currentTime))),
        ),
      ).pipe(Effect.forkScoped);
      yield* Effect.addFinalizer(() => Effect.sync(() => hub.destroy()));
      return CanvasPresenceRuntime.of({ hub });
    }),
  );
