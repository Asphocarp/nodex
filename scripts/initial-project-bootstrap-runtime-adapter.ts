import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  InitialProjectBootstrapRuntime,
  type InitialProjectBootstrapRuntimeOptions,
  live,
} from "../src/main/initial-project/InitialProjectBootstrapRuntime";

/** One-shot Effect root for external verification scripts that do not run inside Electron Main. */
export const ensureInitialProjectForVerification = (
  options: InitialProjectBootstrapRuntimeOptions,
): Promise<void> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(live(options));
        const runtime = Context.get(context, InitialProjectBootstrapRuntime);
        yield* runtime.ensure(() => Effect.void);
      }),
    ),
  );
