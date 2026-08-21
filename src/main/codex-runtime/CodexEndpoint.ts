import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { CodexSessionTransport } from "../platform/node/CodexSessionTransport";
import { CodexAppServerSession, type CodexAppServerSessionService } from "./CodexAppServerSession";
import { CodexEventHub, type CodexEndpointConnection } from "./CodexEventHub";
import { codexRuntimeError, type CodexRuntimeError } from "./CodexRuntimeError";
import { CodexServerRequestRuntime } from "./CodexServerRequestRuntime";

export interface CodexEndpointConfig {
  readonly hostId: string;
  readonly sessionLayer: (
    generation: number,
  ) => Layer.Layer<CodexAppServerSession, CodexRuntimeError, CodexSessionTransport>;
  readonly retryBase?: Duration.Input;
  readonly retryCap?: Duration.Input;
  readonly jitter?: boolean;
}

interface ActiveSession {
  readonly scope: Scope.Closeable;
  readonly session: CodexAppServerSessionService;
}

export class CodexEndpoint extends Context.Service<
  CodexEndpoint,
  {
    readonly hostId: string;
    readonly state: SubscriptionRef.SubscriptionRef<CodexEndpointConnection>;
    readonly session: Effect.Effect<CodexAppServerSessionService, CodexRuntimeError>;
  }
>()("nodex/main/codex-runtime/CodexEndpoint") {}

const openingSchedule = (config: CodexEndpointConfig) => {
  const capped = Schedule.min([
    Schedule.exponential(config.retryBase ?? "250 millis"),
    Schedule.spaced(config.retryCap ?? "5 seconds"),
  ]);
  return config.jitter === false ? capped : capped.pipe(Schedule.jittered);
};

export const live = (
  config: CodexEndpointConfig,
): Layer.Layer<
  CodexEndpoint,
  never,
  CodexSessionTransport | CodexEventHub | CodexServerRequestRuntime
