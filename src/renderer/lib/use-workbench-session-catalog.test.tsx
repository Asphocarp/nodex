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

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("./api", () => ({
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
    databaseStarter: false,
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
    activeProjectId: "alpha",
    sessionId: "session:alpha",
  },
): WorkbenchSessionCatalogWindowPort {
  return {
    location,
    sessionViewsBySessionId: {},
    setSessionView: vi.fn(),
    selectSession: vi.fn(),
    selectProject: vi.fn(),
    reconcileSelection: vi.fn(),
  };
}

function createHarness(window: WorkbenchSessionCatalogWindowPort) {
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
      projects: [makeProject("alpha")],
      expandedProjectIds: new Set(["alpha"]),
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
      expect(channel).toBe("workspace:tasks:list");
      if (projectId === null) return Promise.resolve(makeWindow([]));
      return new Promise<ProjectSessionSummaryWindow>((resolve) => {
        resolveProject = resolve;
      });
    });
    const window = makeWindowPort();
    const { hook } = createHarness(window);

    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.ready).toBe(false);
    expect(window.reconcileSelection).not.toHaveBeenCalled();

    await act(async () => {
      resolveProject?.(makeWindow([
        makeSummary("session:alpha", "alpha"),
      ]));
    });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.active?.domain.id).toBe("session:alpha");
  });

  test("hydrates selected detail while preserving an explicit window view", async () => {
    const persistedView = materializeInitialWorkbenchSessionView({
      id: "session:alpha",
      projectId: "alpha",
      databaseViewId: null,
    });
    const window = {
      ...makeWindowPort(),
      sessionViewsBySessionId: {
        "session:alpha": persistedView,
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
    expect(hook.result.current.active?.view).toBe(persistedView);
    expect(window.setSessionView).not.toHaveBeenCalled();
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
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

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
      expect(hook.result.current.hasMoreByScope.alpha).toBe(true);
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
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

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
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    act(() => {
      hook.result.current.select(
        hook.result.current.projectless[0],
      );
    });

    expect(window.selectSession).toHaveBeenCalledWith({
      id: "session:projectless",
      projectId: null,
    });
  });
});
