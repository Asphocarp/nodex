import { it } from "@effect/vitest";
import { Clock, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  terminateForegroundProcessGroup,
  type IsolatedProcessGroup,
  type IsolatedRunClock,
} from "./isolated-run";

it.effect("escalates a foreground process group against the control-plane clock", ({ expect }) =>
  Effect.gen(function* () {
    const signals: NodeJS.Signals[] = [];
    const clock: IsolatedRunClock = {
      now: Clock.currentTimeMillis,
      sleep: Effect.sleep,
    };
    const processGroup: IsolatedProcessGroup = {
      isAlive: () => Effect.succeed(true),
      signal: (_processGroupId, signal) =>
        Effect.sync(() => {
          signals.push(signal);
        }),
    };
    const termination = yield* Effect.forkChild(
      Effect.result(
        terminateForegroundProcessGroup({
          clock,
          processGroup,
          processGroupId: 4321,
          requestedSignal: "SIGINT",
        }),
      ),
    );

    yield* Effect.yieldNow;
    expect(signals).toEqual(["SIGINT"]);

    yield* TestClock.adjust("1500 millis");
    yield* Effect.yieldNow;
    expect(signals).toEqual(["SIGINT", "SIGTERM"]);

    yield* TestClock.adjust("1500 millis");
    yield* Effect.yieldNow;
    expect(signals).toEqual(["SIGINT", "SIGTERM", "SIGKILL"]);

    yield* TestClock.adjust("1000 millis");
    const result = yield* Fiber.join(termination);
    expect(Result.isFailure(result)).toBe(true);
  }),
);
