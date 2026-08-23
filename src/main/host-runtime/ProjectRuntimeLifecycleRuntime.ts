import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

interface ProjectRuntimeLifecycleLease {
  readonly projectId: string;
  readonly ownerFiberId: number;
}

const CurrentProjectRuntimeLifecycleLease = Context.Reference<ProjectRuntimeLifecycleLease | null>(
  "nodex/main/host-runtime/ProjectRuntimeLifecycleRuntime/CurrentLease",
  { defaultValue: () => null },
);

export class ProjectRuntimeLifecycleRuntime extends Context.Service<
  ProjectRuntimeLifecycleRuntime,
  {
    /**
     * Serializes a durable Project lifecycle commit with admission of new
     * Project-owned runtime work. Projectless work remains independent.
     */
    readonly runExclusive: <A, E, R>(
      projectId: string | null,
      operation: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
  }
>()("nodex/main/host-runtime/ProjectRuntimeLifecycleRuntime") {}

export const live: Layer.Layer<ProjectRuntimeLifecycleRuntime> = Layer.effect(
  ProjectRuntimeLifecycleRuntime,
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const gates = yield* RcMap.make({
      lookup: (_projectId: string) => Semaphore.make(1),
    });

    const runOwned = <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );

    const runExclusive = <A, E, R>(
      projectId: string | null,
      operation: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> => {
      const normalizedProjectId = projectId?.trim() || null;
      if (!normalizedProjectId) return runOwned(operation);

      return Effect.gen(function* () {
        const currentLease = yield* CurrentProjectRuntimeLifecycleLease;
        const currentFiberId = yield* Effect.fiberId;
        if (
          currentLease?.projectId === normalizedProjectId &&
          currentLease.ownerFiberId === currentFiberId
        ) {
          return yield* operation;
        }

        return yield* runOwned(
          Effect.scoped(
            Effect.gen(function* () {
              const gate = yield* RcMap.get(gates, normalizedProjectId);
              return yield* gate.withPermit(
                Effect.fiberId.pipe(
                  Effect.flatMap((ownerFiberId) =>
                    operation.pipe(
                      Effect.provideService(CurrentProjectRuntimeLifecycleLease, {
                        projectId: normalizedProjectId,
                        ownerFiberId,
                      }),
                    ),
                  ),
                ),
              );
            }),
          ),
        );
      });
    };

    return ProjectRuntimeLifecycleRuntime.of({ runExclusive });
  }),
);
