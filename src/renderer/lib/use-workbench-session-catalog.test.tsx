import type { PropsWithChildren } from "react";
import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type {
  Project,
  ProjectSession,
  ProjectSessionSummary,
  ProjectSessionSummaryWindow,
} from "../../shared/types";
import type { WorkbenchLocation } from "../../shared/workbench-layout";
import {
  materializeInitialWorkbenchSessionView,
} from "../../shared/workbench-session-view";
import {
  applyLegacySessionViewToWorkbenchScene,
  makeWorkbenchSceneKey,
  materializeInitialWorkbenchScene,
} from "../../shared/workbench-scene";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("./api", () => ({
  readDatabaseViewWindow: async () => null,
  readDatabaseViewGroups: async () => null,
  subscribeBoardChanges: () => () => undefined,
  invoke: invokeMock,
}));

import {
  useWorkbenchSessionCatalog,
  type WorkbenchSessionCatalogWindowPort,
} from "./use-workbench-session-catalog";
import { queryKeys } from "./query-keys";

function makeProject(id: string): Project {
  return {
    id,
    libraryId: "library",
    databaseId: `database:${id}`,
    defaultDatabaseViewId: `view:${id}`,
    lifecycle: "active",
    bindingRevision: 0,
    name: id,
    description: "",
    appearance: {},
    sources: [{ root: `/work/${id}`, order: 0 }],
    primaryWorkspaceRoot: `/work/${id}`,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-01-01T00:00:00.000Z"),
    updated: new Date("2026-01-01T00:00:00.000Z"),
  } as Project;
}

