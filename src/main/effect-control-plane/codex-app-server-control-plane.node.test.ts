import { it } from "@effect/vitest";
import { Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { waitForCodexRequestTimeout } from "./codex-app-server-session";
import { codexReconnectDelay } from "./codex-app-server-supervisor";

it.effect("owns request deadlines on the control-plane clock", ({ expect }) =>
  Effect.gen(function* () {
    const expired = yield* Ref.make(false);
    const deadline = yield* Effect.forkChild(
      waitForCodexRequestTimeout(120_000).pipe(Effect.andThen(Ref.set(expired, true))),
    );

    yield* TestClock.adjust("119999 millis");
    yield* Effect.yieldNow;
    expect(yield* Ref.get(expired)).toBe(false);

    yield* TestClock.adjust("1 millis");
    yield* Fiber.join(deadline);
    expect(yield* Ref.get(expired)).toBe(true);
  }),
);

it.effect("caps reconnect backoff while keeping injected jitter deterministic", ({ expect }) =>
  Effect.sync(() => {
    expect(codexReconnectDelay(1, 17)).toBe(517);
    expect(codexReconnectDelay(7, 17)).toBe(30_017);
  }),
);
