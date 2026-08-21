import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { ProjectRuntimeLifecycleRuntime } from "./ProjectRuntimeLifecycleRuntime";

export interface ProjectRuntimeLifecyclePromiseAdapter {
  readonly runExclusive: <A>(
    projectId: string | null,
    operation: () => A | Promise<A>,
  ) => Promise<A>;
}

class ProjectRuntimeLifecycleOperationError extends Data.TaggedError(
  "ProjectRuntimeLifecycleOperationError",
)<{ readonly cause: unknown }> {}

/** The sole bridge for callers that have not yet moved their operation body into Effect. */
export const makeProjectRuntimeLifecyclePromiseAdapter = (
  runtime: ProjectRuntimeLifecycleRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): ProjectRuntimeLifecyclePromiseAdapter => ({
  runExclusive: async (projectId, operation) => {
    try {
      return await callbacks.runPromise(
        runtime.runExclusive(
          projectId,
          Effect.tryPromise({
            try: () => Promise.resolve(operation()),
            catch: (cause) => new ProjectRuntimeLifecycleOperationError({ cause }),
          }),
        ),
      );
    } catch (error) {
      if (error instanceof ProjectRuntimeLifecycleOperationError) throw error.cause;
      throw error;
    }
  },
});
