import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type {
  Project,
  ProjectLifecycleInput,
  ProjectLifecycleMutationResult,
  ProjectSessionSummary,
  ProjectSessionSummaryWindow,
} from "../../shared/types";
import { BrowserSidebarRuntime } from "../host-runtime/BrowserSidebarRuntime";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";
import { ProjectArchiveBlockers } from "./ProjectArchiveBlockers";
import { ProjectWorkspace, type ProjectWorkspaceError } from "./ProjectWorkspace";

export class ProjectLifecycleCommandsError extends Schema.TaggedError<ProjectLifecycleCommandsError>()(
  "ProjectLifecycleCommandsError",
  {
    operation: Schema.Literals(["read-project", "read-ownership", "read-blockers", "commit"]),
    cause: Schema.Defect(),
  },
) {}

export class ProjectLifecycleCommands extends Context.Service<
  ProjectLifecycleCommands,
  {
    readonly setLifecycle: (
      projectId: string,
      lifecycle: ProjectLifecycleInput["lifecycle"],
    ) => Effect.Effect<ProjectLifecycleMutationResult, ProjectLifecycleCommandsError>;
  }
>()("nodex/main/project-application/ProjectLifecycleCommands") {}

interface ProjectOwnershipSnapshot {
  readonly project: Project;
  readonly sessions: readonly ProjectSessionSummary[];
}

export const live: Layer.Layer<
  ProjectLifecycleCommands,
  never,
  | BrowserSidebarRuntime
  | ProjectArchiveBlockers
  | ProjectRuntimeLifecycleRuntime
  | ProjectWorkspace
  | TerminalSessions
