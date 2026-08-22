import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type {
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentOption,
  WorktreeEnvironmentSaveResult,
  WorktreeEnvironmentSettingsSnapshot,
} from "../../shared/types";
import { CODEX_APP_LOCAL_HOST_ID } from "../codex/codex-app-meta-thread-tools";
import { CoreModuleResponseError } from "../core-client/core-client";
import { CoreModules } from "../core-runtime/CoreModules";
import type { CoreRuntimeError } from "../core-runtime/CoreRuntimeError";
import {
  listWorktreeEnvironmentConfigs,
  listWorktreeEnvironmentOptions,
  readWorktreeEnvironmentSettingsSnapshot,
  saveWorktreeEnvironmentConfigFile,
} from "../codex/worktree-environment-service";

export class WorktreeEnvironmentRuntimeError extends Schema.TaggedError<WorktreeEnvironmentRuntimeError>()(
  "WorktreeEnvironmentRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class WorktreeEnvironmentRuntime extends Context.Service<
  WorktreeEnvironmentRuntime,
  {
    readonly listProjectOptions: (
      projectId: string,
    ) => Effect.Effect<WorktreeEnvironmentOption[], WorktreeEnvironmentRuntimeError>;
    readonly listProjectConfigs: (
      projectId: string,
    ) => Effect.Effect<WorktreeEnvironmentConfigRecord[], WorktreeEnvironmentRuntimeError>;
    readonly listWorkspaceConfigs: (
      hostId: string,
      workspaceRoot: string,
    ) => Effect.Effect<WorktreeEnvironmentConfigRecord[], WorktreeEnvironmentRuntimeError>;
    readonly readProjectConfig: (
      projectId: string,
      configPath?: string | null,
    ) => Effect.Effect<WorktreeEnvironmentSettingsSnapshot, WorktreeEnvironmentRuntimeError>;
    readonly saveProjectConfig: (
      input: UpdateWorktreeEnvironmentConfigInput,
    ) => Effect.Effect<WorktreeEnvironmentSaveResult, WorktreeEnvironmentRuntimeError>;
  }
>()("nodex/main/host-runtime/WorktreeEnvironmentRuntime") {}

interface ProjectEnvironmentLocation {
  readonly name: string;
  readonly workspacePath: string;
}

const isNotFound = (cause: CoreRuntimeError): boolean =>
  cause.cause instanceof CoreModuleResponseError && cause.cause.coreError.code === "not_found";

export interface WorktreeEnvironmentRuntimeOptions {
  readonly saveFile?: typeof saveWorktreeEnvironmentConfigFile;
}

export const makeLive = (
  options: WorktreeEnvironmentRuntimeOptions = {},
): Layer.Layer<WorktreeEnvironmentRuntime, never, CoreModules> =>
  Layer.effect(
    WorktreeEnvironmentRuntime,
    Effect.gen(function* () {
      const core = yield* CoreModules;
      const writes = yield* Semaphore.make(1);
      const saveFibers = yield* FiberSet.make<
        WorktreeEnvironmentSaveResult,
        WorktreeEnvironmentRuntimeError
      >();
      let accepting = true;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          accepting = false;
        }),
      );
      const error = (operation: string, cause: unknown) =>
        new WorktreeEnvironmentRuntimeError({ operation, cause });
      const ensureOpen = (
        operation: string,
      ): Effect.Effect<void, WorktreeEnvironmentRuntimeError> =>
        Effect.suspend(() =>
          accepting
            ? Effect.void
            : Effect.fail(error(operation, new Error("Worktree environment runtime is closed"))),
        );
      const readProject = Effect.fn("WorktreeEnvironmentRuntime.readProject")((
        projectId: string,
      ): Effect.Effect<ProjectEnvironmentLocation | null, WorktreeEnvironmentRuntimeError> => {
        const normalizedProjectId = projectId.trim();
        if (!normalizedProjectId) {
          return Effect.fail(error("read-project", new Error("Project id is required")));
        }
        return core.workspace
          .read(
            { kind: "project", project_id: normalizedProjectId },
            undefined,
            normalizedProjectId,
          )
          .pipe(
            Effect.catch((cause) =>
              isNotFound(cause) ? Effect.succeed(null) : Effect.fail(error("read-project", cause)),
            ),
            Effect.flatMap((snapshot) => {
              if (snapshot === null) return Effect.succeed(null);
              if (snapshot.value.kind !== "project") {
                return Effect.fail(
                  error(
                    "read-project",
                    new Error("Core returned a non-project Workspace read variant"),
                  ),
                );
              }
              const workspacePath = snapshot.value.project.primary_workspace_root?.trim();
              return Effect.succeed(
                workspacePath ? { name: snapshot.value.project.name, workspacePath } : null,
              );
            }),
          );
      });
      const readFile = <A>(operation: string, task: () => Promise<A>) =>
        Effect.tryPromise({ try: task, catch: (cause) => error(operation, cause) });
      const saveFile = (
        input: UpdateWorktreeEnvironmentConfigInput & { readonly workspacePath: string },
      ): Effect.Effect<WorktreeEnvironmentSaveResult, WorktreeEnvironmentRuntimeError> =>
        Effect.gen(function* () {
          if (!accepting) {
            return yield* Effect.fail(
              error("save-project-config", new Error("Worktree environment runtime is closed")),
            );
          }
          const physical = writes.withPermits(1)(
            Effect.tryPromise({
              try: () => (options.saveFile ?? saveWorktreeEnvironmentConfigFile)(input),
              catch: (cause) => error("save-project-config", cause),
            }).pipe(Effect.uninterruptible),
          );
          // Register the Scope lease before filesystem mutation can become externally visible.
          const fiber = yield* FiberSet.run(
            saveFibers,
            Effect.yieldNow.pipe(Effect.andThen(physical)),
            { startImmediately: true },
          );
          return yield* Fiber.join(fiber);
        });

      return WorktreeEnvironmentRuntime.of({
        listProjectOptions: (projectId) =>
          ensureOpen("list-project-options").pipe(
            Effect.andThen(readProject(projectId)),
            Effect.flatMap((project) =>
              project
                ? readFile("list-project-options", () =>
                    listWorktreeEnvironmentOptions(project.workspacePath),
                  ).pipe(Effect.catch(() => Effect.succeed([])))
                : Effect.succeed([]),
            ),
          ),
        listProjectConfigs: (projectId) =>
          ensureOpen("list-project-configs").pipe(
            Effect.andThen(readProject(projectId)),
            Effect.flatMap((project) =>
              project
                ? readFile("list-project-configs", () =>
                    listWorktreeEnvironmentConfigs(project.workspacePath),
                  ).pipe(Effect.catch(() => Effect.succeed([])))
                : Effect.succeed([]),
            ),
          ),
        listWorkspaceConfigs: (hostId, workspaceRoot) =>
          ensureOpen("list-workspace-configs").pipe(
            Effect.andThen(
              Effect.suspend(() => {
                if (hostId.trim() !== CODEX_APP_LOCAL_HOST_ID) {
                  return Effect.fail(
                    error(
                      "list-workspace-configs",
                      new Error(`Local environment host is unavailable: ${hostId}`),
                    ),
                  );
                }
                const normalizedWorkspaceRoot = workspaceRoot.trim();
                if (!normalizedWorkspaceRoot) {
                  return Effect.fail(
                    error("list-workspace-configs", new Error("Workspace root is required")),
                  );
                }
                return readFile("list-workspace-configs", () =>
                  listWorktreeEnvironmentConfigs(normalizedWorkspaceRoot),
                );
              }),
            ),
          ),
        readProjectConfig: (projectId, configPath) =>
          ensureOpen("read-project-config").pipe(
            Effect.andThen(readProject(projectId)),
            Effect.flatMap((project) =>
              project
                ? readFile("read-project-config", () =>
                    readWorktreeEnvironmentSettingsSnapshot({
                      projectId: projectId.trim(),
                      projectName: project.name,
                      workspacePath: project.workspacePath,
                      configPath,
                    }),
                  )
                : Effect.fail(
                    error(
                      "read-project-config",
                      new Error("Project source folder is required for local environments"),
                    ),
                  ),
            ),
          ),
        saveProjectConfig: (input) =>
          ensureOpen("save-project-config").pipe(
            Effect.andThen(readProject(input.projectId)),
            Effect.flatMap((project) =>
              project
                ? saveFile({ ...input, workspacePath: project.workspacePath })
                : Effect.fail(
                    error(
                      "save-project-config",
                      new Error("Project source folder is required for local environments"),
                    ),
                  ),
            ),
          ),
      });
    }),
  );

export const live: Layer.Layer<WorktreeEnvironmentRuntime, never, CoreModules> = makeLive();
