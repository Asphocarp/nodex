import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { CodexEphemeralThreadRouting, live } from "./CodexEphemeralThreadRouting";

it.effect("owns ephemeral Thread host affinity for exactly the Main Scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(live, scope);
    const routing = Context.get(context, CodexEphemeralThreadRouting);

    yield* routing.register("side-a", "remote-a");
    assert.strictEqual(yield* routing.resolve("side-a"), "remote-a");
    yield* routing.remove("side-a");
    assert.isNull(yield* routing.resolve("side-a"));

    yield* routing.register("side-b", "remote-b");
    yield* Scope.close(scope, Exit.void);
    assert.isNull(yield* routing.resolve("side-b"));
  }),
);
