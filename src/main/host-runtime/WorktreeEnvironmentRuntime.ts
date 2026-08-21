import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
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
  WorktreeEnvironmentFileStore,
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

export const live: Layer.Layer<WorktreeEnvironmentRuntime, never, CoreModules> = Layer.effect(
  WorktreeEnvironmentRuntime,
  Effect.gen(function* () {
    const core = yield* CoreModules;
    const files = yield* Effect.acquireRelease(
      Effect.sync(() => new WorktreeEnvironmentFileStore()),
      (store) => Effect.promise(() => store.close()),
    );
    const error = (operation: string, cause: unknown) =>
      new WorktreeEnvironmentRuntimeError({ operation, cause });
    const readProject = Effect.fn("WorktreeEnvironmentRuntime.readProject")((
      projectId: string,
    ): Effect.Effect<ProjectEnvironmentLocation | null, WorktreeEnvironmentRuntimeError> => {
      const normalizedProjectId = projectId.trim();
      if (!normalizedProjectId) {
        return Effect.fail(error("read-project", new Error("Project id is required")));
      }
      return core.workspace
        .read({ kind: "project", project_id: normalizedProjectId }, undefined, normalizedProjectId)
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

    return WorktreeEnvironmentRuntime.of({
      listProjectOptions: (projectId) =>
        readProject(projectId).pipe(
          Effect.flatMap((project) =>
            project
              ? readFile("list-project-options", () =>
                  listWorktreeEnvironmentOptions(project.workspacePath),
                ).pipe(Effect.catch(() => Effect.succeed([])))
              : Effect.succeed([]),
          ),
        ),
      listProjectConfigs: (projectId) =>
        readProject(projectId).pipe(
          Effect.flatMap((project) =>
            project
              ? readFile("list-project-configs", () =>
                  listWorktreeEnvironmentConfigs(project.workspacePath),
                ).pipe(Effect.catch(() => Effect.succeed([])))
              : Effect.succeed([]),
          ),
        ),
      listWorkspaceConfigs: (hostId, workspaceRoot) => {
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
      },
      readProjectConfig: (projectId, configPath) =>
        readProject(projectId).pipe(
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
        readProject(input.projectId).pipe(
          Effect.flatMap((project) =>
            project
              ? readFile("save-project-config", () =>
                  files.save({ ...input, workspacePath: project.workspacePath }),
                )
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
