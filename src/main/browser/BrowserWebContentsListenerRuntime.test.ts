import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { makeBrowserWebContentsListenerRuntime } from "./BrowserWebContentsListenerRuntime";

it.effect("BrowserWebContentsListenerRuntime", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtime = yield* makeBrowserWebContentsListenerRuntime.pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    const released: number[] = [];

    assert.isTrue(runtime.acquire(101, () => () => released.push(101)));
    assert.isFalse(runtime.acquire(101, () => () => released.push(-1)));
    assert.isTrue(runtime.acquire(102, () => () => released.push(102)));
    assert.strictEqual(runtime.size(), 2);

    runtime.release(101);
    assert.deepEqual(released, [101]);
    assert.strictEqual(runtime.size(), 1);

    yield* Scope.close(scope, Exit.void);
    assert.deepEqual(released, [101, 102]);
    assert.strictEqual(runtime.size(), 0);
    assert.isFalse(runtime.acquire(103, () => () => released.push(103)));
  }),
);
