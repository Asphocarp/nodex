import * as Effect from "effect/Effect";
import type { CodexManagedWorktreeRetentionPlan } from "../codex/codex-managed-worktree-retention";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  ManagedWorktreeRetentionRuntimeError,
  type ManagedWorktreeRetentionRuntime,
} from "./ManagedWorktreeRetentionRuntime";

export interface ManagedWorktreeRetentionRuntimePromiseAdapter {
  readonly request: (sweep: () => Promise<CodexManagedWorktreeRetentionPlan>) => void;
  readonly run: (
    sweep: () => Promise<CodexManagedWorktreeRetentionPlan>,
  ) => Promise<CodexManagedWorktreeRetentionPlan>;
}

const fromLegacySweep = (
  sweep: () => Promise<CodexManagedWorktreeRetentionPlan>,
): Effect.Effect<CodexManagedWorktreeRetentionPlan, ManagedWorktreeRetentionRuntimeError> =>
  Effect.tryPromise({
    try: sweep,
    catch: (cause) =>
      new ManagedWorktreeRetentionRuntimeError({
        operation: "run-sweep",
        cause,
      }),
  });

/** Temporary Promise boundary while retention policy still reads CodexService authorities. */
export const makeManagedWorktreeRetentionRuntimePromiseAdapter = (
  runtime: ManagedWorktreeRetentionRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): ManagedWorktreeRetentionRuntimePromiseAdapter => ({
  request: (sweep) => {
    callbacks.fork(runtime.request(fromLegacySweep(sweep)));
  },
  run: (sweep) => callbacks.runPromise(runtime.run(fromLegacySweep(sweep))),
});
