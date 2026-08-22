import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type CodexLocalShellEnvironmentRuntimeError,
  make,
} from "../codex/CodexLocalShellEnvironmentRuntime";
import type { CodexLocalShellEnvironmentOptions } from "../codex/codex-worktree-shell-environment";

export class WorktreeShellEnvironmentRuntime extends Context.Service<
  WorktreeShellEnvironmentRuntime,
  {
    readonly load: Effect.Effect<NodeJS.ProcessEnv, CodexLocalShellEnvironmentRuntimeError>;
  }
>()("nodex/main/host-runtime/WorktreeShellEnvironmentRuntime") {}

export const live = (
  options: CodexLocalShellEnvironmentOptions = {},
): Layer.Layer<WorktreeShellEnvironmentRuntime> =>
  Layer.effect(
    WorktreeShellEnvironmentRuntime,
    Effect.gen(function* () {
      const runtime = yield* make(options);
      return WorktreeShellEnvironmentRuntime.of(runtime);
    }),
  );
