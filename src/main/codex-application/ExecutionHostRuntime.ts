import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { CodexGateway, CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import type { CodexExecutionHostConfig } from "../codex-runtime/CodexEndpointMap";
import { codexRuntimeError, type CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CoreModules } from "../core-runtime/CoreModules";

export class ExecutionHostRuntime extends Context.Service<
  ExecutionHostRuntime,
  {
    readonly hosts: SubscriptionRef.SubscriptionRef<ReadonlyMap<string, CodexExecutionHostConfig>>;
    readonly reconcile: (
      config: CodexExecutionHostConfig,
    ) => Effect.Effect<void, CodexRuntimeError>;
    readonly remove: (hostId: string) => Effect.Effect<void, CodexRuntimeError>;
  }
>()("nodex/main/codex-application/ExecutionHostRuntime") {}

export const live: Layer.Layer<ExecutionHostRuntime, never, CodexGateway> = Layer.effect(
  ExecutionHostRuntime,
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const hosts = yield* SubscriptionRef.make<ReadonlyMap<string, CodexExecutionHostConfig>>(
      new Map(),
    );
    return ExecutionHostRuntime.of({
      hosts,
      reconcile: (config) =>
        gateway.reconcileHost(config).pipe(
          Effect.andThen(
            SubscriptionRef.update(hosts, (current) => {
              const next = new Map(current);
              next.set(config.hostId, config);
              return next;
            }),
          ),
        ),
      remove: (hostId) =>
        gateway.removeHost(hostId).pipe(
          Effect.andThen(
            SubscriptionRef.update(hosts, (current) => {
              const next = new Map(current);
              next.delete(hostId);
              return next;
            }),
          ),
        ),
    });
  }),
);

/** Resolves routing from Core's durable Workspace authority, never from RPC payload heuristics. */
export const threadHostResolverLive: Layer.Layer<CodexThreadHostResolver, never, CoreModules> =
  Layer.effect(
    CodexThreadHostResolver,
    CoreModules.use((core) =>
      Effect.succeed(
        CodexThreadHostResolver.of({
          resolve: (threadId) =>
            core.workspace.read({ kind: "thread", thread_id: threadId }).pipe(
              Effect.mapError((cause) =>
                codexRuntimeError({
                  operation: "thread-host.resolve",
                  reason: "host-unavailable",
                  retryable: cause.retryable,
                  cause,
                }),
              ),
              Effect.flatMap((snapshot) =>
                snapshot.value.kind === "thread"
                  ? Effect.succeed(snapshot.value.thread.execution_host_id)
                  : Effect.fail(
                      codexRuntimeError({
                        operation: "thread-host.resolve-variant",
                        reason: "protocol",
                        retryable: false,
                        cause: new Error("Core returned a non-thread Workspace read variant"),
                      }),
                    ),
              ),
            ),
        }),
      ),
    ),
  );
