import { describe, expect, test, vi } from "vitest";
import type {
  CodexBackgroundProcessRow,
  Project,
  ProjectArchiveBlocker,
  ProjectSession,
  TerminalSessionSnapshot,
} from "../shared/types";
import {
  assertTerminalProjectIsActive,
  createProjectLifecycleService,
  runWithTerminalProjectAdmission,
  type ProjectLifecycleServiceDependencies,
} from "./project-lifecycle-service";
import { ProjectRuntimeLifecycleCoordinator } from "./project-runtime-lifecycle-coordinator";
import type { DesktopProjectWorkspaceThread } from "./core-client/project-workspace-adapter";
import { DEFAULT_PROJECT_APPEARANCE } from "../shared/project-appearance";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    libraryId: "library-1",
    databaseId: "database-1",
    defaultDatabaseViewId: "view-1",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Alpha",
    description: "",
    appearance: DEFAULT_PROJECT_APPEARANCE,
    sources: [{ root: "/workspace/alpha", order: 0 }],
    primaryWorkspaceRoot: "/workspace/alpha",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-01-01T00:00:00.000Z"),
    updated: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeSession(): ProjectSession {
  return {
    id: "session-1",
    projectId: "project-1",
    noThreadFallbackTitle: "Alpha chat",
    displayTitle: "Alpha chat",
    order: 0,
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    unread: false,
    thread: {
      sessionId: "session-1",
      projectId: "project-1",
      threadId: "thread-1",
      threadPreview: "",
      modelProvider: "openai",
      executionHostId: "local",
      statusType: "idle",
      statusActiveFlags: [],
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      linkedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeThread(
  overrides: Partial<DesktopProjectWorkspaceThread> = {},
): DesktopProjectWorkspaceThread {
  return {
    threadId: "thread-1",
    projectId: "project-1",
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
    threadSource: null,
    serviceName: null,
    agentNickname: null,
    agentRole: null,
    agentPath: null,
    threadName: "Alpha chat",
    threadPreview: "",
    modelProvider: "openai",
    executionHostId: "local",
    cwd: "/workspace/alpha",
    managedWorktreePath: null,
    projectlessOutputDirectory: null,
    projectlessWorkspaceBrowserRoot: null,
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    pinnedOrder: null,
    hasUnreadTurn: false,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    linkedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTerminal(): TerminalSessionSnapshot {
  return {
    sessionId: "terminal-1",
    conversationId: "thread-1",
    projectSessionId: "session-1",
    osPid: 123,
    cpuPercent: null,
    rssKb: null,
    childProcessCount: null,
    processMetricsSampledAtMs: null,
    cwd: "/workspace/alpha",
    shell: "/bin/zsh",
    title: null,
    backendKind: "local",
    buffer: "",
    truncated: false,
    exited: false,
    exitCode: null,
    viewLease: null,
  };
}

function makeBackgroundProcess(): CodexBackgroundProcessRow {
  return {
    id: "process-row-1",
    threadId: "thread-1",
    threadTitle: "Alpha chat",
    itemId: "item-1",
    turnId: "turn-1",
    command: "pnpm dev",
    cwd: "/workspace/alpha",
    processId: "456",
    osPid: 456,
    terminalSessionId: null,
    source: "app-server",
    startedAtMs: 1,
    updatedAtMs: 1,
    status: "running",
    terminal: null,
    terminalSession: null,
  };
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

function makeDependencies(
  project = makeProject(),
): Mutable<ProjectLifecycleServiceDependencies> & {
  setProjectLifecycle: ReturnType<typeof vi.fn>;
  closeBrowserConversation: ReturnType<typeof vi.fn>;
  closeBrowserProject: ReturnType<typeof vi.fn>;
  discardExitedTerminalSessions: ReturnType<typeof vi.fn>;
} {
  const setProjectLifecycle = vi.fn(async (_projectId: string, lifecycle: Project["lifecycle"]) => ({
    ...project,
    lifecycle,
    bindingRevision: project.bindingRevision + 1,
  }));
  const closeBrowserConversation = vi.fn(async () => undefined);
  const closeBrowserProject = vi.fn(async () => undefined);
  const discardExitedTerminalSessions = vi.fn(() => []);
  return {
    projectWorkspace: {
      getProject: vi.fn(async () => project),
      listProjectSessionSummaryWindow: vi.fn(async () => ({
        items: [makeSession()],
        nextCursor: null,
        hasMore: false,
        projectionRevision: 1,
      })),
      setProjectLifecycle,
    },
    coordinator: new ProjectRuntimeLifecycleCoordinator(),
    browserRuntime: { closeBrowserConversation, closeBrowserProject },
    listCodexBlockers: () => [],
    listBackgroundProcessRows: async () => [],
    listLiveTerminalSessions: () => [],
    discardExitedTerminalSessions,
    setProjectLifecycle,
    closeBrowserConversation,
    closeBrowserProject,
  };
}

describe("project lifecycle service", () => {
  test("blocks archive without mutating or cleaning up active runtime ownership", async () => {
    const dependencies = makeDependencies();
    const activeTurn: ProjectArchiveBlocker = {
      kind: "active-turn",
      threadId: "thread-1",
      label: "Alpha chat",
    };
    dependencies.listCodexBlockers = () => [activeTurn];
    dependencies.listLiveTerminalSessions = () => [makeTerminal()];
    dependencies.listBackgroundProcessRows = async () => [makeBackgroundProcess()];

    const result = await createProjectLifecycleService(dependencies).setLifecycle(
      "project-1",
      "archived",
    );

    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("Expected blocked result");
    expect(result.blockers.map((blocker) => blocker.kind)).toEqual([
      "active-turn",
      "terminal",
      "background-process",
    ]);
    expect(dependencies.setProjectLifecycle).not.toHaveBeenCalled();
    expect(dependencies.closeBrowserConversation).not.toHaveBeenCalled();
  });

  test("rechecks blockers immediately before the lifecycle commit", async () => {
    const dependencies = makeDependencies();
    let check = 0;
    dependencies.listCodexBlockers = () => {
      check += 1;
      return check === 1
        ? []
        : [{ kind: "pending-request", threadId: "thread-1", label: null }];
    };

    const result = await createProjectLifecycleService(dependencies).setLifecycle(
      "project-1",
      "archived",
    );

    expect(result.kind).toBe("blocked");
    expect(check).toBe(2);
    expect(dependencies.setProjectLifecycle).not.toHaveBeenCalled();
  });

  test("archives once and cleans browser ownership after commit", async () => {
    const dependencies = makeDependencies();
    const result = await createProjectLifecycleService(dependencies).setLifecycle(
      "project-1",
      "archived",
    );

    expect(result).toMatchObject({
      kind: "updated",
      changed: true,
      project: { id: "project-1", lifecycle: "archived" },
    });
    expect(dependencies.setProjectLifecycle).toHaveBeenCalledWith(
      "project-1",
      "archived",
    );
    expect(dependencies.closeBrowserConversation).toHaveBeenCalledWith("session-1");
    expect(dependencies.closeBrowserProject).toHaveBeenCalledWith("project-1");
    expect(dependencies.discardExitedTerminalSessions).toHaveBeenCalledOnce();
  });

  test("retries idempotent cleanup for an already archived project", async () => {
    const project = makeProject({ lifecycle: "archived" });
    const dependencies = makeDependencies(project);
    const result = await createProjectLifecycleService(dependencies).setLifecycle(
      project.id,
      "archived",
    );

    expect(result).toMatchObject({ kind: "updated", changed: false });
    expect(dependencies.setProjectLifecycle).not.toHaveBeenCalled();
    expect(dependencies.closeBrowserConversation).toHaveBeenCalledWith("session-1");
  });

  test("keeps a committed archive when browser cleanup fails", async () => {
    const dependencies = makeDependencies();
    dependencies.closeBrowserConversation.mockRejectedValueOnce(new Error("cleanup failed"));

    const result = await createProjectLifecycleService(dependencies).setLifecycle(
      "project-1",
      "archived",
    );

    expect(result).toMatchObject({ kind: "updated", changed: true });
    expect(dependencies.setProjectLifecycle).toHaveBeenCalledOnce();
  });

  test("keeps a committed archive when Project browser cleanup throws synchronously", async () => {
    const dependencies = makeDependencies();
    dependencies.closeBrowserProject.mockImplementationOnce(() => {
      throw new Error("synchronous cleanup failure");
    });

    const result = await createProjectLifecycleService(dependencies).setLifecycle(
      "project-1",
      "archived",
    );

    expect(result).toMatchObject({ kind: "updated", changed: true });
    expect(dependencies.setProjectLifecycle).toHaveBeenCalledOnce();
  });

  test("continues Project task windows before deciding archive blockers", async () => {
    const dependencies = makeDependencies();
    dependencies.projectWorkspace.listProjectSessionSummaryWindow = vi.fn(
      async (_projectId, input) => {
        if (input?.after === null) {
          return {
            items: [makeSession()],
            nextCursor: "page-2",
            hasMore: true,
            projectionRevision: 1,
          };
        }
        const session = makeSession();
        if (!session.thread) throw new Error("fixture thread is required");
        return {
          items: [{
            ...session,
            id: "session-page-2",
            thread: { ...session.thread, threadId: "thread-page-2" },
          }],
          nextCursor: null,
          hasMore: false,
          projectionRevision: 1,
        };
      },
    );
    dependencies.listCodexBlockers = (threadIds) =>
      threadIds.includes("thread-page-2")
        ? [{ kind: "active-turn", threadId: "thread-page-2", label: "Subagent" }]
        : [];

    const result = await createProjectLifecycleService(dependencies).setLifecycle(
      "project-1",
      "archived",
    );

    expect(result).toMatchObject({
      kind: "blocked",
      blockers: [{ kind: "active-turn", threadId: "thread-page-2" }],
    });
    expect(dependencies.setProjectLifecycle).not.toHaveBeenCalled();
  });

  test("serializes concurrent archive requests so only one reports a change", async () => {
    let project = makeProject();
    const dependencies = makeDependencies(project);
    dependencies.projectWorkspace.getProject = vi.fn(async () => project);
    dependencies.projectWorkspace.setProjectLifecycle = vi.fn(async (_projectId, lifecycle) => {
      project = { ...project, lifecycle, bindingRevision: project.bindingRevision + 1 };
      return project;
    });
    const service = createProjectLifecycleService(dependencies);

    const [first, second] = await Promise.all([
      service.setLifecycle(project.id, "archived"),
      service.setLifecycle(project.id, "archived"),
    ]);

    expect([first, second].map((result) =>
      result.kind === "updated" ? result.changed : null
    )).toEqual([true, false]);
  });

  test("orders concurrent archive and restore requests deterministically", async () => {
    let project = makeProject();
    const dependencies = makeDependencies(project);
    dependencies.projectWorkspace.getProject = vi.fn(async () => project);
    dependencies.projectWorkspace.setProjectLifecycle = vi.fn(async (_projectId, lifecycle) => {
      project = { ...project, lifecycle, bindingRevision: project.bindingRevision + 1 };
      return project;
    });
    const service = createProjectLifecycleService(dependencies);

    const [archived, restored] = await Promise.all([
      service.setLifecycle(project.id, "archived"),
      service.setLifecycle(project.id, "active"),
    ]);

    expect(archived).toMatchObject({ kind: "updated", changed: true });
    expect(restored).toMatchObject({
      kind: "updated",
      changed: true,
      project: { lifecycle: "active" },
    });
    expect(project.lifecycle).toBe("active");
  });

  test("restores the retained project identity without runtime preflight", async () => {
    const project = makeProject({ lifecycle: "archived", bindingRevision: 4 });
    const dependencies = makeDependencies(project);
    dependencies.listCodexBlockers = vi.fn(() => {
      throw new Error("restore must not preflight active runtime");
    });

    const result = await createProjectLifecycleService(dependencies).setLifecycle(
      project.id,
      "active",
    );

    expect(result).toMatchObject({
      kind: "updated",
      changed: true,
      project: { id: project.id, lifecycle: "active", bindingRevision: 5 },
    });
  });
});

describe("terminal Project lifecycle guard", () => {
  function makeWorkspace(project: Project | null) {
    return {
      getProject: vi.fn(async () => project),
      getProjectSession: vi.fn(async (): Promise<ProjectSession | null> => makeSession()),
      getThread: vi.fn(async (): Promise<DesktopProjectWorkspaceThread | null> => null),
    };
  }

  test("allows terminals owned by an active Project", async () => {
    const workspace = makeWorkspace(makeProject());
    await expect(assertTerminalProjectIsActive(
      workspace,
      { projectSessionId: "session-1", conversationId: null },
    )).resolves.toBe("project-1");
    expect(workspace.getThread).not.toHaveBeenCalled();
  });

  test("rejects new terminal work owned by an archived Project", async () => {
    await expect(assertTerminalProjectIsActive(
      makeWorkspace(makeProject({ lifecycle: "archived" })),
      { projectSessionId: "session-1" },
    )).rejects.toThrow("inactive or removed project");
  });

  test("allows projectless terminal work without a Project lookup", async () => {
    const workspace = makeWorkspace(null);
    await expect(assertTerminalProjectIsActive(workspace, {})).resolves.toBeNull();
    expect(workspace.getProject).not.toHaveBeenCalled();
  });

  test("rejects mismatched Session and Thread owners", async () => {
    const workspace = makeWorkspace(makeProject());
    workspace.getThread.mockResolvedValueOnce(makeThread({ projectId: "project-other" }));

    await expect(assertTerminalProjectIsActive(workspace, {
      projectSessionId: "session-1",
      conversationId: "thread-other",
    })).rejects.toThrow("same Project owner");
  });

  test("rejects an unknown supplied ownership identity", async () => {
    const workspace = makeWorkspace(makeProject());
    workspace.getProjectSession.mockResolvedValueOnce(null);

    await expect(assertTerminalProjectIsActive(workspace, {
      projectSessionId: "session-missing",
    })).rejects.toThrow("Unknown Project Session");
  });

  test("revalidates terminal admission after a concurrent archive", async () => {
    let project = makeProject();
    let releaseFirstLookup: () => void = () => undefined;
    const firstLookup = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve;
    });
    const workspace = makeWorkspace(project);
    workspace.getProject.mockImplementation(async () => {
      await firstLookup;
      return project;
    });
    const coordinator = new ProjectRuntimeLifecycleCoordinator();
    const archive = coordinator.runExclusive(project.id, async () => {
      project = { ...project, lifecycle: "archived" };
      releaseFirstLookup();
    });
    const operation = vi.fn();

    await expect(runWithTerminalProjectAdmission(
      workspace,
      { projectSessionId: "session-1" },
      operation,
      coordinator,
    )).rejects.toThrow("inactive or removed project");
    await archive;
    expect(operation).not.toHaveBeenCalled();
  });
});
