import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Durable Window Session lookup used by window-scoped host capabilities. */
export class WindowSessionCatalog extends Context.Service<
  WindowSessionCatalog,
  {
    readonly resolveForWebContents: (webContentsId: number) => Effect.Effect<string | null>;
  }
>()("nodex/main/window-runtime/WindowSessionCatalog") {}

export const fromResolver = (
  resolve: (webContentsId: number) => string | null,
): Layer.Layer<WindowSessionCatalog> =>
  Layer.succeed(
    WindowSessionCatalog,
    WindowSessionCatalog.of({
      resolveForWebContents: (webContentsId) => Effect.sync(() => resolve(webContentsId)),
    }),
  );
