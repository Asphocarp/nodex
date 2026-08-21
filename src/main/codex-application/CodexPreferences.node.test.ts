import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { assert, it } from "@effect/vitest";
import { CodexPreferences, live } from "./CodexPreferences";

it.effect("owns and validates the process personality preference", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(live, scope);
    const preferences = Context.get(context, CodexPreferences);

    assert.strictEqual(preferences.current(), "friendly");
    yield* preferences.setPersonality("pragmatic");
    assert.strictEqual(preferences.current(), "pragmatic");
    assert.strictEqual(yield* SubscriptionRef.get(preferences.snapshot), "pragmatic");
    const invalid = yield* preferences.setPersonality("invalid" as never).pipe(Effect.result);
    assert.strictEqual(invalid._tag, "Failure");

    yield* Scope.close(scope, Exit.void);
  }),
);
