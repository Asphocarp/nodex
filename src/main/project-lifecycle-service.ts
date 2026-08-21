import type {
  CodexBackgroundProcessRow,
  Project,
  ProjectArchiveBlocker,
  ProjectLifecycleInput,
  ProjectLifecycleMutationResult,
  ProjectSessionSummary,
  TerminalSessionSnapshot,
} from "../shared/types";
import type { DesktopProjectWorkspacePort } from "./core-client/project-workspace-adapter";
import { getLogger } from "./logging/logger";
import type { ProjectSessionBrowserRuntime } from "./project-session-browser-ownership";
import {
  projectRuntimeLifecycleCoordinator,
  type ProjectRuntimeLifecycleCoordinator,
} from "./project-runtime-lifecycle-coordinator";

export interface ProjectLifecycleServiceDependencies {
  readonly projectWorkspace: Pick<
    DesktopProjectWorkspacePort,
    "getProject" | "listProjectSessionSummaryWindow" | "setProjectLifecycle"
  >;
  readonly coordinator?: ProjectRuntimeLifecycleCoordinator;
  readonly browserRuntime: Pick<
    ProjectSessionBrowserRuntime,
    "closeBrowserConversation" | "closeBrowserProject"
  >;
  readonly listCodexBlockers: (threadIds: readonly string[]) => readonly ProjectArchiveBlocker[];
  readonly listBackgroundProcessRows: (
    threadId: string,
  ) => Promise<readonly CodexBackgroundProcessRow[]>;
  readonly listLiveTerminalSessions: (input: {
    conversationIds: ReadonlySet<string>;
    projectSessionIds: ReadonlySet<string>;
  }) => readonly TerminalSessionSnapshot[] | Promise<readonly TerminalSessionSnapshot[]>;
  readonly discardExitedTerminalSessions: (input: {
    conversationIds: ReadonlySet<string>;
    projectSessionIds: ReadonlySet<string>;
  }) => readonly string[] | Promise<readonly string[]>;
}

export interface ProjectLifecycleService {
  setLifecycle(
    projectId: string,
    lifecycle: ProjectLifecycleInput["lifecycle"],
  ): Promise<ProjectLifecycleMutationResult>;
}

export type TerminalProjectOwnershipInput = {
  readonly projectSessionId?: string | null;
  readonly conversationId?: string | null;
};

export async function assertTerminalProjectIsActive(
  projectWorkspace: Pick<
    DesktopProjectWorkspacePort,
    "getProject" | "getProjectSession" | "getThread"
  >,
  input: TerminalProjectOwnershipInput,
): Promise<string | null> {
  const [session, thread] = await Promise.all([
    input.projectSessionId ? projectWorkspace.getProjectSession(input.projectSessionId) : null,
    input.conversationId ? projectWorkspace.getThread(input.conversationId) : null,
  ]);
  if (input.projectSessionId && !session) {
    throw new Error(`Unknown Project Session: ${input.projectSessionId}`);
  }
  if (input.conversationId && !thread) {
    throw new Error(`Unknown Codex Thread: ${input.conversationId}`);
  }
  if (session && thread && session.projectId !== thread.projectId) {
    throw new Error("Terminal Session and Thread must have the same Project owner");
  }

  const projectId = session?.projectId ?? thread?.projectId ?? null;
  if (!projectId) return null;

  const project = await projectWorkspace.getProject(projectId);
  if (project?.lifecycle === "active") return projectId;
  throw new Error("Terminals cannot be started for an inactive or removed project");
}

export async function runWithTerminalProjectAdmission<Result>(
  projectWorkspace: Pick<
    DesktopProjectWorkspacePort,
    "getProject" | "getProjectSession" | "getThread"
  >,
  input: TerminalProjectOwnershipInput,
  operation: () => Promise<Result> | Result,
  coordinator: ProjectRuntimeLifecycleCoordinator = projectRuntimeLifecycleCoordinator,
): Promise<Result> {
  const projectId = await assertTerminalProjectIsActive(projectWorkspace, input);
  return await coordinator.runExclusive(projectId, async () => {
    await assertTerminalProjectIsActive(projectWorkspace, input);
    return await operation();
  });
}

interface ProjectOwnershipSnapshot {
  readonly project: Project;
  readonly sessions: readonly ProjectSessionSummary[];
  readonly sessionIds: ReadonlySet<string>;
  readonly threadIds: readonly string[];
  readonly threadIdSet: ReadonlySet<string>;
}

const logger = getLogger({ subsystem: "project-lifecycle" });

