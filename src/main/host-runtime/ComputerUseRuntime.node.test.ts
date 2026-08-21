import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { ComputerUseRuntime, testLayer } from "./ComputerUseRuntime";

it.effect("coalesces through the coordinator and releases it with the owning Scope", () =>
  Effect.gen(function* () {
    let disposed = false;
    const available = {
      appPath: "/runtime/Computer Use.app",
      hostServicesPipePath: "/tmp/computer-use.sock",
      serviceExecutablePath: "/runtime/computer-use",
      status: "available" as const,
    };
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      testLayer({
        dispose: async () => {
          disposed = true;
        },
        ensureReady: async () => available,
        getResult: () => available,
      }),
      scope,
    );
    const runtime = Context.get(context, ComputerUseRuntime);

    assert.deepEqual(yield* runtime.ensureReady, available);
    assert.deepEqual(runtime.current(), available);
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(disposed);
  }),
);
