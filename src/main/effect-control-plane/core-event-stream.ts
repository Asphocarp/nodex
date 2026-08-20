import { Cause, Data, Deferred, Effect, Exit, Queue, Ref, Result } from "effect";
import type {
  CoreEventStreamSupervisorInput,
  SupervisedCoreEventSubscription,
} from "../core-client/core-event-stream-supervisor";
import type { CoreEventSubscription } from "../core-client/types";
import { CoreEventCompatibilityError } from "../core-client/uds-http";
import { forkControlPlane, runControlPlanePromise } from "./runtime";

interface EventReplayBoundary {
  readonly commit_head: number;
}

interface SupervisorState {
  active: CoreEventSubscription | null;
  after: number;
  closed: boolean;
  connected: boolean;
  connection: Deferred.Deferred<void, CoreEventControlPlaneFailure>;
  everConnected: boolean;
  forceImmediateReconnect: boolean;
  initialOpenAttempts: number;
  readonly ready: Deferred.Deferred<void, CoreEventControlPlaneFailure>;
  retryDelayMs: number;
  retryWake: Deferred.Deferred<void> | null;
  terminalError: CoreEventControlPlaneFailure | null;
}

interface PhysicalAttemptResult {
  readonly interruption: CoreEventControlPlaneFailure | null;
  readonly resyncRequested: boolean;
}

interface DeliveryItem {
  readonly flush?: Deferred.Deferred<void>;
  readonly work?: Effect.Effect<void, CoreEventControlPlaneFailure>;
}

class CoreEventControlPlaneFailure extends Data.TaggedError("CoreEventControlPlaneFailure")<{
  readonly cause: unknown;
}> {}

const closedError = (): Error => new Error("Core event subscription is closed");

const complete = <E>(deferred: Deferred.Deferred<void, E>): void => {
  Deferred.doneUnsafe(deferred, Effect.void);
};

const fail = (
  deferred: Deferred.Deferred<void, CoreEventControlPlaneFailure>,
  error: CoreEventControlPlaneFailure,
): void => {
  Deferred.doneUnsafe(deferred, Effect.fail(error));
};

const callbackEffect = (
  callback: () => unknown,
): Effect.Effect<void, CoreEventControlPlaneFailure> =>
  Effect.tryPromise({
    try: () => Promise.resolve(callback()).then(() => undefined),
    catch: (cause) => new CoreEventControlPlaneFailure({ cause }),
  });

const unwrapControlPlaneFailure = (error: unknown): unknown =>
  error instanceof CoreEventControlPlaneFailure ? error.cause : error;

const deferredPromise = (
  deferred: Deferred.Deferred<void, CoreEventControlPlaneFailure>,
): Promise<void> =>
  runControlPlanePromise(Deferred.await(deferred)).catch((error: unknown) => {
    throw unwrapControlPlaneFailure(error);
  });

/** Shared by the supervisor and its TestClock contract. */
export const waitForCoreEventRetry = (milliseconds: number): Effect.Effect<void> =>
  milliseconds <= 0 ? Effect.void : Effect.sleep(milliseconds);

