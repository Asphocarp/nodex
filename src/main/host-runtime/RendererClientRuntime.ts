import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RendererClientRouter } from "../codex/renderer-client-router";

export class RendererClientRuntime extends Context.Service<
  RendererClientRuntime,
  { readonly router: RendererClientRouter }
>()("nodex/main/host-runtime/RendererClientRuntime") {}

export const fromRouter = (router: RendererClientRouter): Layer.Layer<RendererClientRuntime> =>
  Layer.effect(
    RendererClientRuntime,
    Effect.acquireRelease(
      Effect.succeed(RendererClientRuntime.of({ router })),
      ({ router: owned }) => Effect.sync(() => owned.dispose()),
    ),
  );

export const live: Layer.Layer<RendererClientRuntime> = Layer.unwrap(
  Effect.sync(() => fromRouter(new RendererClientRouter())),
);
