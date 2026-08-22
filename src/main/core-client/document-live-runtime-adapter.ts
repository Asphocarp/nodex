import * as Effect from "effect/Effect";
import type { DocumentSyncRealtimeEvent } from "../../shared/block-documents/document-sync";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  documentLiveRuntimeError,
  type DocumentLiveRuntime,
  type DocumentLiveRuntimeError,
  type DocumentLiveSubscriptionInput,
} from "../core-runtime/DocumentLiveRuntime";
import type {
  CoreDocumentEventSubscription,
  CoreEventEnvelope,
  DocumentLiveBarrier,
  DocumentLiveRepair,
} from "./types";

export interface DocumentLiveSubscriptionHandle extends Omit<
  CoreDocumentEventSubscription,
  "barrier"
> {
  readonly ready: Promise<DocumentLiveBarrier>;
  waitUntilConnected(): Promise<void>;
  reconnectAfterSubscriptionLoss(): Promise<void>;
}

export interface DocumentLiveRuntimeAdapterInput {
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

export interface DocumentLiveRuntimeAdapter {
  subscribe(input: DocumentLiveRuntimeAdapterInput): DocumentLiveSubscriptionHandle;
}

const callback = (
  operation: string,
  run: () => void | Promise<void>,
): Effect.Effect<void, ReturnType<typeof documentLiveRuntimeError>> =>
  Effect.tryPromise({
    try: async () => await run(),
    catch: (cause) => documentLiveRuntimeError(operation, cause),
  });

/** Promise projection used only by the existing Core client/renderer Adapter seam. */
export const makeDocumentLiveRuntimeAdapter = (
  runtime: DocumentLiveRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): DocumentLiveRuntimeAdapter => ({
  subscribe: (input) => {
    const lease = callbacks.runPromise(
      runtime.subscribe({
        open: (onEvent, onRepair, onRealtime) =>
          Effect.tryPromise({
            try: async (signal) => {
              const subscription = await input.open(onEvent, onRepair, onRealtime, signal);
              return {
                barrier: subscription.barrier,
                done: Effect.tryPromise({
                  try: () => subscription.done,
                  catch: (cause) => documentLiveRuntimeError("stream.done", cause),
                }),
                close: Effect.sync(() => subscription.close()).pipe(Effect.ignoreCause),
              };
            },
            catch: (cause) => documentLiveRuntimeError("stream.open", cause),
          }),
        onEvent: (event) => callback("delivery.event", () => input.onEvent(event)),
        onRepair: (repair) => callback("delivery.repair", () => input.onRepair(repair)),
        onRealtime: (event) => callback("delivery.realtime", () => input.onRealtime(event)),
        onOpened: (barrier, reconnected) =>
          callback("delivery.opened", () => input.onOpened?.(barrier, reconnected)),
        onInterrupted: (cause) => Effect.sync(() => input.onInterrupted?.(cause)),
        onConnectionStateChanged: (state) =>
          Effect.sync(() => input.onConnectionStateChanged?.(state)),
        shouldRetry: input.shouldRetry ?? (() => true),
        maxInitialOpenAttempts: input.maxInitialOpenAttempts ?? Number.POSITIVE_INFINITY,
        retryDelay: input.retryDelayMs ?? 250,
        maxRetryDelay: input.maxRetryDelayMs ?? 5_000,
      } satisfies DocumentLiveSubscriptionInput),
    );
    let closed = false;
    const run = <Value>(
      operation: (active: Awaited<typeof lease>) => Effect.Effect<Value, DocumentLiveRuntimeError>,
    ): Promise<Value> => lease.then((active) => callbacks.runPromise(operation(active)));
    const ready = run((active) => active.ready);
    const done = run((active) => active.done);
    // Both observations are optional. Attaching a handler prevents an ignored
    // subscription from becoming an unhandled rejection while preserving the
    // original Promise for callers that do await it.
    void ready.catch(() => undefined);
    void done.catch(() => undefined);

    return {
      ready,
      done,
      waitUntilConnected: () => run((active) => active.waitUntilConnected),
      reconnectAfterSubscriptionLoss: () => run((active) => active.reconnectAfterSubscriptionLoss),
      close: () => {
        if (closed) return;
        closed = true;
        void lease
          .then((active) => {
            callbacks.fork(active.close);
          })
          .catch(() => undefined);
      },
    };
  },
});