export function createCoreEventStreamSupervisor<ResyncBoundary extends EventReplayBoundary>(
  input: CoreEventStreamSupervisorInput<ResyncBoundary>,
): SupervisedCoreEventSubscription {
  const initialRetryDelayMs = input.retryDelayMs ?? 250;
  const maxRetryDelayMs = input.maxRetryDelayMs ?? 5_000;
  const stateRef = Ref.makeUnsafe<SupervisorState>({
    active: null,
    after: input.initialAfter,
    closed: false,
    connected: false,
    connection: Deferred.makeUnsafe<void, CoreEventControlPlaneFailure>(),
    everConnected: false,
    forceImmediateReconnect: false,
    initialOpenAttempts: 0,
    ready: Deferred.makeUnsafe<void, CoreEventControlPlaneFailure>(),
    retryDelayMs: initialRetryDelayMs,
    retryWake: null,
    terminalError: null,
  });
  const state = (): SupervisorState => Ref.getUnsafe(stateRef);

  const publishConnectionState = (connectionState: "connected" | "disconnected"): void => {
    try {
      input.onConnectionStateChanged?.(connectionState);
    } catch {
      // Lifecycle observation must not terminate the stream supervisor.
    }
  };

  const transitionToDisconnected = (): void => {
    const current = state();
    if (!current.connected) return;
    current.connected = false;
    current.connection = Deferred.makeUnsafe<void, CoreEventControlPlaneFailure>();
    publishConnectionState("disconnected");
  };

  const runPhysicalAttempt = (): Effect.Effect<PhysicalAttemptResult> =>
    Effect.scoped(
      Effect.gen(function* () {
        const current = state();
        let resyncRequested = false;
        let deliveryError: CoreEventControlPlaneFailure | null = null;
        const deliveryQueue = yield* Queue.unbounded<DeliveryItem>();
        const enqueue = (work: Effect.Effect<void, CoreEventControlPlaneFailure>): void => {
          Queue.offerUnsafe(deliveryQueue, { work });
        };

        const deliveryWorker = Effect.forever(
          Effect.gen(function* () {
            const item = yield* Queue.take(deliveryQueue);
            if (deliveryError === null && item.work !== undefined) {
              const result = yield* Effect.result(item.work);
              if (Result.isFailure(result)) {
                deliveryError = result.failure;
                state().active?.close();
              }
            }
            if (item.flush !== undefined) complete(item.flush);
          }),
        );
        yield* Effect.forkScoped(deliveryWorker);

        if (!current.everConnected) current.initialOpenAttempts += 1;
        const opened = yield* Effect.result(
          Effect.tryPromise({
            try: (signal) =>
              input.open(
                current.after,
                (envelope) => enqueue(callbackEffect(() => input.onEvent(envelope))),
                (checkpoint) =>
                  enqueue(
                    callbackEffect(() => input.onCheckpoint?.(checkpoint)).pipe(
                      Effect.andThen(
                        Effect.sync(() => {
                          state().after = Math.max(state().after, checkpoint.scanned_through_seq);
                        }),
                      ),
                    ),
                  ),
                (boundary) => {
                  resyncRequested = true;
                  enqueue(
                    callbackEffect(() => input.onResyncRequired(boundary)).pipe(
                      Effect.andThen(
                        Effect.sync(() => {
                          state().after = boundary.commit_head;
                        }),
                      ),
                    ),
                  );
                  state().active?.close();
                },
                signal,
              ),
            catch: (cause) => new CoreEventControlPlaneFailure({ cause }),
          }),
        );
        if (Result.isFailure(opened)) {
          return { interruption: opened.failure, resyncRequested };
        }

        const subscription = opened.success;
        current.active = subscription;
        yield* Effect.addFinalizer(() => Effect.sync(() => subscription.close()));
        if (current.closed || resyncRequested) {
          subscription.close();
        } else {
          current.connected = true;
          current.everConnected = true;
          current.retryDelayMs = initialRetryDelayMs;
          complete(current.connection);
          complete(current.ready);
          publishConnectionState("connected");
        }

        const streamExit = yield* Effect.result(
          Effect.tryPromise({
            try: () => subscription.done,
            catch: (cause) => new CoreEventControlPlaneFailure({ cause }),
          }),
        );
        if (Result.isFailure(streamExit)) {
          return { interruption: streamExit.failure, resyncRequested };
        }

        const flushed = Deferred.makeUnsafe<void>();
        Queue.offerUnsafe(deliveryQueue, { flush: flushed });
        yield* Deferred.await(flushed);
        return { interruption: deliveryError, resyncRequested };
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            const current = state();
            current.active = null;
            transitionToDisconnected();
          }),
        ),
      ),
    );

  const loop = Effect.gen(function* () {
    while (!state().closed) {
      const attempt = yield* runPhysicalAttempt();
      const current = state();
      if (current.closed) return { _tag: "Closed" } as const;

      const terminal =
        attempt.interruption?.cause instanceof CoreEventCompatibilityError ||
        (!current.everConnected &&
          current.initialOpenAttempts >=
            (input.maxInitialOpenAttempts ?? Number.POSITIVE_INFINITY)) ||
        (attempt.interruption !== null &&
          input.shouldRetry !== undefined &&
          !input.shouldRetry(attempt.interruption.cause));
      if (terminal) {
        const error =
          attempt.interruption ??
          new CoreEventControlPlaneFailure({
            cause: new Error("Core event stream ended before opening"),
          });
        current.terminalError = error;
        fail(current.ready, error);
        fail(current.connection, error);
        yield* Effect.sync(() => input.onInterrupted?.(attempt.interruption?.cause ?? null));
        return { _tag: "Failed", error } as const;
      }

      if (!attempt.resyncRequested) {
        yield* Effect.sync(() => input.onInterrupted?.(attempt.interruption?.cause ?? null));
      }
      if (attempt.resyncRequested) continue;

      if (current.forceImmediateReconnect) {
        current.forceImmediateReconnect = false;
        continue;
      }
      if (current.retryDelayMs <= 0) continue;

      const wake = Deferred.makeUnsafe<void>();
      current.retryWake = wake;
      yield* Effect.raceFirst(waitForCoreEventRetry(current.retryDelayMs), Deferred.await(wake));
      current.retryWake = null;
      current.retryDelayMs = Math.min(current.retryDelayMs * 2, maxRetryDelayMs);
    }
    return { _tag: "Closed" } as const;
  }).pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => {
        const current = state();
        const error =
          current.terminalError ??
          new CoreEventControlPlaneFailure({
            cause: Exit.isFailure(exit) ? Cause.squash(exit.cause) : closedError(),
          });
        fail(current.ready, error);
        fail(current.connection, error);
      }),
    ),
  );

  const fiber = forkControlPlane(loop);
  const done = fiber.result.then((exit): void => {
    if (Exit.isFailure(exit)) {
      if (state().closed) return;
      throw Cause.squash(exit.cause);
    }
    if (exit.value._tag === "Failed") throw exit.value.error.cause;
  });
  const ready = deferredPromise(state().ready);
  void ready.catch(() => undefined);

  return {
    done,
    ready,
    waitUntilConnected: () => {
      const current = state();
      if (current.connected) return Promise.resolve();
      if (current.terminalError !== null) return Promise.reject(current.terminalError.cause);
      if (current.closed) return Promise.reject(closedError());
      return deferredPromise(current.connection);
    },
    reconnectAfterSubscriptionLoss: () => {
      const current = state();
      if (current.terminalError !== null) return Promise.reject(current.terminalError.cause);
      if (current.closed) return Promise.reject(closedError());
      current.forceImmediateReconnect = true;
      if (current.connected) {
        transitionToDisconnected();
        current.active?.close();
      }
      if (current.retryWake !== null) complete(current.retryWake);
      return deferredPromise(current.connection);
    },
    close: () => {
      const current = state();
      if (current.closed) return;
      current.closed = true;
      current.active?.close();
      if (current.retryWake !== null) complete(current.retryWake);
      fiber.interrupt();
    },
  };
}