function deduplicateBlockers(blockers: readonly ProjectArchiveBlocker[]): ProjectArchiveBlocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key =
      blocker.kind === "terminal"
        ? `${blocker.kind}:${blocker.terminalSessionId}`
        : blocker.kind === "background-process"
          ? `${blocker.kind}:${blocker.threadId}:${blocker.processId ?? blocker.label ?? "unknown"}`
          : `${blocker.kind}:${blocker.threadId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readOwnershipSnapshot(
  dependencies: ProjectLifecycleServiceDependencies,
  project: Project,
): Promise<ProjectOwnershipSnapshot> {
  const sessions: ProjectSessionSummary[] = [];
  let after: string | null = null;
  do {
    const window = await dependencies.projectWorkspace.listProjectSessionSummaryWindow(project.id, {
      includeArchived: true,
      after,
      first: 200,
    });
    sessions.push(...window.items);
    after = window.nextCursor;
  } while (after !== null);
  const threadIds = [
    ...new Set(sessions.flatMap((session) => (session.thread ? [session.thread.threadId] : []))),
  ];
  return {
    project,
    sessions,
    sessionIds: new Set(sessions.map((session) => session.id)),
    threadIds,
    threadIdSet: new Set(threadIds),
  };
}

async function readArchiveBlockers(
  dependencies: ProjectLifecycleServiceDependencies,
  ownership: ProjectOwnershipSnapshot,
): Promise<ProjectArchiveBlocker[]> {
  const codexBlockers = dependencies.listCodexBlockers(ownership.threadIds);
  const terminalSessions = await dependencies.listLiveTerminalSessions({
    conversationIds: ownership.threadIdSet,
    projectSessionIds: ownership.sessionIds,
  });
  const terminalBlockers = terminalSessions.map<ProjectArchiveBlocker>((session) => ({
    kind: "terminal",
    terminalSessionId: session.sessionId,
    projectSessionId: session.projectSessionId,
  }));
  const backgroundProcessGroups = await Promise.all(
    ownership.threadIds.map(async (threadId) => {
      const rows = await dependencies.listBackgroundProcessRows(threadId);
      return rows.flatMap<ProjectArchiveBlocker>((row) =>
        row.status === "running"
          ? [
              {
                kind: "background-process",
                threadId,
                processId: row.processId,
                label: row.command.trim() || row.threadTitle?.trim() || null,
              },
            ]
          : [],
      );
    }),
  );
  return deduplicateBlockers([
    ...codexBlockers,
    ...terminalBlockers,
    ...backgroundProcessGroups.flat(),
  ]);
}

async function cleanupProjectRuntimeOwnership(
  dependencies: ProjectLifecycleServiceDependencies,
  ownership: ProjectOwnershipSnapshot,
): Promise<void> {
  const cleanupTasks = [
    ...ownership.sessions.map((session) => ({
      label: `browser-conversation:${session.id}`,
      run: async () => await dependencies.browserRuntime.closeBrowserConversation(session.id),
    })),
    {
      label: `browser-project:${ownership.project.id}`,
      run: async () =>
        await dependencies.browserRuntime.closeBrowserProject?.(ownership.project.id),
    },
    {
      label: `exited-terminals:${ownership.project.id}`,
      run: async () =>
        dependencies.discardExitedTerminalSessions({
          conversationIds: ownership.threadIdSet,
          projectSessionIds: ownership.sessionIds,
        }),
    },
  ];
  const cleanupResults = await Promise.allSettled(
    cleanupTasks.map(async (task) => await task.run()),
  );
  const failures = cleanupResults.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            label: cleanupTasks[index]?.label ?? "unknown",
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
        ]
      : [],
  );
  if (failures.length === 0) return;

  logger.warn("Project runtime cleanup completed with failures", {
    projectId: ownership.project.id,
    failures,
  });
}

export function createProjectLifecycleService(
  dependencies: ProjectLifecycleServiceDependencies,
): ProjectLifecycleService {
  const coordinator = dependencies.coordinator ?? projectRuntimeLifecycleCoordinator;
  const archiveProject = async (project: Project): Promise<ProjectLifecycleMutationResult> => {
    const ownership = await readOwnershipSnapshot(dependencies, project);
    if (project.lifecycle === "archived") {
      await cleanupProjectRuntimeOwnership(dependencies, ownership);
      return { kind: "updated", project, changed: false };
    }

    const preflightBlockers = await readArchiveBlockers(dependencies, ownership);
    if (preflightBlockers.length > 0) {
      return { kind: "blocked", project, blockers: preflightBlockers };
    }

    const commitOwnership = await readOwnershipSnapshot(dependencies, project);
    const commitBlockers = await readArchiveBlockers(dependencies, commitOwnership);
    if (commitBlockers.length > 0) {
      return { kind: "blocked", project, blockers: commitBlockers };
    }

    const updated = await dependencies.projectWorkspace.setProjectLifecycle(project.id, "archived");
    if (!updated) return { kind: "not-found" };

    await cleanupProjectRuntimeOwnership(dependencies, commitOwnership);
    return { kind: "updated", project: updated, changed: true };
  };

  return {
    setLifecycle: async (projectId, lifecycle) =>
      await coordinator.runExclusive(projectId, async () => {
        const project = await dependencies.projectWorkspace.getProject(projectId);
        if (!project) return { kind: "not-found" };
        if (lifecycle === "archived") return await archiveProject(project);
        if (project.lifecycle === "active") {
          return { kind: "updated", project, changed: false };
        }

        const updated = await dependencies.projectWorkspace.setProjectLifecycle(
          project.id,
          "active",
        );
        return updated
          ? { kind: "updated", project: updated, changed: true }
          : { kind: "not-found" };
      }),
  };
}
