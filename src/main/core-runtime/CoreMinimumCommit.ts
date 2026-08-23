import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

export interface CoreCommitSnapshot {
  readonly store_epoch: string;
  readonly commit_head: number;
}

export class CoreStoreEpochMismatch extends Schema.TaggedError<CoreStoreEpochMismatch>()(
  "CoreStoreEpochMismatch",
  {
    expectedStoreEpoch: Schema.String,
    observedStoreEpoch: Schema.String,
  },
) {}

class CoreMinimumCommitPending extends Schema.TaggedError<CoreMinimumCommitPending>()(
  "CoreMinimumCommitPending",
  {
    storeEpoch: Schema.String,
    minimumCommitSeq: Schema.Finite,
    observedCommitSeq: Schema.Finite,
  },
) {}

export class CoreMinimumCommitTimeout extends Schema.TaggedError<CoreMinimumCommitTimeout>()(
  "CoreMinimumCommitTimeout",
  {
    storeEpoch: Schema.String,
    minimumCommitSeq: Schema.Finite,
    observedCommitSeq: Schema.Finite,
  },
) {}

export interface CoreMinimumCommitPolicy {
  readonly interval?: Duration.Input;
  readonly timeout?: Duration.Input;
}

interface CoreMinimumCommitReadFailure<E> {
  readonly _tag: "CoreMinimumCommitReadFailure";
  readonly cause: E;
}

/**
 * Repeats an authoritative read only while its successful projection is behind the requested
 * commit. A null coordinate represents an expected domain failure value and is returned as-is.
 */
export const readCoreProjectionAtLeast = Effect.fn("CoreMinimumCommit.readProjectionAtLeast")(
  function* <A, E, R>(
    read: Effect.Effect<A, E, R>,
    expectedStoreEpoch: string,
    minimumCommitSeq = 0,
    coordinate: (value: A) => CoreCommitSnapshot | null,
    policy: CoreMinimumCommitPolicy = {},
  ): Effect.fn.Return<A, E | CoreStoreEpochMismatch | CoreMinimumCommitTimeout, R> {
    if (minimumCommitSeq <= 0) {
      const value = yield* read;
      const snapshot = coordinate(value);
      if (snapshot === null) return value;
      if (snapshot.store_epoch === expectedStoreEpoch) return value;
      return yield* new CoreStoreEpochMismatch({
        expectedStoreEpoch,
        observedStoreEpoch: snapshot.store_epoch,
      });
    }

    type PollError =
      | CoreMinimumCommitReadFailure<E>
      | CoreStoreEpochMismatch
      | CoreMinimumCommitPending;
    const attempt: Effect.Effect<A, PollError, R> = read.pipe(
      Effect.mapError((cause): CoreMinimumCommitReadFailure<E> => ({
        _tag: "CoreMinimumCommitReadFailure",
        cause,
      })),
      Effect.flatMap(
        (value): Effect.Effect<A, CoreStoreEpochMismatch | CoreMinimumCommitPending> => {
          const snapshot = coordinate(value);
          if (snapshot === null) return Effect.succeed(value);
          if (snapshot.store_epoch !== expectedStoreEpoch) {
            return Effect.fail(
              new CoreStoreEpochMismatch({
                expectedStoreEpoch,
                observedStoreEpoch: snapshot.store_epoch,
              }),
            );
          }
          if (snapshot.commit_head >= minimumCommitSeq) return Effect.succeed(value);
          return Effect.fail(
            new CoreMinimumCommitPending({
              storeEpoch: expectedStoreEpoch,
              minimumCommitSeq,
              observedCommitSeq: snapshot.commit_head,
            }),
          );
        },
      ),
    );
    const schedule = Schedule.spaced(policy.interval ?? "5 millis").pipe(
      Schedule.upTo({ duration: policy.timeout ?? "200 millis" }),
      Schedule.setInputType<PollError>(),
      Schedule.while(({ input }) => input._tag === "CoreMinimumCommitPending"),
    );

    return yield* attempt.pipe(
      Effect.retry(schedule),
      Effect.catch(
        (error): Effect.Effect<A, E | CoreStoreEpochMismatch | CoreMinimumCommitTimeout> => {
          if (error._tag === "CoreMinimumCommitReadFailure") return Effect.fail(error.cause);
          if (error._tag === "CoreStoreEpochMismatch") return Effect.fail(error);
          return Effect.fail(
            new CoreMinimumCommitTimeout({
              storeEpoch: error.storeEpoch,
              minimumCommitSeq: error.minimumCommitSeq,
              observedCommitSeq: error.observedCommitSeq,
            }),
          );
        },
      ),
    );
  },
);

/** Repeats a raw Core snapshot read until its causal projection reaches the requested commit. */
export const readCoreSnapshotAtLeast = Effect.fn("CoreMinimumCommit.readSnapshotAtLeast")(
  function* <A extends CoreCommitSnapshot, E, R>(
    read: Effect.Effect<A, E, R>,
    expectedStoreEpoch: string,
    minimumCommitSeq = 0,
    policy: CoreMinimumCommitPolicy = {},
  ): Effect.fn.Return<A, E | CoreStoreEpochMismatch | CoreMinimumCommitTimeout, R> {
    return yield* readCoreProjectionAtLeast(
      read,
      expectedStoreEpoch,
      minimumCommitSeq,
      (snapshot) => snapshot,
      policy,
    );
  },
);
