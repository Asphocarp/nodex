import { it } from "@effect/vitest";
import { Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { waitForCoreEventRetry } from "./core-event-stream";

it.effect("advances retry backoff only when the control-plane clock advances", ({ expect }) =>
  Effect.gen(function* () {
    const completed = yield* Ref.make(false);
    const retry = yield* Effect.forkChild(
      waitForCoreEventRetry(1_000).pipe(Effect.andThen(Ref.set(completed, true))),
    );

    yield* Effect.yieldNow;
    expect(yield* Ref.get(completed)).toBe(false);

    yield* TestClock.adjust("999 millis");
    yield* Effect.yieldNow;
    expect(yield* Ref.get(completed)).toBe(false);

    yield* TestClock.adjust("1 millis");
    yield* Fiber.join(retry);
    expect(yield* Ref.get(completed)).toBe(true);
  }),
);
