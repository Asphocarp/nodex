import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import type { CanvasPresenceHub } from "../canvas-presence-hub";
import { CanvasPresenceRuntime, live } from "./CanvasPresenceRuntime";

it.effect("owns presence sweeps and hub release with its Scope", () =>
  Effect.gen(function* () {
    const sweeps: number[] = [];
    let destroyed = 0;
    const hub = {
      destroy: () => {
        destroyed += 1;
      },
      sweep: (currentTime?: number) => {
        sweeps.push(currentTime ?? -1);
      },
    } as unknown as CanvasPresenceHub;
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(live({ hub, sweepIntervalMs: 500 }), scope);
    assert.strictEqual(Context.get(context, CanvasPresenceRuntime).hub, hub);

    yield* TestClock.adjust(1_500);
    assert.deepEqual(sweeps, [500, 1_000, 1_500]);
    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(destroyed, 1);
    yield* TestClock.adjust(1_000);
    assert.deepEqual(sweeps, [500, 1_000, 1_500]);
  }),
);