> =>
  Layer.effect(
    CodexEndpoint,
    Effect.gen(function* () {
      const hostId = config.hostId.trim();
      const eventHub = yield* CodexEventHub;
      const serverRequests = yield* CodexServerRequestRuntime;
      const state = yield* SubscriptionRef.make<CodexEndpointConnection>({
        kind: "connecting",
        hostId,
        generation: 1,
      });
      const generation = yield* Ref.make(0);
      const active = yield* Ref.make<Option.Option<ActiveSession>>(Option.none());

      const publishConnection = Effect.fn("CodexEndpoint.publishConnection")(function* (
        connection: CodexEndpointConnection,
      ) {
        yield* SubscriptionRef.set(state, connection);
        yield* eventHub.publish({ kind: "connection", value: connection });
      });

      const closeActive = Effect.fn("CodexEndpoint.closeActive")(function* () {
        const current = yield* Ref.getAndSet(active, Option.none());
        if (Option.isNone(current)) return;
        yield* Scope.close(current.value.scope, Exit.void);
      });

      const acquireSession = Effect.fn("CodexEndpoint.acquireSession")(function* (
        currentGeneration: number,
      ) {
        const attemptScope = yield* Scope.make();
        const acquired = yield* Effect.result(
          Effect.gen(function* () {
            const context = yield* Layer.buildWithScope(
              config.sessionLayer(currentGeneration),
              attemptScope,
            );
            const session = Context.get(context, CodexAppServerSession);
            yield* session.client
              .handleServerRequestFallback((method, params, requestId) =>
                serverRequests.handle(hostId, currentGeneration, requestId, method, params),
              )
              .pipe(Effect.provideService(Scope.Scope, attemptScope));
            yield* session.client.raw.notifications.pipe(
              Stream.runForEach((value) =>
                eventHub.publish({
                  kind: "notification",
                  hostId,
                  generation: currentGeneration,
                  value,
                }),
              ),
              Effect.forkIn(attemptScope),
            );
            yield* session.client.raw.requests.pipe(
              Stream.runForEach((value) =>
                eventHub.publish({
                  kind: "request",
                  hostId,
                  generation: currentGeneration,
                  value,
                }),
              ),
              Effect.forkIn(attemptScope),
            );
            return session;
          }),
        );
        if (acquired._tag === "Success") {
          const owned = { scope: attemptScope, session: acquired.success };
          yield* Ref.set(active, Option.some(owned));
          return owned;
        }
        yield* Scope.close(attemptScope, Exit.void);
        return yield* acquired.failure;
      });

      const retryPolicy = openingSchedule(config).pipe(
        Schedule.setInputType<CodexRuntimeError>(),
        Schedule.while(({ input }) => input.retryable),
        Schedule.tap(({ input, attempt }) =>
          Ref.get(generation).pipe(
            Effect.flatMap((currentGeneration) =>
              publishConnection({
                kind: "backing-off",
                hostId,
                generation: currentGeneration,
                attempt,
                error: input,
              }),
            ),
          ),
        ),
      );
      const reconnectDelay = Duration.fromInputUnsafe(config.retryBase ?? "250 millis");

      const openAttempt = Effect.fn("CodexEndpoint.openAttempt")(function* () {
        const currentGeneration = yield* Ref.updateAndGet(generation, (value) => value + 1);
        yield* publishConnection({ kind: "connecting", hostId, generation: currentGeneration });
        return yield* acquireSession(currentGeneration);
      });

      const runAttempt = Effect.fn("CodexEndpoint.runAttempt")(function* () {
        const owned = yield* openAttempt().pipe(Effect.retry(retryPolicy));
        const currentGeneration = owned.session.generation;
        yield* publishConnection({
          kind: "ready",
          hostId,
          generation: currentGeneration,
          pid: owned.session.pid,
        });
        return yield* owned.session.termination;
      });

      const cycle = runAttempt().pipe(
        Effect.catch((error) =>
          closeActive().pipe(
            Effect.andThen(
              error.retryable
                ? Ref.get(generation).pipe(
                    Effect.flatMap((currentGeneration) =>
                      publishConnection({
                        kind: "backing-off",
                        hostId,
                        generation: currentGeneration,
                        attempt: 1,
                        error,
                      }),
                    ),
                  )
                : Effect.void,
            ),
            Effect.andThen(error.retryable ? Effect.sleep(reconnectDelay) : Effect.fail(error)),
          ),
        ),
      );
      const supervisor = Effect.forever(cycle).pipe(
        Effect.catch((error) => publishConnection({ kind: "failed", hostId, error })),
      );

      yield* Effect.addFinalizer(() =>
        publishConnection({ kind: "closing", hostId }).pipe(
          Effect.andThen(closeActive()),
          Effect.andThen(publishConnection({ kind: "stopped", hostId })),
        ),
      );
      yield* Effect.forkScoped(supervisor);

      const session = SubscriptionRef.changes(state).pipe(
        Stream.filter(
          (connection) =>
            connection.kind === "ready" ||
            connection.kind === "failed" ||
            connection.kind === "stopped",
        ),
        Stream.runHead,
        Effect.scoped,
        Effect.flatMap((connection) => {
          if (Option.isNone(connection) || connection.value.kind === "stopped") {
            return Effect.fail(
              codexRuntimeError({
                operation: "endpoint.session",
                reason: "closing",
                retryable: false,
                hostId,
              }),
            );
          }
          if (connection.value.kind === "failed") return Effect.fail(connection.value.error);
          const ready = connection.value;
          return Ref.get(active).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    codexRuntimeError({
                      operation: "endpoint.session",
                      reason: "session-lost",
                      retryable: true,
                      hostId,
                      generation: ready.generation,
                    }),
                  ),
                onSome: ({ session }) => Effect.succeed(session),
              }),
            ),
          );
        }),
      );
      return CodexEndpoint.of({ hostId, state, session });
    }),
  );
