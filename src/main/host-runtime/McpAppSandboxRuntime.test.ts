import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { McpAppSandboxRuntime, fromCoordinator } from "./McpAppSandboxRuntime";

it.effect("owns the coordinator for the complete Main Scope", () =>
  Effect.gen(function* () {
    const lifecycle: string[] = [];
    const coordinator = {
      install: () => lifecycle.push("install"),
      createHost: () => {
        throw new Error("not used");
      },
      dispose: () => lifecycle.push("dispose"),
    };
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(fromCoordinator(coordinator), scope);
    assert.isDefined(Context.get(context, McpAppSandboxRuntime));
    assert.deepStrictEqual(lifecycle, ["install"]);

    yield* Scope.close(scope, Exit.void);
    assert.deepStrictEqual(lifecycle, ["install", "dispose"]);
  }),
);