function makeSummary(
  id: string,
  projectId: string | null,
  overrides: Partial<ProjectSessionSummary> = {},
): ProjectSessionSummary {
  return {
    id,
    projectId,
    noThreadFallbackTitle: id,
    displayTitle: id,
    order: 0,
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    unread: false,
    thread: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeWindow(
  items: ProjectSessionSummary[],
  overrides: Partial<ProjectSessionSummaryWindow> = {},
): ProjectSessionSummaryWindow {
  return {
    items,
    nextCursor: null,
    hasMore: false,
    projectionRevision: 1,
    ...overrides,
  };
}

function makeWindowPort(
  location: WorkbenchLocation = {
    kind: "session",
    sessionId: "session:alpha",
    projectContextId: "alpha",
  },
): WorkbenchSessionCatalogWindowPort {
  return {
    location,
    scenesByOwnerKey: {},
    setScene: vi.fn(),
    selectSession: vi.fn(),
    selectProject: vi.fn(),
    reconcileMissingSession: vi.fn(),
  };
}

function createHarness(
  window: WorkbenchSessionCatalogWindowPort,
  options: {
    projects?: Project[];
    expandedProjectIds?: Set<string>;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => useWorkbenchSessionCatalog({
      projects: options.projects ?? [makeProject("alpha")],
      expandedProjectIds:
        options.expandedProjectIds ?? new Set(["alpha"]),
      window,
    }),
    { wrapper },
  );
  return { client, hook };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("useWorkbenchSessionCatalog", () => {
  test("keeps loading distinct from an empty catalog", async () => {
    let resolveProject:
      | ((value: ProjectSessionSummaryWindow) => void)
      | null = null;
    invokeMock.mockImplementation((
      channel: string,
      projectId: string | null,
    ) => {
      if (channel === "project-sessions:get") {
        return Promise.resolve(
          makeSummary("session:alpha", "alpha") as ProjectSession,
        );
      }
      expect(channel).toBe("workspace:tasks:list");
      if (projectId === null) return Promise.resolve(makeWindow([]));
      return new Promise<ProjectSessionSummaryWindow>((resolve) => {
        resolveProject = resolve;
      });
    });
    const window = makeWindowPort();
    const { hook } = createHarness(window);

    expect(hook.result.current.collectionsByProject.alpha.state)
      .toEqual({ kind: "loading" });
    expect(hook.result.current.selectedDetailReady).toBe(false);
    expect(window.reconcileMissingSession).not.toHaveBeenCalled();

    await act(async () => {
      resolveProject?.(makeWindow([
        makeSummary("session:alpha", "alpha"),
      ]));
    });
    await waitFor(() => {
      expect(hook.result.current.selectedDetailReady).toBe(true);
    });
    expect(hook.result.current.active?.domain.id).toBe("session:alpha");
  });

  test("treats a Project with no Sessions as a ready empty collection", async () => {
    invokeMock.mockImplementation((channel: string) => {
      expect(channel).toBe("workspace:tasks:list");
      return Promise.resolve(makeWindow([]));
    });
    const window = makeWindowPort({
      kind: "project",
      projectId: "alpha",
    });
    const { hook } = createHarness(window);

    expect(hook.result.current.selectedDetailReady).toBe(true);
    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.state)
        .toEqual({
          kind: "ready",
          refreshing: false,
          refreshError: null,
        });
    });
    expect(hook.result.current.collectionsByProject.alpha.projections)
      .toEqual([]);
    expect(invokeMock.mock.calls.some(([channel]) => (
      channel === "project-sessions:get"
    ))).toBe(false);
  });

  test("isolates loading state between Session scopes", async () => {
    let resolveProjectless:
      | ((value: ProjectSessionSummaryWindow) => void)
      | null = null;
    invokeMock.mockImplementation((
      channel: string,
      projectId: string | null,
    ) => {
      expect(channel).toBe("workspace:tasks:list");
      if (projectId === "alpha") return Promise.resolve(makeWindow([]));
      return new Promise<ProjectSessionSummaryWindow>((resolve) => {
        resolveProjectless = resolve;
      });
    });
    const { hook } = createHarness(makeWindowPort({
      kind: "project",
      projectId: "alpha",
    }));

    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.state.kind)
        .toBe("ready");
    });
    expect(hook.result.current.projectlessCollection.state.kind)
      .toBe("loading");

    await act(async () => {
      resolveProjectless?.(makeWindow([]));
    });
  });

  test("keeps an unrequested inactive Project scope idle", async () => {
    invokeMock.mockImplementation((channel: string) => {
      expect(channel).toBe("workspace:tasks:list");
      return Promise.resolve(makeWindow([]));
    });
    const { hook } = createHarness(
      makeWindowPort({ kind: "project", projectId: "alpha" }),
      {
        projects: [makeProject("alpha"), makeProject("beta")],
        expandedProjectIds: new Set(),
      },
    );

    expect(hook.result.current.collectionsByProject.beta.state)
      .toEqual({ kind: "idle" });
    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.state.kind)
        .toBe("ready");
    });
    expect(invokeMock.mock.calls.some(([, projectId]) => (
      projectId === "beta"
    ))).toBe(false);
  });

  test("exposes a scope-local error that can be retried", async () => {
    let alphaAttempt = 0;
    invokeMock.mockImplementation((
      channel: string,
      projectId: string | null,
    ) => {
      expect(channel).toBe("workspace:tasks:list");
      if (projectId === null) return Promise.resolve(makeWindow([]));
      alphaAttempt += 1;
      if (alphaAttempt === 1) {
        return Promise.reject(new Error("Alpha is temporarily unavailable"));
      }
      return Promise.resolve(makeWindow([]));
    });
    const { hook } = createHarness(makeWindowPort({
      kind: "project",
      projectId: "alpha",
    }));

    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.state)
        .toEqual({
          kind: "error",
          message: "Alpha is temporarily unavailable",
        });
    });

    await act(async () => {
      await hook.result.current.retryCollection("alpha");
    });
    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.state.kind)
        .toBe("ready");
    });
  });

  test("keeps cached rows ready through a failing background refresh", async () => {
    let refreshAlpha = false;
    let rejectRefresh: ((reason: Error) => void) | null = null;
    invokeMock.mockImplementation((
      channel: string,
      projectId: string | null,
    ) => {
      expect(channel).toBe("workspace:tasks:list");
      if (projectId === null) return Promise.resolve(makeWindow([]));
      if (!refreshAlpha) {
        return Promise.resolve(makeWindow([
          makeSummary("session:alpha", "alpha"),
        ]));
      }
      return new Promise<ProjectSessionSummaryWindow>((_resolve, reject) => {
        rejectRefresh = reject;
      });
    });
    const { client, hook } = createHarness(makeWindowPort({
      kind: "project",
      projectId: "alpha",
    }));

    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.state.kind)
        .toBe("ready");
    });
    refreshAlpha = true;
    act(() => {
      void client.invalidateQueries({
        queryKey: queryKeys.projectSessions.summaries("alpha"),
        exact: true,
      });
    });
    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.state)
        .toEqual({
          kind: "ready",
          refreshing: true,
          refreshError: null,
        });
    });
    expect(hook.result.current.collectionsByProject.alpha.projections)
      .toHaveLength(1);

    await act(async () => {
      rejectRefresh?.(new Error("Refresh failed"));
    });
    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.state)
        .toEqual({
          kind: "ready",
          refreshing: false,
          refreshError: "Refresh failed",
        });
    });
    expect(hook.result.current.collectionsByProject.alpha.projections[0]?.id)
      .toBe("session:alpha");
  });

  test("hydrates selected detail while preserving an explicit window view", async () => {
    const persistedView = materializeInitialWorkbenchSessionView({
      id: "session:alpha",
      projectId: "alpha",
      databaseViewId: null,
    });
    const persistedScene = applyLegacySessionViewToWorkbenchScene(
      materializeInitialWorkbenchScene({
        kind: "session",
        sessionId: "session:alpha",
      }),
      persistedView,
    );
    const window = {
      ...makeWindowPort(),
      scenesByOwnerKey: {
        [makeWorkbenchSceneKey({
          kind: "session",
          sessionId: "session:alpha",
        })]: persistedScene,
      },
    };
    const thread = {
      threadId: "thread:alpha",
      cwd: "/work/alpha",
      modelProvider: "openai",
      executionProfile: null,
      managedWorktreePath: null,
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
    } as ProjectSession["thread"];
    const summary = makeSummary("session:alpha", "alpha", {
      thread: {
        threadId: "thread:alpha",
        cwd: "/work/alpha",
      } as ProjectSessionSummary["thread"],
    });
    const detail: ProjectSession = {
      ...summary,
      thread: {
        ...thread,
      } as NonNullable<ProjectSession["thread"]>,
    };
    invokeMock.mockImplementation((
      channel: string,
      value: string | null,
    ) => {
      if (channel === "workspace:tasks:list") {
        return Promise.resolve(makeWindow(
          value === "alpha"
            ? [summary]
            : [],
        ));
      }
      if (channel === "project-sessions:get") {
        return Promise.resolve(detail);
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const { hook } = createHarness(window);

    await waitFor(() => {
      expect(hook.result.current.active?.domain.thread?.threadId)
        .toBe("thread:alpha");
    });
    expect(hook.result.current.active?.scene).toStrictEqual(persistedScene);
    expect(window.setScene).not.toHaveBeenCalled();
  });

  test("hydrates the exact selected Session outside the bounded summary window", async () => {
    const selected = makeSummary(
      "session:beyond-first-window",
      "alpha",
    ) as ProjectSession;
    const firstSummary = makeSummary("session:first", "alpha");
    invokeMock.mockImplementation((
      channel: string,
      value: string | null,
    ) => {
      if (channel === "workspace:tasks:list") {
        return Promise.resolve(makeWindow(
          value === "alpha" ? [firstSummary] : [],
        ));
      }
      if (channel === "project-sessions:get") {
        expect(value).toBe("session:beyond-first-window");
        return Promise.resolve(selected);
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const window = makeWindowPort({
      kind: "session",
      sessionId: "session:beyond-first-window",
      projectContextId: "alpha",
    });
    const { hook } = createHarness(window);

    await waitFor(() => {
      expect(hook.result.current.active?.domain.id)
        .toBe("session:beyond-first-window");
    });
    expect(hook.result.current.active?.domain.id).not.toBe("session:first");
    expect(window.reconcileMissingSession).not.toHaveBeenCalled();
  });

  test("reconciles only an authoritative missing exact Session", async () => {
    invokeMock.mockImplementation((
      channel: string,
      value: string | null,
    ) => {
      if (channel === "workspace:tasks:list") {
        return Promise.resolve(makeWindow(
          value === "alpha"
            ? [makeSummary("session:first", "alpha")]
            : [],
        ));
      }
      if (channel === "project-sessions:get") return Promise.resolve(null);
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const window = makeWindowPort({
      kind: "session",
      sessionId: "session:missing",
      projectContextId: "alpha",
    });
    const { hook } = createHarness(window);

    await waitFor(() => {
      expect(window.reconcileMissingSession)
        .toHaveBeenCalledWith("session:missing");
    });
    expect(hook.result.current.active).toBeNull();
  });

  test("keeps exact location on a transient detail error", async () => {
    invokeMock.mockImplementation((
      channel: string,
    ) => {
      if (channel === "workspace:tasks:list") {
        return Promise.resolve(makeWindow([]));
      }
      if (channel === "project-sessions:get") {
        return Promise.reject(new Error("temporary outage"));
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const window = makeWindowPort({
      kind: "session",
      sessionId: "session:restore",
      projectContextId: "alpha",
    });
    const { hook } = createHarness(window);

    await waitFor(() => {
      expect(hook.result.current.selectedDetailError)
        .toBe("temporary outage");
    });
    expect(window.reconcileMissingSession).not.toHaveBeenCalled();
    expect(window.location).toEqual({
      kind: "session",
      sessionId: "session:restore",
      projectContextId: "alpha",
    });
  });

  test("prefetches detail without fetching a full session list or board", async () => {
    const detail = makeSummary(
      "session:alpha",
      "alpha",
    ) as ProjectSession;
    invokeMock.mockImplementation((
      channel: string,
      value: string | null,
    ) => {
      if (channel === "workspace:tasks:list") {
        return Promise.resolve(makeWindow(
          value === "alpha"
            ? [makeSummary("session:alpha", "alpha")]
            : [],
        ));
      }
      if (channel === "project-sessions:get") return Promise.resolve(detail);
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const { hook } = createHarness(makeWindowPort());
    await waitFor(() => {
      expect(hook.result.current.selectedDetailReady).toBe(true);
    });

    await act(async () => {
      await hook.result.current.prefetch("session:alpha");
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "project-sessions:get",
      "session:alpha",
    );
    expect(invokeMock.mock.calls.some(([channel]) =>
      channel === "project-sessions:list"
      || channel === "boards:by-project"
    )).toBe(false);
  });

  test("appends a bounded continuation without duplicating summaries", async () => {
    invokeMock.mockImplementation((
      channel: string,
      projectId: string | null,
      input?: { after?: string },
    ) => {
      if (channel !== "workspace:tasks:list") {
        throw new Error(`Unexpected channel: ${channel}`);
      }
      if (projectId === null) return Promise.resolve(makeWindow([]));
      if (input?.after === "cursor:one") {
        return Promise.resolve(makeWindow([
          makeSummary("session:alpha", "alpha"),
          makeSummary("session:beta", "alpha"),
        ]));
      }
      return Promise.resolve(makeWindow(
        [makeSummary("session:alpha", "alpha")],
        { hasMore: true, nextCursor: "cursor:one" },
      ));
    });
    const { client, hook } = createHarness(makeWindowPort());
    await waitFor(() => {
      expect(hook.result.current.collectionsByProject.alpha.hasMore)
        .toBe(true);
    });

    await act(async () => {
      await hook.result.current.loadMore("alpha");
    });

    expect(
      client.getQueryData<ProjectSessionSummaryWindow>(
        queryKeys.projectSessions.summaries("alpha"),
      )?.items.map((item) => item.id),
    ).toEqual(["session:alpha", "session:beta"]);
  });

  test("seeds mutation responses in the Query detail cache", async () => {
    const current = makeSummary(
      "session:alpha",
      "alpha",
    ) as ProjectSession;
    const updated = { ...current, unread: true };
    invokeMock.mockImplementation((
      channel: string,
      value: string | null,
    ) => {
      if (channel === "workspace:tasks:list") {
        return Promise.resolve(makeWindow(
          value === "alpha" ? [current] : [],
        ));
      }
      if (channel === "project-sessions:get") {
        return Promise.resolve(current);
      }
      if (channel === "project-sessions:mark-unread") {
        return Promise.resolve(updated);
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const { client, hook } = createHarness(makeWindowPort());
    await waitFor(() => {
      expect(hook.result.current.selectedDetailReady).toBe(true);
    });

    await act(async () => {
      await hook.result.current.markUnread(current, true);
    });

    expect(
      client.getQueryData<ProjectSession>(
        queryKeys.projectSessions.detail(current.id),
      )?.unread,
    ).toBe(true);
  });

  test("selects projectless sessions through the WindowState command port", async () => {
    invokeMock.mockImplementation((
      channel: string,
      projectId: string | null,
    ) => {
      if (channel !== "workspace:tasks:list") {
        throw new Error(`Unexpected channel: ${channel}`);
      }
      return Promise.resolve(makeWindow(
        projectId === null
          ? [makeSummary("session:projectless", null)]
          : [makeSummary("session:alpha", "alpha")],
      ));
    });
    const window = makeWindowPort();
    const { hook } = createHarness(window);
    await waitFor(() => {
      expect(hook.result.current.selectedDetailReady).toBe(true);
    });

    act(() => {
      hook.result.current.select(
        hook.result.current.projectlessCollection.presentations[0],
      );
    });

    expect(window.selectSession).toHaveBeenCalledWith({
      id: "session:projectless",
      projectId: null,
    });
  });
});