> = Layer.effect(
  ProjectLifecycleCommands,
  Effect.gen(function* () {
    const blockers = yield* ProjectArchiveBlockers;
    const browser = yield* BrowserSidebarRuntime;
    const lifecycleRuntime = yield* ProjectRuntimeLifecycleRuntime;
    const workspace = yield* ProjectWorkspace;
    const terminals = yield* TerminalSessions;

    const project = <A>(
      operation: ProjectLifecycleCommandsError["operation"],
      effect: Effect.Effect<A, ProjectWorkspaceError>,
    ): Effect.Effect<A, ProjectLifecycleCommandsError> =>
      effect.pipe(
        Effect.mapError((cause) => new ProjectLifecycleCommandsError({ operation, cause })),
      );

    const readOwnership = Effect.fn("ProjectLifecycleCommands.readOwnership")(function* (
      ownedProject: Project,
    ) {
      const sessions: ProjectSessionSummary[] = [];
      let after: string | null = null;
      do {
        const window: ProjectSessionSummaryWindow = yield* project(
          "read-ownership",
          workspace.listProjectSessionSummaryWindow(ownedProject.id, {
            includeArchived: true,
            after,
            first: 200,
          }),
        );
        sessions.push(...window.items);
        after = window.nextCursor;
      } while (after !== null);
      return { project: ownedProject, sessions } satisfies ProjectOwnershipSnapshot;
    });

    const readBlockers = Effect.fn("ProjectLifecycleCommands.readBlockers")(function* (
      ownership: ProjectOwnershipSnapshot,
    ) {
      return yield* blockers
        .list(ownership)
        .pipe(
          Effect.mapError(
            (cause) => new ProjectLifecycleCommandsError({ operation: "read-blockers", cause }),
          ),
        );
    });

    const cleanupOwnership = Effect.fn("ProjectLifecycleCommands.cleanupOwnership")(function* (
      ownership: ProjectOwnershipSnapshot,
    ) {
      const conversationIds = new Set(
        ownership.sessions.flatMap((session) => (session.thread ? [session.thread.threadId] : [])),
      );
      const projectSessionIds = new Set(ownership.sessions.map((session) => session.id));
      const tasks = [
        ...ownership.sessions.map((session) => ({
          label: `browser-conversation:${session.id}`,
          effect: Effect.try({
            try: () => browser.browser.closeBrowserConversation(session.id),
            catch: (cause) =>
              new ProjectLifecycleCommandsError({
                operation: "commit",
                cause,
              }),
          }),
        })),
        {
          label: `browser-project:${ownership.project.id}`,
          effect: browser.localServers.closeProject(ownership.project.id),
        },
        {
          label: `exited-terminals:${ownership.project.id}`,
          effect: terminals.discardExitedSessionsForOwners({
            conversationIds,
            projectSessionIds,
          }),
        },
      ];
      const results = yield* Effect.all(
        tasks.map(({ effect, label }) =>
          effect.pipe(
            Effect.as<null>(null),
            Effect.exit,
            Effect.map((exit) => ({ exit, label })),
          ),
        ),
        { concurrency: "unbounded" },
      );
      const failures = results.flatMap(({ exit, label }) =>
        Exit.isFailure(exit) ? [{ label, error: Cause.pretty(exit.cause) }] : [],
      );
      if (failures.length === 0) return;
      yield* Effect.logWarning("Project runtime cleanup completed with failures").pipe(
        Effect.annotateLogs({ projectId: ownership.project.id, failures }),
      );
    });

    const archive = Effect.fn("ProjectLifecycleCommands.archive")(function* (
      ownedProject: Project,
    ) {
      const preflightOwnership = yield* readOwnership(ownedProject);
      if (ownedProject.lifecycle === "archived") {
        yield* cleanupOwnership(preflightOwnership);
        return {
          kind: "updated",
          project: ownedProject,
          changed: false,
        } satisfies ProjectLifecycleMutationResult;
      }
      const preflightBlockers = yield* readBlockers(preflightOwnership);
      if (preflightBlockers.length > 0) {
        return {
          kind: "blocked",
          project: ownedProject,
          blockers: [...preflightBlockers],
        } satisfies ProjectLifecycleMutationResult;
      }

      const commitOwnership = yield* readOwnership(ownedProject);
      const commitBlockers = yield* readBlockers(commitOwnership);
      if (commitBlockers.length > 0) {
        return {
          kind: "blocked",
          project: ownedProject,
          blockers: [...commitBlockers],
        } satisfies ProjectLifecycleMutationResult;
      }
      const updated = yield* project(
        "commit",
        workspace.setProjectLifecycle(ownedProject.id, "archived"),
      );
      if (!updated) return { kind: "not-found" } satisfies ProjectLifecycleMutationResult;
      yield* cleanupOwnership(commitOwnership);
      return {
        kind: "updated",
        project: updated,
        changed: true,
      } satisfies ProjectLifecycleMutationResult;
    });

    const setLifecycle = Effect.fn("ProjectLifecycleCommands.setLifecycle")(function* (
      projectId: string,
      lifecycle: ProjectLifecycleInput["lifecycle"],
    ) {
      return yield* lifecycleRuntime.runExclusive(
        projectId,
        Effect.gen(function* () {
          const ownedProject = yield* project("read-project", workspace.getProject(projectId));
          if (!ownedProject) {
            return { kind: "not-found" } satisfies ProjectLifecycleMutationResult;
          }
          if (lifecycle === "archived") return yield* archive(ownedProject);
          if (ownedProject.lifecycle === "active") {
            return {
              kind: "updated",
              project: ownedProject,
              changed: false,
            } satisfies ProjectLifecycleMutationResult;
          }
          const updated = yield* project(
            "commit",
            workspace.setProjectLifecycle(ownedProject.id, "active"),
          );
          return updated
            ? ({
                kind: "updated",
                project: updated,
                changed: true,
              } satisfies ProjectLifecycleMutationResult)
            : ({ kind: "not-found" } satisfies ProjectLifecycleMutationResult);
        }),
      );
    });

    return ProjectLifecycleCommands.of({ setLifecycle });
  }),
);
