import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  layer as scopedCallbackRuntimeLayer,
  ScopedCallbackRuntime,
} from "../app/ScopedCallbackRuntime";
import { make as makeDocumentLiveRuntime } from "../core-runtime/DocumentLiveRuntime";
import {
  makeDocumentLiveRuntimeAdapter,
  type DocumentLiveRuntimeAdapter,
  type DocumentLiveRuntimeAdapterInput,
  type DocumentLiveSubscriptionHandle,
} from "./document-live-runtime-adapter";

/** Builds the production live-stream graph inside an @effect/vitest-owned Scope. */
export const makeTestDocumentLiveRuntimeAdapter: Effect.Effect<
  DocumentLiveRuntimeAdapter,
  never,
  import("effect/Scope").Scope
> = Effect.gen(function* () {
  const runtime = yield* makeDocumentLiveRuntime;
  const callbackContext = yield* Layer.build(scopedCallbackRuntimeLayer);
  const callbacks = Context.get(callbackContext, ScopedCallbackRuntime);
  return makeDocumentLiveRuntimeAdapter(runtime, callbacks);
});

interface TestDeferred<Value> {
  readonly promise: Promise<Value>;
  reject(cause: unknown): void;
  resolve(value: Value): void;
}

const testDeferred = <Value>(): TestDeferred<Value> => {
  let resolvePromise: (value: Value) => void = () => undefined;
  let rejectPromise: (cause: unknown) => void = () => undefined;
  let settled = false;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);
  return {
    promise,
    reject: (cause) => {
      if (settled) return;
      settled = true;
      rejectPromise(cause);
    },
    resolve: (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
  };
};

const makeTestLease = (input: DocumentLiveRuntimeAdapterInput): DocumentLiveSubscriptionHandle => {
  let active: Awaited<ReturnType<typeof input.open>> | null = null;
  let closed = false;
  let connected = false;
  let connection = testDeferred<void>();
  let opening: AbortController | null = null;
  let delivery = Promise.resolve();
  const ready = testDeferred<Awaited<ReturnType<typeof input.open>>["barrier"]>();

  const disconnect = (): void => {
    if (!connected) return;
    connected = false;
    connection = testDeferred<void>();
    input.onConnectionStateChanged?.("disconnected");
  };
  const enqueue = (run: () => void | Promise<void>): void => {
    delivery = delivery.then(run);
  };

  const done = (async () => {
    let attempts = 0;
    let everConnected = false;
    try {
      for (;;) {
        if (closed) return;
        attempts += everConnected ? 0 : 1;
        const attempt = new AbortController();
        opening = attempt;
        try {
          active = await input.open(
            (event) => enqueue(() => input.onEvent(event)),
            (repair) => {
              disconnect();
              enqueue(() => input.onRepair(repair));
              active?.close();
            },
            (event) => enqueue(() => input.onRealtime(event)),
            attempt.signal,
          );
          opening = null;
          if (closed) {
            active.close();
            return;
          }
          await input.onOpened?.(active.barrier, everConnected);
          connected = true;
          everConnected = true;
          connection.resolve(undefined);
          ready.resolve(active.barrier);
          input.onConnectionStateChanged?.("connected");
          await active.done;
          await delivery;
          active = null;
          disconnect();
          if (!closed) input.onInterrupted?.(null);
        } catch (cause) {
          opening = null;
          active?.close();
          active = null;
          disconnect();
          if (closed) return;
          const terminal =
            (!everConnected && attempts >= (input.maxInitialOpenAttempts ?? Infinity)) ||
            (input.shouldRetry !== undefined && !input.shouldRetry(cause));
          if (!terminal) {
            input.onInterrupted?.(cause);
            continue;
          }
          ready.reject(cause);
          connection.reject(cause);
          input.onInterrupted?.(cause);
          throw cause;
        }
      }
    } finally {
      const error = new Error("Test Document live subscription is closed");
      ready.reject(error);
      connection.reject(error);
    }
  })();

  return {
    ready: ready.promise,
    done,
    waitUntilConnected: () => (connected ? Promise.resolve() : connection.promise),
    reconnectAfterSubscriptionLoss: () => {
      if (closed) return Promise.reject(new Error("Test Document live subscription is closed"));
      if (connected) {
        disconnect();
        active?.close();
      }
      return connection.promise;
    },
    close: () => {
      if (closed) return;
      closed = true;
      opening?.abort(new Error("Test Document live subscription is closed"));
      active?.close();
    },
  };
};

/** Deterministic Promise double for tests whose subject is above the live-runtime boundary. */
export const documentLiveRuntimeTestDouble: DocumentLiveRuntimeAdapter = {
  subscribe: makeTestLease,
};
