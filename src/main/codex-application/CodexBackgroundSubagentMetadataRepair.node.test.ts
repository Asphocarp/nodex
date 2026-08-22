import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import {
  make,
  type CodexBackgroundSubagentMetadataRepairOptions,
} from "./CodexBackgroundSubagentMetadataRepair";

const options = (
  overrides: Partial<CodexBackgroundSubagentMetadataRepairOptions> = {},
): CodexBackgroundSubagentMetadataRepairOptions => ({
  isRepairNeeded: () => true,
  repair: () => Effect.succeed(false),
  ...overrides,
});

const waitUntil = (label: string, predicate: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`Metadata repair test did not settle: ${label}`));
  });

it.effect("coalesces active repair requests by child Thread", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<boolean>();
    let repairs = 0;
    const runtime = yield* make(
      options({
        repair: () =>
          Effect.sync(() => {
            repairs += 1;
          }).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
      }),
    );
    runtime.request("parent-1", ["child-1"]);
    yield* Deferred.await(started);
    runtime.request("parent-1", ["child-1"]);
    assert.strictEqual(repairs, 1);
    yield* Deferred.succeed(release, false);
  }),
);

it.effect("stops scheduling a child after friendly metadata is repaired", () =>
  Effect.gen(function* () {
    let repairs = 0;
    const runtime = yield* make(
      options({
        repair: () =>
          Effect.sync(() => {
            repairs += 1;
            return true;
          }),
      }),
    );
    runtime.request("parent-1", ["child-1"]);
    yield* waitUntil("completed repair", () => repairs === 1);
    yield* TestClock.adjust("1 minute");
    runtime.request("parent-1", ["child-1"]);
    yield* Effect.yieldNow;
    assert.strictEqual(repairs, 1);
  }),
);

it.effect("retries incomplete metadata only after the Effect-clock interval", () =>
  Effect.gen(function* () {
    let repairs = 0;
    const runtime = yield* make(
      options({
        repair: () =>
          Effect.sync(() => {
            repairs += 1;
            return false;
          }),
      }),
    );
    runtime.request("parent-1", ["child-1"]);
    yield* waitUntil("initial repair", () => repairs === 1);
    runtime.request("parent-1", ["child-1"]);
    yield* Effect.yieldNow;
    assert.strictEqual(repairs, 1);
    yield* TestClock.adjust("30 seconds");
    runtime.request("parent-1", ["child-1"]);
    yield* waitUntil("retry repair", () => repairs === 2);
  }),
);

it.effect("Main Scope close interrupts active metadata repair", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const runtime = yield* make(
      options({
        repair: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
      }),
    ).pipe(Effect.provideService(Scope.Scope, ownerScope));
    runtime.request("parent-1", ["child-1"]);
    yield* Deferred.await(started);
    yield* Scope.close(ownerScope, Exit.void);
    yield* Deferred.await(interrupted);
  }),
);
