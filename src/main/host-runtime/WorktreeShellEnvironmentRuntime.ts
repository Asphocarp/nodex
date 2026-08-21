import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  CodexLocalShellEnvironmentLoader,
  type CodexLocalShellEnvironmentLoaderOptions,
} from "../codex/codex-worktree-shell-environment";

export class WorktreeShellEnvironmentRuntimeError extends Schema.TaggedError<WorktreeShellEnvironmentRuntimeError>()(
  "WorktreeShellEnvironmentRuntimeError",
  {
    cause: Schema.Defect(),
  },
) {}

export class WorktreeShellEnvironmentRuntime extends Context.Service<
  WorktreeShellEnvironmentRuntime,
  {
    readonly load: Effect.Effect<NodeJS.ProcessEnv, WorktreeShellEnvironmentRuntimeError>;
  }
>()("nodex/main/host-runtime/WorktreeShellEnvironmentRuntime") {}

export const live = (
  options: CodexLocalShellEnvironmentLoaderOptions = {},
): Layer.Layer<WorktreeShellEnvironmentRuntime> =>
  Layer.effect(
    WorktreeShellEnvironmentRuntime,
    Effect.gen(function* () {
      const loader = new CodexLocalShellEnvironmentLoader(options);
      yield* Effect.addFinalizer(() => Effect.sync(() => loader.close()));
      return WorktreeShellEnvironmentRuntime.of({
        load: Effect.tryPromise({
          try: () => loader.load(),
          catch: (cause) => new WorktreeShellEnvironmentRuntimeError({ cause }),
        }),
      });
    }),
  );
