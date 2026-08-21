/* oxlint-disable effecttsgo/run-effect -- This isolated test fixture owns a private Scope for legacy Promise test construction. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  live as projectRuntimeLifecycleLive,
  ProjectRuntimeLifecycleRuntime,
} from "./ProjectRuntimeLifecycleRuntime";
import {
  makeProjectRuntimeLifecyclePromiseAdapter,
  type ProjectRuntimeLifecyclePromiseAdapter,
} from "./ProjectRuntimeLifecycleRuntimePromiseAdapter";

export interface ProjectRuntimeLifecycleTestHarness {
  readonly adapter: ProjectRuntimeLifecyclePromiseAdapter;
  readonly close: () => Promise<void>;
}

export const makeProjectRuntimeLifecycleTestHarness = (): ProjectRuntimeLifecycleTestHarness => {
  const scope = Scope.makeUnsafe();
  const context = Effect.runSync(Layer.buildWithScope(projectRuntimeLifecycleLive, scope));
  const runtime = Context.get(context, ProjectRuntimeLifecycleRuntime);
  const callbacks = {
    runPromise: <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect),
  } as ScopedCallbackRuntime["Service"];
  let closed = false;
  return {
    adapter: makeProjectRuntimeLifecyclePromiseAdapter(runtime, callbacks),
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
};
