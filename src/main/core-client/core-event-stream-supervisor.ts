import type {
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreEventSubscription,
} from "./types";
import {
  CoreEventCompatibilityError,
  CoreHttpError,
} from "./uds-http";

interface EventReplayBoundary {
  readonly event_head: number;
}

export interface CoreEventStreamSupervisorInput<
  ResyncBoundary extends EventReplayBoundary = CoreEventReplayRequired,
> {
  readonly initialAfter: number;
  readonly open: (
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired: (event: ResyncBoundary) => void,
    signal: AbortSignal,
  ) => Promise<CoreEventSubscription>;
  readonly onEvent: (event: CoreEventEnvelope) => unknown;
  readonly onResyncRequired: (
    event: ResyncBoundary,
  ) => unknown;
  readonly onInterrupted?: (error: unknown | null) => void;
  readonly onConnectionStateChanged?: (
    state: "connected" | "disconnected",
  ) => void;
  readonly shouldRetry?: (error: unknown | null) => boolean;
  readonly maxInitialOpenAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
}

export interface SupervisedCoreEventSubscription
  extends CoreEventSubscription {
  /** Resolves only after the first physical stream is authenticated and open. */
  readonly ready: Promise<void>;
  /** Waits for the physical stream that currently backs the logical subscription. */
  waitUntilConnected(): Promise<void>;
  /** Invalidates a lost server-side lease and waits for a fresh physical stream. */
  reconnectAfterSubscriptionLoss(): Promise<void>;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly settled: boolean;
  resolve(): void;
  reject(error: unknown): void;
}

const deferred = (): Deferred => {
  let settled = false;
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // A connection barrier may be replaced before a command waits on it.
  // Attach a handler now so terminal cleanup never creates an unhandled rejection.
  void promise.catch(() => undefined);
  return {
    get settled() {
      return settled;
    },
    resolve: () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
    reject: (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
    promise,
  };
};

const closedError = (): Error =>
  new Error("Core event subscription is closed");

export const isRetryableCoreEventStreamError = (
  error: unknown | null,
): boolean => {
  if (!(error instanceof CoreHttpError)) return true;
  return error.status === 409 || error.status === 429 || error.status >= 500;
};

export function superviseCoreEventStream<
  ResyncBoundary extends EventReplayBoundary = CoreEventReplayRequired,
>(
  input: CoreEventStreamSupervisorInput<ResyncBoundary>,
): SupervisedCoreEventSubscription {
  let after = input.initialAfter;
  let closed = false;
  let connected = false;
  let everConnected = false;
  let terminalError: unknown | null = null;
  let active: CoreEventSubscription | null = null;
  let opening: AbortController | null = null;
  let cancelRetryWait: (() => void) | null = null;
  let connection = deferred();
  const ready = deferred();
  const initialRetryDelayMs = input.retryDelayMs ?? 250;
  const maxRetryDelayMs = input.maxRetryDelayMs ?? 5_000;
  let retryDelayMs = initialRetryDelayMs;
  let initialOpenAttempts = 0;

  const publishConnectionState = (
    state: "connected" | "disconnected",
  ): void => {
    try {
      input.onConnectionStateChanged?.(state);
    } catch {
      // Lifecycle observation must not terminate the stream supervisor.
    }
  };

  const transitionToDisconnected = (): void => {
    if (!connected) return;
    connected = false;
    connection = deferred();
    publishConnectionState("disconnected");
  };

  const waitForRetry = async (milliseconds: number): Promise<void> => {
    if (milliseconds <= 0 || closed) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cancelRetryWait = null;
        resolve();
      }, milliseconds);
      cancelRetryWait = () => {
        clearTimeout(timer);
        cancelRetryWait = null;
        resolve();
      };
    });
  };

  const done = (async () => {
    try {
      while (!closed) {
        let resyncRequested = false;
        let interruption: unknown | null = null;
        let delivery = Promise.resolve();
        let deliveryError: unknown | null = null;
        const enqueue = (work: () => void | Promise<void>): void => {
          delivery = delivery.then(async () => {
            if (deliveryError !== null) return;
            await work();
          }).catch((error) => {
            deliveryError ??= error;
            active?.close();
          });
        };
        try {
          if (!everConnected) initialOpenAttempts += 1;
          const attempt = new AbortController();
          opening = attempt;
          const subscription = await input.open(
            after,
            (envelope) => {
              enqueue(async () => {
                await input.onEvent(envelope);
                after = Math.max(after, envelope.event.sequence);
              });
            },
            (boundary) => {
              resyncRequested = true;
              enqueue(async () => {
                await input.onResyncRequired(boundary);
                after = boundary.event_head;
              });
              active?.close();
            },
            attempt.signal,
          );
          opening = null;
          active = subscription;
          if (closed || resyncRequested) {
            subscription.close();
          } else {
            connected = true;
            everConnected = true;
            retryDelayMs = initialRetryDelayMs;
            connection.resolve();
            ready.resolve();
            publishConnectionState("connected");
          }
          await subscription.done;
          await delivery;
          if (deliveryError !== null) throw deliveryError;
        } catch (error) {
          interruption = error;
        } finally {
          opening = null;
          active = null;
          transitionToDisconnected();
        }
        if (closed) return;
        const terminal =
          interruption instanceof CoreEventCompatibilityError
          || (
            !everConnected
            && (
              initialOpenAttempts >= (
                input.maxInitialOpenAttempts ?? Number.POSITIVE_INFINITY
              )
            )
          )
          || (
            interruption !== null
            && input.shouldRetry !== undefined
            && !input.shouldRetry(interruption)
          );
        if (terminal) {
          terminalError = interruption ??
            new Error("Core event stream ended before opening");
          ready.reject(terminalError);
          connection.reject(terminalError);
          input.onInterrupted?.(interruption);
          throw terminalError;
        }
        if (!resyncRequested) input.onInterrupted?.(interruption);
        if (!resyncRequested && retryDelayMs > 0) {
          await waitForRetry(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, maxRetryDelayMs);
        }
      }
    } finally {
      const error = terminalError ?? closedError();
      ready.reject(error);
      connection.reject(error);
    }
  })();

  return {
    done,
    ready: ready.promise,
    waitUntilConnected: () => {
      if (connected) return Promise.resolve();
      if (terminalError !== null) return Promise.reject(terminalError);
      if (closed) return Promise.reject(closedError());
      return connection.promise;
    },
    reconnectAfterSubscriptionLoss: () => {
      if (terminalError !== null) return Promise.reject(terminalError);
      if (closed) return Promise.reject(closedError());
      if (connected) {
        transitionToDisconnected();
        active?.close();
      }
      cancelRetryWait?.();
      return connection.promise;
    },
    close: () => {
      if (closed) return;
      closed = true;
      opening?.abort(closedError());
      active?.close();
      cancelRetryWait?.();
    },
  };
}
