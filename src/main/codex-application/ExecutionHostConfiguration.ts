import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type {
  CodexExecutionHostSettings,
  ManagedWorktreeSettings,
  UpdateCodexExecutionHostSettingsInput,
} from "../../shared/types";
import {
  getCodexExecutionHostSettings,
  getKnownManagedWorktreeRoots,
  getManagedWorktreeSettings,
  updateCodexExecutionHostSettings,
  updateManagedWorktreeSettings,
} from "../local-store/config";

export class ExecutionHostConfigurationError extends Schema.TaggedError<ExecutionHostConfigurationError>()(
  "ExecutionHostConfigurationError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class ExecutionHostConfiguration extends Context.Service<
  ExecutionHostConfiguration,
  {
    readonly settings: Effect.Effect<CodexExecutionHostSettings, ExecutionHostConfigurationError>;
    readonly update: (
      input: UpdateCodexExecutionHostSettingsInput,
    ) => Effect.Effect<CodexExecutionHostSettings, ExecutionHostConfigurationError>;
  }
>()("nodex/main/codex-application/ExecutionHostConfiguration") {}

export class ManagedWorktreeConfiguration extends Context.Service<
  ManagedWorktreeConfiguration,
  {
    readonly settings: Effect.Effect<ManagedWorktreeSettings, ExecutionHostConfigurationError>;
    readonly knownRoots: Effect.Effect<readonly string[], ExecutionHostConfigurationError>;
    readonly update: (
      input: Partial<ManagedWorktreeSettings>,
    ) => Effect.Effect<ManagedWorktreeSettings, ExecutionHostConfigurationError>;
  }
>()("nodex/main/codex-application/ManagedWorktreeConfiguration") {}

const attempt = <A>(operation: string, evaluate: () => A) =>
  Effect.try({
    try: evaluate,
    catch: (cause) => new ExecutionHostConfigurationError({ operation, cause }),
  });

/** Owns the Profile-local authority for host and managed-worktree configuration. */
export const live: Layer.Layer<ExecutionHostConfiguration | ManagedWorktreeConfiguration> =
  Layer.merge(
    Layer.succeed(
      ExecutionHostConfiguration,
      ExecutionHostConfiguration.of({
        settings: attempt("read-execution-hosts", getCodexExecutionHostSettings),
        update: (input) =>
          attempt("update-execution-hosts", () => updateCodexExecutionHostSettings(input)),
      }),
    ),
    Layer.succeed(
      ManagedWorktreeConfiguration,
      ManagedWorktreeConfiguration.of({
        settings: attempt("read-managed-worktrees", getManagedWorktreeSettings),
        knownRoots: attempt("read-known-managed-roots", getKnownManagedWorktreeRoots),
        update: (input) =>
          attempt("update-managed-worktrees", () => updateManagedWorktreeSettings(input)),
      }),
    ),
  );
