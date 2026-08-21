import type { DocumentSyncRealtimeEvent } from "../../shared/block-documents/document-sync";
import type {
  CoreDocumentEventSubscription,
  CoreEventEnvelope,
  DocumentLiveBarrier,
  DocumentLiveRepair,
} from "./types";
import { CoreEventCompatibilityError } from "./uds-http";

export interface SupervisedDocumentLiveSubscription extends Omit<
  CoreDocumentEventSubscription,
  "barrier"
> {
  readonly ready: Promise<DocumentLiveBarrier>;
  waitUntilConnected(): Promise<void>;
  reconnectAfterSubscriptionLoss(): Promise<void>;
}

interface DocumentLiveStreamSupervisorInput {
  readonly open: (
    onEvent: (event: CoreEventEnvelope) => void,
    onRepair: (repair: DocumentLiveRepair) => void,
    onRealtime: (event: DocumentSyncRealtimeEvent) => void,
    signal: AbortSignal,
  ) => Promise<CoreDocumentEventSubscription>;
  readonly onEvent: (event: CoreEventEnvelope) => void | Promise<void>;
  readonly onRepair: (repair: DocumentLiveRepair) => void | Promise<void>;
  readonly onRealtime: (event: DocumentSyncRealtimeEvent) => void | Promise<void>;
  readonly onOpened?: (barrier: DocumentLiveBarrier, reconnected: boolean) => void | Promise<void>;
  readonly onInterrupted?: (error: unknown | null) => void;
  readonly onConnectionStateChanged?: (state: "connected" | "disconnected") => void;
  readonly shouldRetry?: (error: unknown | null) => boolean;
  readonly maxInitialOpenAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly settled: boolean;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

const deferred = <Value>(): Deferred<Value> => {
  let settled = false;
  let resolvePromise: (value: Value) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);
  return {
    get settled() {
      return settled;
    },
    resolve: (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject: (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
    promise,
  };
};

const closedError = (): Error => new Error("Core Document live subscription is closed");

export function superviseDocumentLiveStream(
  input: DocumentLiveStreamSupervisorInput,
): SupervisedDocumentLiveSubscription {
  let closed = false;
  let connected = false;
  let everConnected = false;
  let terminalError: unknown | null = null;
  let active: CoreDocumentEventSubscription | null = null;
  let opening: AbortController | null = null;
  let cancelRetryWait: (() => void) | null = null;
  let connection = deferred<void>();
  const ready = deferred<DocumentLiveBarrier>();
  const initialRetryDelayMs = input.retryDelayMs ?? 250;
  const maxRetryDelayMs = input.maxRetryDelayMs ?? 5_000;
  let retryDelayMs = initialRetryDelayMs;
  let initialOpenAttempts = 0;

  const publishConnectionState = (state: "connected" | "disconnected"): void => {
    try {
      input.onConnectionStateChanged?.(state);
    } catch {
      // Connection observation cannot terminate the authority lease.
    }
  };

  const transitionToDisconnected = (): void => {
    if (!connected) return;
    connected = false;
    connection = deferred<void>();
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
      for (;;) {
        if (closed) return;
        let repairRequested = false;
        let interruption: unknown | null = null;
        let delivery = Promise.resolve();
        let deliveryError: unknown | null = null;
        const enqueue = (work: () => void | Promise<void>): void => {
          delivery = delivery
            .then(async () => {
              if (deliveryError !== null) return;
              await work();
            })
            .catch((error) => {
              deliveryError ??= error;
              active?.close();
            });
        };
        try {
          if (!everConnected) initialOpenAttempts += 1;
          const attempt = new AbortController();
          opening = attempt;
          const subscription = await input.open(
            (event) => enqueue(() => input.onEvent(event)),
            (repair) => {
              repairRequested = true;
              // Make the closing lease unavailable before consumers react to
              // the repair. Otherwise a synchronous resync can race against
              // the physical stream and Core subscription being torn down.
              transitionToDisconnected();
              enqueue(() => input.onRepair(repair));
              active?.close();
            },
            (event) => enqueue(() => input.onRealtime(event)),
            attempt.signal,
          );
          opening = null;
          active = subscription;
          if (closed || repairRequested) {
            subscription.close();
          } else {
            await input.onOpened?.(subscription.barrier, everConnected);
            connected = true;
            everConnected = true;
            retryDelayMs = initialRetryDelayMs;
            connection.resolve();
            ready.resolve(subscription.barrier);
            publishConnectionState("connected");
          }
          await subscription.done;
          await delivery;
          if (deliveryError !== null) throw deliveryError;
        } catch (error) {
          interruption = error;
          active?.close();
        } finally {
          opening = null;
          active = null;
          transitionToDisconnected();
        }
        if (closed) return;
        const terminal =
          interruption instanceof CoreEventCompatibilityError ||
          (!everConnected &&
            initialOpenAttempts >= (input.maxInitialOpenAttempts ?? Number.POSITIVE_INFINITY)) ||
          (interruption !== null &&
            input.shouldRetry !== undefined &&
            !input.shouldRetry(interruption));
        if (terminal) {
          terminalError =
            interruption ?? new Error("Core Document live stream ended before its barrier");
          ready.reject(terminalError);
          connection.reject(terminalError);
          input.onInterrupted?.(interruption);
          throw terminalError;
        }
        if (!repairRequested) input.onInterrupted?.(interruption);
        if (!repairRequested && retryDelayMs > 0) {
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
