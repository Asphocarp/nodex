import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { ServerRequestMethod } from "@nodex/effect-codex-app-server/rpc";
import {
  CodexAppServerInputStreamEndedError,
  CodexAppServerRequestError,
  type CodexAppServerError,
} from "@nodex/effect-codex-app-server/errors";

export interface ConversationServerRequest {
  readonly hostId: string;
  readonly generation: number;
  readonly requestId: string | number;
  readonly method: ServerRequestMethod;
  readonly params: unknown;
}

export type ConversationRuntimeEvent =
  | { readonly kind: "server-request"; readonly value: ConversationServerRequest }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown };

export interface ConversationRuntimeEventEnvelope {
  readonly threadId: string;
  readonly sequence: number;
  readonly event: ConversationRuntimeEvent;
}

export type ConversationRuntimeState =
  | { readonly kind: "active"; readonly sequence: number; readonly pendingRequests: number }
  | { readonly kind: "closing"; readonly sequence: number; readonly pendingRequests: number };

interface PendingRequest {
  readonly generation: number;
  readonly response: Deferred.Deferred<unknown, CodexAppServerError>;
}

export class ConversationRuntime extends Context.Service<
  ConversationRuntime,
  {
    readonly threadId: string;
    readonly state: SubscriptionRef.SubscriptionRef<ConversationRuntimeState>;
    readonly events: Stream.Stream<ConversationRuntimeEventEnvelope>;
    readonly publish: (event: ConversationRuntimeEvent) => Effect.Effect<void>;
    readonly request: (
      request: ConversationServerRequest,
    ) => Effect.Effect<unknown, CodexAppServerError>;
    readonly respond: (
      generation: number,
      requestId: string | number,
      response: unknown,
    ) => Effect.Effect<boolean>;
    readonly reject: (
      generation: number,
      requestId: string | number,
      error: CodexAppServerError,
    ) => Effect.Effect<boolean>;
  }
>()("nodex/main/codex-application/ConversationRuntime") {}

export class ConversationRuntimeMap extends Context.Service<
  ConversationRuntimeMap,
  {
    readonly runtime: (threadId: string) => Effect.Effect<ConversationRuntime["Service"]>;
    readonly close: (threadId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/ConversationRuntimeMap") {}

const requestKey = (generation: number, requestId: string | number): string =>
  `${generation}:${typeof requestId}:${requestId}`;

const runtimeLayer = (threadId: string): Layer.Layer<ConversationRuntime> =>
  Layer.effect(
    ConversationRuntime,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<ConversationRuntimeState>({
        kind: "active",
        sequence: 0,
        pendingRequests: 0,
      });
      const events = yield* PubSub.unbounded<ConversationRuntimeEventEnvelope>();
      const pending = yield* Ref.make<ReadonlyMap<string, PendingRequest>>(new Map());
      const publishLock = yield* Semaphore.make(1);

      const syncPendingCount = Ref.get(pending).pipe(
        Effect.flatMap((current) =>
          SubscriptionRef.update(state, (value) => ({
            ...value,
            pendingRequests: current.size,
          })),
        ),
      );

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const outstanding = yield* Ref.getAndSet(pending, new Map());
          const current = yield* SubscriptionRef.get(state);
          const closing: ConversationRuntimeState = {
            kind: "closing",
            sequence: current.sequence,
            pendingRequests: 0,
          };
          yield* SubscriptionRef.set(state, closing);
          yield* Effect.forEach(
            outstanding.values(),
            ({ response }) =>
              Deferred.fail(response, new CodexAppServerInputStreamEndedError()).pipe(
                Effect.asVoid,
              ),
            { discard: true },
          );
          yield* PubSub.shutdown(events);
        }),
      );

      const publish = Effect.fn("ConversationRuntime.publish")((event: ConversationRuntimeEvent) =>
        SubscriptionRef.modify(state, (current) => {
          const sequence = current.sequence + 1;
          return [
            sequence,
            {
              ...current,
              sequence,
            },
          ];
        }).pipe(
          Effect.flatMap((sequence) =>
            PubSub.publish(events, { threadId, sequence, event }).pipe(Effect.asVoid),
          ),
          publishLock.withPermits(1),
        ),
      );

      const complete = Effect.fn("ConversationRuntime.complete")(
        (
          generation: number,
          id: string | number,
          finish: (pending: PendingRequest) => Effect.Effect<boolean>,
        ) =>
          Ref.modify(pending, (current) => {
            const key = requestKey(generation, id);
            const entry = current.get(key);
            if (entry === undefined) return [undefined, current] as const;
            const next = new Map(current);
            next.delete(key);
            return [entry, next] as const;
          }).pipe(
            Effect.flatMap((entry) =>
              entry === undefined
                ? Effect.succeed(false)
                : finish(entry).pipe(Effect.tap(() => syncPendingCount)),
            ),
          ),
      );

      return ConversationRuntime.of({
        threadId,
        state,
        events: Stream.fromPubSub(events),
        publish,
        request: (request) =>
          Effect.gen(function* () {
            const key = requestKey(request.generation, request.requestId);
            const response = yield* Deferred.make<unknown, CodexAppServerError>();
            const inserted = yield* Ref.modify(pending, (current) => {
              if (current.has(key)) return [false, current] as const;
              const next = new Map(current);
              next.set(key, { generation: request.generation, response });
              return [true, next] as const;
            });
            if (!inserted) {
              return yield* CodexAppServerRequestError.internalError(
                "Duplicate Codex server request",
                undefined,
                { method: request.method, requestId: String(request.requestId) },
              );
            }
            yield* syncPendingCount;
            yield* publish({ kind: "server-request", value: request });
            return yield* Deferred.await(response).pipe(
              Effect.ensuring(
                Ref.update(pending, (current) => {
                  if (!current.has(key)) return current;
                  const next = new Map(current);
                  next.delete(key);
                  return next;
                }).pipe(Effect.andThen(syncPendingCount)),
              ),
            );
          }),
        respond: (generation, id, response) =>
          complete(generation, id, ({ response: deferred }) =>
            Deferred.succeed(deferred, response),
          ),
        reject: (generation, id, error) =>
          complete(generation, id, ({ response }) => Deferred.fail(response, error)),
      });
    }),
  );

/** A thread runtime is process-cached and only released by close/invalidation or root Scope close. */
export const live: Layer.Layer<ConversationRuntimeMap> = Layer.effect(
  ConversationRuntimeMap,
  Effect.gen(function* () {
    const runtimes = yield* LayerMap.make(runtimeLayer, { idleTimeToLive: Duration.infinity });
    return ConversationRuntimeMap.of({
      runtime: (threadId) =>
        Effect.scoped(runtimes.contextEffect(threadId)).pipe(
          Effect.map((context) => Context.get(context, ConversationRuntime)),
        ),
      close: runtimes.invalidate,
    });
  }),
);
