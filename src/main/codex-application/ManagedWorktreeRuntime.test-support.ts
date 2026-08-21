/* oxlint-disable effecttsgo/run-effect -- This isolated test fixture owns a private Scope for legacy synchronous test construction. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { CodexSshExecutionHostConfig } from "../../shared/types";
import type { CodexExecutionHostRegistry } from "../codex/codex-execution-host-registry";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { ExecutionHostRuntime } from "./ExecutionHostRuntime";
import {
  ManagedWorktreeRuntime,
  live as managedWorktreeRuntimeLive,
} from "./ManagedWorktreeRuntime";
import {
  makeManagedWorktreeRuntimePromiseAdapter,
  type ManagedWorktreeRuntimePromiseAdapter,
} from "./ManagedWorktreeRuntimePromiseAdapter";

export interface ManagedWorktreeRuntimeTestHarness {
  readonly adapter: ManagedWorktreeRuntimePromiseAdapter;
  readonly close: () => Promise<void>;
}

export const makeManagedWorktreeRuntimeTestHarness = (
  registry: CodexExecutionHostRegistry,
): ManagedWorktreeRuntimeTestHarness => {
  const scope = Scope.makeUnsafe();
  const activeSshHosts = Effect.runSync(
    SubscriptionRef.make<ReadonlyMap<string, CodexSshExecutionHostConfig>>(new Map()),
  );
  const executionHosts = ExecutionHostRuntime.of({
    registry,
    activeSshHosts,
    settings: Effect.succeed({ sshHosts: [] }),
    reconcile: () => Effect.void,
    updateSettings: () => Effect.succeed({ sshHosts: [] }),
  });
  const context = Effect.runSync(
    Layer.buildWithScope(
      managedWorktreeRuntimeLive.pipe(
        Layer.provide(Layer.succeed(ExecutionHostRuntime, executionHosts)),
      ),
      scope,
    ),
  );
  const runtime = Context.get(context, ManagedWorktreeRuntime);
  const callbacks = {
    runPromise: <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect),
  } as ScopedCallbackRuntime["Service"];
  let closed = false;
  return {
    adapter: makeManagedWorktreeRuntimePromiseAdapter(runtime, callbacks),
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
};
