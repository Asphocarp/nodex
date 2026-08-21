import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import {
  CoreMinimumCommitTimeout,
  CoreStoreEpochMismatch,
  readCoreProjectionAtLeast,
  readCoreSnapshotAtLeast,
} from "./CoreMinimumCommit";

describe("CoreMinimumCommit", () => {
  it.effect("returns the first snapshot that reaches the causal commit", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const read = Ref.updateAndGet(reads, (value) => value + 1).pipe(
        Effect.map((attempt) => ({ store_epoch: "epoch-a", commit_head: attempt })),
      );
      const fiber = yield* readCoreSnapshotAtLeast(read, "epoch-a", 3).pipe(Effect.forkChild);

      yield* TestClock.adjust("10 millis");

      assert.deepEqual(yield* Fiber.join(fiber), { store_epoch: "epoch-a", commit_head: 3 });
      assert.strictEqual(yield* Ref.get(reads), 3);
    }),
  );

  it.effect("reports the last observed commit when the projection stays behind", () =>
    Effect.gen(function* () {
      const fiber = yield* readCoreSnapshotAtLeast(
        Effect.succeed({ store_epoch: "epoch-a", commit_head: 7 }),
        "epoch-a",
        9,
      ).pipe(Effect.forkChild);

      yield* TestClock.adjust("250 millis");
      const exit = yield* Fiber.await(fiber);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.isTrue(Schema.is(CoreMinimumCommitTimeout)(error));
        if (Schema.is(CoreMinimumCommitTimeout)(error)) {
          assert.strictEqual(error.minimumCommitSeq, 9);
          assert.strictEqual(error.observedCommitSeq, 7);
        }
      }
    }),
  );

  it.effect("fails store replacement without retrying", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const exit = yield* readCoreSnapshotAtLeast(
        Ref.updateAndGet(reads, (value) => value + 1).pipe(
          Effect.map(() => ({ store_epoch: "epoch-b", commit_head: 100 })),
        ),
        "epoch-a",
        2,
      ).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isTrue(Schema.is(CoreStoreEpochMismatch)(Cause.squash(exit.cause)));
      }
      assert.strictEqual(yield* Ref.get(reads), 1);
    }),
  );

  it.effect("returns an expected domain failure without treating it as projection lag", () =>
    Effect.gen(function* () {
      const result = yield* readCoreProjectionAtLeast(
        Effect.succeed({ ok: false as const, error: "page_not_found" }),
        "epoch-a",
        9,
        () => null,
      );

      assert.deepEqual(result, { ok: false, error: "page_not_found" });
    }),
  );

  it.effect("stops polling when the caller is interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const reads = yield* Ref.make(0);
      const read = Ref.updateAndGet(reads, (value) => value + 1).pipe(
        Effect.tap(() => Deferred.succeed(started, undefined)),
        Effect.map(() => ({ store_epoch: "epoch-a", commit_head: 0 })),
      );
      const fiber = yield* readCoreSnapshotAtLeast(read, "epoch-a", 10).pipe(Effect.forkChild);
      yield* Deferred.await(started);

      yield* Fiber.interrupt(fiber);
      yield* TestClock.adjust("1 second");

      assert.strictEqual(yield* Ref.get(reads), 1);
    }),
  );
});
