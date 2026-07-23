import { describe, expect, test } from "vitest";
import { act } from "@testing-library/react";
import { createElement, useEffect, type ReactElement } from "react";
import {
  useWorkbenchState,
  workbenchStorageKeys,
  workbenchTestHelpers,
} from "./use-workbench-state";
import { createDefaultWorkbenchLayoutSnapshot } from "../../shared/workbench-layout";
import type { Project, WorkbenchLayoutSnapshot } from "./types";
import { render, settleAsyncRender } from "../test/dom";
import { createMaitaiStore, MaitaiProvider } from "./maitai";

const storageMap = new Map<string, string>();

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? storageMap.get(key) ?? null : null;
  },
  setItem(key: string, value: string): void {
    storageMap.set(key, value);
  },
  removeItem(key: string): void {
    storageMap.delete(key);
  },
  clear(): void {
    storageMap.clear();
  },
};

if (!(globalThis as { localStorage?: unknown }).localStorage) {
  (globalThis as { localStorage: typeof mockStorage }).localStorage = mockStorage;
}

if (!(globalThis as { sessionStorage?: unknown }).sessionStorage) {
  (globalThis as { sessionStorage: typeof mockStorage }).sessionStorage = mockStorage;
}

const localStorageRef =
  (globalThis as { localStorage?: typeof mockStorage }).localStorage ?? mockStorage;
const sessionStorageRef =
  (globalThis as { sessionStorage?: typeof mockStorage }).sessionStorage ?? mockStorage;

function makeProject(id: string, name: string): Project {
  const created = new Date();
  return {
    id,
    libraryId: "library:test",
    databaseId: "database:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name,
    description: "",
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created,
    updated: created,
  };
}

const PROJECTS = [
  makeProject("default", "Default"),
  makeProject("ops", "Ops"),
];

function resetStorage(): void {
  for (const storage of [localStorageRef, sessionStorageRef]) {
    storage.removeItem("nodex-tabs");
    storage.removeItem(workbenchStorageKeys.workbench);
    storage.removeItem(workbenchStorageKeys.sidebar);
    storage.removeItem(workbenchStorageKeys.dock);
    storage.removeItem(workbenchStorageKeys.recent);
    storage.removeItem(workbenchStorageKeys.dbViewPrefs);
  }
}

function renderWithRendererState(element: ReactElement) {
  return render(
    createElement(
      MaitaiProvider,
      { store: createMaitaiStore(), children: element },
    ),
  );
}

describe("use-workbench-state helpers", () => {
  test("preserves persisted Project state until the catalog succeeds", async () => {
    resetStorage();
    sessionStorageRef.setItem(workbenchStorageKeys.workbench, JSON.stringify({
      dbProjectId: "ops",
      threadsProjectId: "ops",
      viewsByProject: { ops: "calendar" },
      searchByProject: { ops: "release" },
      projectOrder: ["default", "ops"],
    }));
    const capturedRef: {
      current: { dbProjectId: string | null; activeView: string } | null;
    } = { current: null };
    function Harness({ ready, projects }: { ready: boolean; projects: Project[] }) {
      const state = useWorkbenchState(projects, { projectsReady: ready });
      capturedRef.current = {
        dbProjectId: state.dbProjectId,
        activeView: state.activeView,
      };
      return null;
    }

    const view = renderWithRendererState(createElement(Harness, {
      ready: false,
      projects: [],
    }));
    await settleAsyncRender();
    expect(capturedRef.current?.dbProjectId).toBe("ops");
    expect(capturedRef.current?.activeView).toBe("calendar");

    view.rerender(createElement(
      MaitaiProvider,
      {
        store: createMaitaiStore(),
        children: createElement(Harness, { ready: true, projects: PROJECTS }),
      },
    ));
    await settleAsyncRender();
    expect(capturedRef.current?.dbProjectId).toBe("ops");
    expect(capturedRef.current?.activeView).toBe("calendar");
  });

  test("reconcileProjectOrder follows the canonical catalog order", () => {
    resetStorage();
    const result = workbenchTestHelpers.reconcileProjectOrder(
      ["b", "a"],
      [
        makeProject("a", "A"),
        makeProject("b", "B"),
        makeProject("c", "C"),
      ],
    );

    expect(JSON.stringify(result)).toBe(JSON.stringify(["a", "b", "c"]));
  });

  test("resolves the adjacent project when the active project leaves the catalog", () => {
    resetStorage();
    const result = workbenchTestHelpers.resolveActiveProjectAfterCatalogChange(
      "second",
      ["first", "second", "third"],
      [makeProject("first", "First"), makeProject("third", "Third")],
    );

    expect(result).toBe("third");
  });

  test("resolves adjacency from the previous displayed order after reordering", () => {
    resetStorage();
    const result = workbenchTestHelpers.resolveActiveProjectAfterCatalogChange(
      "active",
      ["third", "active", "second"],
      [makeProject("third", "Third"), makeProject("second", "Second")],
    );

    expect(result).toBe("second");
  });

  test("resolves no active project when the final project leaves the catalog", () => {
    resetStorage();
    const result = workbenchTestHelpers.resolveActiveProjectAfterCatalogChange(
      "only",
      ["only"],
      [],
    );

    expect(result).toBeNull();
  });

  test("preserves an intentional no-project selection when a project is restored", () => {
    resetStorage();
    const result = workbenchTestHelpers.resolveActiveProjectAfterCatalogChange(
      null,
      [],
      [makeProject("restored", "Restored")],
    );

    expect(result).toBeNull();
  });

  test("normalizes and validates view map", () => {
    resetStorage();
    const normalized = workbenchTestHelpers.normalizeViewMap({
      one: "kanban",
      two: "invalid",
      three: "calendar",
    });

    expect(JSON.stringify(normalized)).toBe(JSON.stringify({ one: "kanban", three: "calendar" }));
  });

  test("ignores old tabs state and falls back to current defaults", () => {
    resetStorage();
    localStorageRef.setItem(
      "nodex-tabs",
      JSON.stringify({
        tabs: [
          {
            id: "tab-1",
            projectId: "alpha",
            viewMode: "list",
            searchQueries: { alpha: "bug" },
          },
          {
            id: "tab-2",
            projectId: "beta",
            viewMode: "calendar",
            searchQueries: { beta: "today" },
          },
        ],
        activeTabId: "tab-2",
      }),
    );

    const state = workbenchTestHelpers.loadInitialState();

    expect(state.dbProjectId).toBeNull();
    expect(state.threadsProjectId).toBeNull();
    expect(JSON.stringify(state.projectOrder)).toBe(JSON.stringify([]));
    expect(JSON.stringify(state.viewsByProject)).toBe(JSON.stringify({}));
    expect(JSON.stringify(state.searchByProject)).toBe(JSON.stringify({}));
    expect(state.activePagesTabId).toBe("");
  });

  test("initial layout snapshot overrides stale browser session storage", () => {
    resetStorage();
    sessionStorageRef.setItem(
      workbenchStorageKeys.workbench,
      JSON.stringify({
        dbProjectId: "stale",
        threadsProjectId: "stale",
        viewsByProject: { stale: "kanban" },
        activePagesTabId: "session:stale",
        activeRecentSessionId: "stale",
        activeThreadsTabId: "thread:stale",
      }),
    );

    const state = workbenchTestHelpers.loadInitialState({
      layoutSnapshot: {
        ...createDefaultWorkbenchLayoutSnapshot(),
        version: 3,
        dbProjectId: "default",
        threadsProjectId: "ops",
        viewsByProject: { default: "calendar", ops: "list" },
        focusedStage: "threads",
        stageNavDirection: "left",
        activePagesTabId: "session:recent-1",
        activeRecentSessionId: "recent-1",
        activeThreadsTabId: "thread-1",
        recentPageSessions: [
          {
            id: "recent-1",
            projectId: "default",
            pageId: "page-1",
            titleSnapshot: "Card 1",
            lastOpenedAt: "2026-03-09T00:00:00.000Z",
          },
        ],
        pageStage: {
          open: true,
          projectId: "default",
          pageId: "page-1",
        },
      },
    });

    expect(state.dbProjectId).toBe("default");
    expect(state.threadsProjectId).toBe("ops");
    expect(JSON.stringify(state.viewsByProject)).toBe(JSON.stringify({
      default: "calendar",
      ops: "list",
    }));
    expect(state.focusedStage).toBe("threads");
    expect(state.stageNavDirection).toBe("left");
    expect(state.activePagesTabId).toBe("session:recent-1");
    expect(state.activeRecentSessionId).toBe("recent-1");
    expect(state.activeThreadsTabId).toBe("thread-1");
    expect(state.recentPageSessions.length).toBe(1);
    expect(state.recentPageSessions[0]?.id).toBe("recent-1");
  });

  test("loads persisted sidebar section collapse and show-more state per project", () => {
    resetStorage();
    sessionStorageRef.setItem(
      workbenchStorageKeys.workbench,
      JSON.stringify({
        sidebarSectionExpandedByProject: {
          default: {
            "pages:status:6-in-progress": true,
          },
        },
        sidebarSectionShowAllByProject: {
          default: {
            "recents:list": true,
          },
        },
      }),
    );

    const state = workbenchTestHelpers.loadInitialState();

    expect(state.sidebarSectionExpandedByProject.default?.["pages:status:6-in-progress"]).toBe(true);
    expect(state.sidebarSectionShowAllByProject.default?.["recents:list"]).toBe(true);
  });

  test("loads persisted db-view prefs per project and view", () => {
    resetStorage();
    localStorageRef.setItem(
      workbenchStorageKeys.dbViewPrefs,
      JSON.stringify({
        default: {
          list: {
            summaryExpanded: false,
            rules: {
              filter: {
                any: [
                  {
                    all: [
                      { field: "status", op: "in", values: ["backlog"] },
                    ],
                  },
                ],
              },
              sort: [{ field: "assignee", direction: "asc" }],
            },
          },
        },
      }),
    );

    const state = workbenchTestHelpers.loadInitialState();
    expect(state.dbViewPrefsByProject.default?.list?.summaryExpanded).toBe(false);
    expect(state.dbViewPrefsByProject.default?.list?.rules.sort[0]?.field).toBe("assignee");
    expect(state.dbViewPrefsByProject.default?.list?.rules.filter.any[0]?.all[0])
      .toEqual({ field: "status", op: "in", values: ["plan"] });
  });

  test("falls back to legacy workbench-session db-view prefs when dedicated storage is empty", () => {
    resetStorage();
    sessionStorageRef.setItem(
      workbenchStorageKeys.workbench,
      JSON.stringify({
        dbViewPrefsByProject: {
          default: {
            kanban: {
              summaryExpanded: false,
              rules: {
                filter: {
                  any: [
                    {
                      all: [
                        { field: "status", op: "in", values: ["done"] },
                      ],
                    },
                  ],
                },
                sort: [{ field: "created", direction: "asc" }],
              },
            },
          },
        },
      }),
    );

    const state = workbenchTestHelpers.loadInitialState();
    expect(state.dbViewPrefsByProject.default?.kanban?.summaryExpanded).toBe(false);
    expect(state.dbViewPrefsByProject.default?.kanban?.rules.sort[0]?.field).toBe("created");
    expect(state.dbViewPrefsByProject.default?.kanban?.rules.filter.any[0]?.all[0])
      .toEqual({ field: "status", op: "in", values: ["ship"] });
  });

  test("normalizeRecentSessions caps persisted sessions at ten", () => {
    resetStorage();
    const normalized = workbenchTestHelpers.normalizeRecentSessions(
      Array.from({ length: 12 }, (_, index) => ({
        id: `session-${index + 1}`,
        projectId: "default",
        pageId: `page-${index + 1}`,
        titleSnapshot: `Card ${index + 1}`,
        lastOpenedAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      })),
    );

    expect(normalized.length).toBe(10);
    expect(normalized[0]?.id).toBe("session-1");
    expect(normalized[9]?.id).toBe("session-10");
  });

  test("recordRecentPageLeaveInList inserts a newly left card at the front", () => {
    resetStorage();
    const next = workbenchTestHelpers.recordRecentPageLeaveInList(
      [
        {
          id: "session-2",
          projectId: "default",
          pageId: "page-2",
          titleSnapshot: "Card 2",
          lastOpenedAt: "2026-03-02T00:00:00.000Z",
        },
      ],
      "default",
      "page-1",
      "Card 1",
    );

    expect(next.length).toBe(2);
    expect(next[0]?.projectId).toBe("default");
    expect(next[0]?.pageId).toBe("page-1");
    expect(next[0]?.titleSnapshot).toBe("Card 1");
    expect(next[1]?.id).toBe("session-2");
  });

  test("recordRecentPageLeaveInList preserves position for pages already in recents", () => {
    resetStorage();
    const next = workbenchTestHelpers.recordRecentPageLeaveInList(
      [
        {
          id: "session-1",
          projectId: "default",
          pageId: "page-1",
          titleSnapshot: "Card 1",
          lastOpenedAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "session-2",
          projectId: "default",
          pageId: "page-2",
          titleSnapshot: "Card 2",
          lastOpenedAt: "2026-03-02T00:00:00.000Z",
        },
      ],
      "default",
      "page-2",
      "Card 2 renamed",
    );

    expect(next.length).toBe(2);
    expect(next[0]?.id).toBe("session-1");
    expect(next[1]?.id).toBe("session-2");
    expect(next[1]?.titleSnapshot).toBe("Card 2 renamed");
  });

  test("reorderRecentPageSessionsInList ignores unknown ids and preserves omitted sessions", () => {
    resetStorage();
    const recentSessions = [
      {
        id: "session-1",
        projectId: "default",
        pageId: "page-1",
        titleSnapshot: "Card 1",
        lastOpenedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "session-2",
        projectId: "default",
        pageId: "page-2",
        titleSnapshot: "Card 2",
        lastOpenedAt: "2026-03-02T00:00:00.000Z",
      },
      {
        id: "session-3",
        projectId: "default",
        pageId: "page-3",
        titleSnapshot: "Card 3",
        lastOpenedAt: "2026-03-03T00:00:00.000Z",
      },
    ];

    const next = workbenchTestHelpers.reorderRecentPageSessionsInList(
      recentSessions,
      ["missing", "session-3", "session-1"],
    );

    expect(next.map((session) => session.id).join(",")).toBe("session-3,session-1,session-2");
    expect(next[0]?.lastOpenedAt).toBe("2026-03-03T00:00:00.000Z");
    expect(next[1]?.lastOpenedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(next[2]?.lastOpenedAt).toBe("2026-03-02T00:00:00.000Z");
  });

  test("recordRecentPageLeave updates recents without overwriting the active destination session", async () => {
    resetStorage();

    let latestState: ReturnType<typeof useWorkbenchState> | null = null;
    const projects = [
      makeProject("default", "Default"),
    ];

    function Harness() {
      const state = useWorkbenchState(
        projects,
        {
          initialLayoutSnapshot: {
            ...createDefaultWorkbenchLayoutSnapshot(),
            version: 3,
            dbProjectId: "default",
            threadsProjectId: "default",
            viewsByProject: { default: "kanban" },
            focusedStage: "pages",
            stageNavDirection: "right",
            activePagesTabId: "session:session-2",
            activeRecentSessionId: "session-2",
            activeThreadsTabId: "thread:new",
            recentPageSessions: [
              {
                id: "session-2",
                projectId: "default",
                pageId: "page-2",
                titleSnapshot: "Card 2",
                lastOpenedAt: "2026-03-02T00:00:00.000Z",
              },
            ],
            pageStage: {
              open: true,
              projectId: "default",
              pageId: "page-2",
            },
          },
        },
      );

      useEffect(() => {
        latestState = state;
      }, [state]);

      return createElement("div");
    }

    function getLatestState(): ReturnType<typeof useWorkbenchState> {
      if (latestState === null) {
        throw new Error("Expected workbench state to be captured after render.");
      }

      return latestState;
    }

    renderWithRendererState(createElement(Harness));
    await settleAsyncRender();

    await act(async () => {
      getLatestState().recordRecentPageLeave("default", "page-1", "Card 1");
    });
    await settleAsyncRender();

    const state = getLatestState();
    expect(state.activeRecentSessionId).toBe("session-2");
    expect(state.activePagesTabId).toBe("session:session-2");
    expect(state.recentPageSessions.length).toBe(2);
    expect(state.recentPageSessions[0]?.pageId).toBe("page-1");
    expect(state.recentPageSessions[1]?.pageId).toBe("page-2");
  });

  test("shares one window layout across consumers and retains it across view remount", async () => {
    resetStorage();
    const store = createMaitaiStore();
    const captured: Array<ReturnType<typeof useWorkbenchState> | null> = [null, null];

    function Probe({ index }: { index: number }) {
      captured[index] = useWorkbenchState(PROJECTS);
      return null;
    }

    const tree = (indices: number[]) => createElement(
      MaitaiProvider,
      {
        store,
        children: indices.map((index) => createElement(Probe, { key: index, index })),
      },
    );
    const view = render(tree([0, 1]));
    await settleAsyncRender();

    await act(async () => {
      captured[0]?.setDbProject("ops");
      await Promise.resolve();
    });

    expect(captured[0]?.dbProjectId).toBe("ops");
    expect(captured[1]?.dbProjectId).toBe("ops");

    view.rerender(tree([1]));
    await settleAsyncRender();
    expect(captured[1]?.dbProjectId).toBe("ops");
  });

  test("findRecentPageSession matches pages by project and page id", () => {
    resetStorage();
    const match = workbenchTestHelpers.findRecentPageSession(
      [
        {
          id: "session-1",
          projectId: "default",
          pageId: "page-1",
          titleSnapshot: "Card 1",
          lastOpenedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      "default",
      "page-1",
    );

    expect(match?.id).toBe("session-1");
  });

  test("resolvePagesStageSelectionForPage keeps page-session and history state separate", () => {
    resetStorage();
    const recentSessions = [
      {
        id: "session-1",
        projectId: "default",
        pageId: "page-1",
        titleSnapshot: "Card 1",
        lastOpenedAt: "2026-03-01T00:00:00.000Z",
      },
    ];

    const existingSelection = workbenchTestHelpers.resolvePagesStageSelectionForPage(
      recentSessions,
      "default",
      "page-1",
    );
    const missingSelection = workbenchTestHelpers.resolvePagesStageSelectionForPage(
      recentSessions,
      "default",
      "page-2",
    );

    expect(existingSelection.activeRecentSessionId).toBe("session-1");
    expect(existingSelection.activePagesTabId).toBe("session:session-1");
    expect(missingSelection.activeRecentSessionId).toBe(null);
    expect(missingSelection.activePagesTabId).toBe("");
  });

  test("space refs have stable color and initial", () => {
    resetStorage();
    const one = workbenchTestHelpers.makeProjectRef("project-a");
    const two = workbenchTestHelpers.makeProjectRef("project-a");

    expect(one.colorToken).toBe(two.colorToken);
    expect(one.initial).toBe("P");
  });

  test("resolveExpandedStages uses direction for middle stages", () => {
    const right = workbenchTestHelpers.resolveExpandedStages("threads", "right", 2, false);
    const left = workbenchTestHelpers.resolveExpandedStages("threads", "left", 2, false);

    expect(JSON.stringify(right)).toBe(JSON.stringify(["threads", "files"]));
    expect(JSON.stringify(left)).toBe(JSON.stringify(["pages", "threads"]));
  });

  test("resolveExpandedStages collapses to one in narrow mode", () => {
    const result = workbenchTestHelpers.resolveExpandedStages("files", "right", 4, true);
    expect(JSON.stringify(result)).toBe(JSON.stringify(["files"]));
  });

  test("resolveExpandedStages keeps canonical order at edges", () => {
    const right = workbenchTestHelpers.resolveExpandedStages("files", "right", 2, false);
    const left = workbenchTestHelpers.resolveExpandedStages("files", "left", 2, false);

    expect(JSON.stringify(right)).toBe(JSON.stringify(["threads", "files"]));
    expect(JSON.stringify(left)).toBe(JSON.stringify(["threads", "files"]));
  });

  test("resolveExpandedStages supports 3-pane windows", () => {
    const right = workbenchTestHelpers.resolveExpandedStages("pages", "right", 3, false);
    const left = workbenchTestHelpers.resolveExpandedStages("threads", "left", 3, false);

    expect(JSON.stringify(right)).toBe(JSON.stringify(["pages", "threads", "files"]));
    expect(JSON.stringify(left)).toBe(JSON.stringify(["db", "pages", "threads"]));
  });

  test("resolveNearestSlidingWindowDirection keeps visible stage window stable", () => {
    const direction = workbenchTestHelpers.resolveNearestSlidingWindowDirection(
      "pages",
      ["db", "pages"],
      2,
      "right",
    );

    expect(direction).toBe("left");
  });

  test("resolveNearestSlidingWindowDirection picks the nearest window shift", () => {
    const towardsRight = workbenchTestHelpers.resolveNearestSlidingWindowDirection(
      "threads",
      ["db", "pages"],
      2,
      "right",
    );
    const towardsLeft = workbenchTestHelpers.resolveNearestSlidingWindowDirection(
      "pages",
      ["threads", "files"],
      2,
      "left",
    );

    expect(towardsRight).toBe("left");
    expect(towardsLeft).toBe("right");
  });

  test("resolveNearestSlidingWindowDirection falls back when current window is unavailable", () => {
    const direction = workbenchTestHelpers.resolveNearestSlidingWindowDirection(
      "threads",
      ["threads"],
      2,
      "right",
    );

    expect(direction).toBe("right");
  });

  test("resolveSlidingWindowFocusIntent returns nearest direction", () => {
    const files = workbenchTestHelpers.resolveSlidingWindowFocusIntent("files", ["threads", "files"], 2, "left");
    expect(files.direction).toBe("left");
  });

  test("resolveSlidingWindowShift keeps focus when the focused stage remains visible", () => {
    const shifted = workbenchTestHelpers.resolveSlidingWindowShift(
      "threads",
      "left",
      2,
      1,
    );

    expect(shifted.focusedStage).toBe("threads");
    expect(shifted.stageNavDirection).toBe("right");
    expect(
      JSON.stringify(
        workbenchTestHelpers.resolveExpandedStages(
          shifted.focusedStage,
          shifted.stageNavDirection,
          2,
          false,
        ),
      ),
    ).toBe(JSON.stringify(["threads", "files"]));
  });

  test("resolveSlidingWindowShift falls back to the entering edge when focus would leave the window", () => {
    const shiftedRight = workbenchTestHelpers.resolveSlidingWindowShift(
      "db",
      "right",
      2,
      1,
    );
    const shiftedLeft = workbenchTestHelpers.resolveSlidingWindowShift(
      "files",
      "left",
      2,
      -1,
    );

    expect(shiftedRight.focusedStage).toBe("pages");
    expect(shiftedRight.stageNavDirection).toBe("right");
    expect(
      JSON.stringify(
        workbenchTestHelpers.resolveExpandedStages(
          shiftedRight.focusedStage,
          shiftedRight.stageNavDirection,
          2,
          false,
        ),
      ),
    ).toBe(JSON.stringify(["pages", "threads"]));

    expect(shiftedLeft.focusedStage).toBe("threads");
    expect(shiftedLeft.stageNavDirection).toBe("left");
    expect(
      JSON.stringify(
        workbenchTestHelpers.resolveExpandedStages(
          shiftedLeft.focusedStage,
          shiftedLeft.stageNavDirection,
          2,
          false,
        ),
      ),
    ).toBe(JSON.stringify(["pages", "threads"]));
  });

  test("resolveSlidingWindowShift is a no-op when the window cannot move", () => {
    const shifted = workbenchTestHelpers.resolveSlidingWindowShift(
      "db",
      "right",
      2,
      -1,
    );

    expect(shifted.focusedStage).toBe("db");
    expect(shifted.stageNavDirection).toBe("right");
  });

  test("resolveEffectiveSlidingWindowPaneCount caps panes by available width", () => {
    expect(workbenchTestHelpers.resolveEffectiveSlidingWindowPaneCount(4, 1200)).toBe(4);
    expect(workbenchTestHelpers.resolveEffectiveSlidingWindowPaneCount(4, 950)).toBe(3);
    expect(workbenchTestHelpers.resolveEffectiveSlidingWindowPaneCount(4, 540)).toBe(1);
  });

  test("resolveSlidingWindowPaneCountChange grows the window to the right before falling back left", () => {
    const appendRight = workbenchTestHelpers.resolveSlidingWindowPaneCountChange(
      "db",
      "right",
      2,
      "increase",
    );
    const appendLeftFallback = workbenchTestHelpers.resolveSlidingWindowPaneCountChange(
      "threads",
      "right",
      2,
      "increase",
    );

    expect(appendRight.slidingWindowPaneCount).toBe(3);
    expect(appendRight.focusedStage).toBe("db");
    expect(appendRight.stageNavDirection).toBe("right");
    expect(
      JSON.stringify(
        workbenchTestHelpers.resolveExpandedStages(
          appendRight.focusedStage,
          appendRight.stageNavDirection,
          appendRight.slidingWindowPaneCount,
          false,
        ),
      ),
    ).toBe(JSON.stringify(["db", "pages", "threads"]));

    expect(appendLeftFallback.slidingWindowPaneCount).toBe(3);
    expect(
      JSON.stringify(
        workbenchTestHelpers.resolveExpandedStages(
          appendLeftFallback.focusedStage,
          appendLeftFallback.stageNavDirection,
          appendLeftFallback.slidingWindowPaneCount,
          false,
        ),
      ),
    ).toBe(JSON.stringify(["pages", "threads", "files"]));
  });

  test("resolveSlidingWindowPaneCountChange removes the right-most pane", () => {
    const keepFocus = workbenchTestHelpers.resolveSlidingWindowPaneCountChange(
      "pages",
      "right",
      3,
      "decrease",
    );
    const dropFocusedRightEdge = workbenchTestHelpers.resolveSlidingWindowPaneCountChange(
      "threads",
      "left",
      2,
      "decrease",
    );

    expect(keepFocus.slidingWindowPaneCount).toBe(2);
    expect(keepFocus.focusedStage).toBe("pages");
    expect(keepFocus.stageNavDirection).toBe("right");
    expect(
      JSON.stringify(
        workbenchTestHelpers.resolveExpandedStages(
          keepFocus.focusedStage,
          keepFocus.stageNavDirection,
          keepFocus.slidingWindowPaneCount,
          false,
        ),
      ),
    ).toBe(JSON.stringify(["pages", "threads"]));

    expect(dropFocusedRightEdge.slidingWindowPaneCount).toBe(1);
    expect(dropFocusedRightEdge.focusedStage).toBe("pages");
    expect(dropFocusedRightEdge.stageNavDirection).toBe("left");
    expect(
      JSON.stringify(
        workbenchTestHelpers.resolveExpandedStages(
          dropFocusedRightEdge.focusedStage,
          dropFocusedRightEdge.stageNavDirection,
          dropFocusedRightEdge.slidingWindowPaneCount,
          false,
        ),
      ),
    ).toBe(JSON.stringify(["pages"]));
  });

  test("normalizes sliding-window pane count and rejects invalid values", () => {
    expect(workbenchTestHelpers.normalizeSlidingWindowPaneCount(3)).toBe(3);
    expect(workbenchTestHelpers.normalizeSlidingWindowPaneCount(0)).toBe(1);
    expect(workbenchTestHelpers.normalizeSlidingWindowPaneCount(9)).toBe(4);
    expect(workbenchTestHelpers.normalizeSlidingWindowPaneCount(Number.NaN)).toBe(null);
  });

  test("an explicit projectless layout overrides stale persisted Project ids", () => {
    resetStorage();
    sessionStorageRef.setItem(
      workbenchStorageKeys.workbench,
      JSON.stringify({ dbProjectId: "stale", threadsProjectId: "stale" }),
    );

    const state = workbenchTestHelpers.loadInitialState({
      layoutSnapshot: createDefaultWorkbenchLayoutSnapshot(),
    });

    expect(state.dbProjectId).toBeNull();
    expect(state.threadsProjectId).toBeNull();
  });

  test("resolves persisted sliding-window pane count from canonical values only", () => {
    const explicit = workbenchTestHelpers.resolvePersistedSlidingWindowPaneCount(3);
    const fallback = workbenchTestHelpers.resolvePersistedSlidingWindowPaneCount(undefined);

    expect(explicit).toBe(3);
    expect(fallback).toBe(2);
  });

  test("ignores legacy workbench-only keys and uses current defaults", () => {
    resetStorage();
    sessionStorageRef.setItem(
      workbenchStorageKeys.workbench,
      JSON.stringify({
        activeProjectId: "beta",
        dualPaneRightFolded: true,
        focusedStageByProject: {
          beta: "threads",
        },
        activeTerminalTabByProject: {
          beta: "project:beta",
        },
      }),
    );

    const state = workbenchTestHelpers.loadInitialState();

    expect(state.dbProjectId).toBeNull();
    expect(state.focusedStage).toBe("db");
    expect(state.slidingWindowPaneCount).toBe(2);
    resetStorage();
  });

  test("drops invalid stage ids from persisted stage maps", () => {
    const normalized = workbenchTestHelpers.normalizeStageMap({
      alpha: "terminal",
      beta: "threads",
    });

    expect(JSON.stringify(normalized)).toBe(JSON.stringify({ beta: "threads" }));
  });

  test("replaces workbench state from a workspace layout snapshot", async () => {
    resetStorage();
    type CapturedWorkbenchState = {
      replaceLayoutSnapshot: (layout: WorkbenchLayoutSnapshot) => void;
      dbProjectId: string | null;
      activeView: string;
      activeSearchQuery: string;
      focusedStage: string;
      sidebar: {
        collapsibleSections: {
          pinned: boolean;
          projects: boolean;
          chats: boolean;
        };
      };
    };
    const capturedRef: { current: CapturedWorkbenchState | null } = { current: null };

    function Harness() {
      capturedRef.current = useWorkbenchState(PROJECTS);
      return null;
    }

    renderWithRendererState(createElement(Harness));
    await settleAsyncRender();

    const layout: WorkbenchLayoutSnapshot = {
      version: 3,
      dbProjectId: "ops",
      activeProjectSessionId: "session:ops:alpha",
      threadsProjectId: "ops",
      viewsByProject: { ops: "calendar" },
      searchByProject: { ops: "release" },
      dbViewPrefsByProject: {},
      projectOrder: ["ops", "default"],
      focusedStage: "threads",
      stageNavDirection: "left",
      sidebar: {
        collapsed: false,
        width: 300,
        collapsibleSections: { projects: true, chats: true },
      },
      dock: {
        width: 560,
        tree: { type: "leaf", id: "dock", tabs: [], activeTabId: null },
      },
      sidebarStageExpandedByProject: {},
      sidebarSectionExpandedByProject: {},
      sidebarSectionShowAllByProject: {},
      activePagesTabId: "",
      activeRecentSessionId: null,
      recentPageSessions: [],
      pageStage: {
        open: false,
        projectId: "",
        pageId: null,
      },
      threadsTabs: [{ id: "thread:new", title: "New thread", preview: "" }],
      activeThreadsTabId: "thread:new",
      filesTabs: [{ id: "diff", title: "Diffs" }],
      activeFilesTabId: "diff",
      stagePanelWidths: {},
      slidingWindowPaneCount: 3,
      sessionViewsBySessionId: {},
    };

    await act(async () => {
      capturedRef.current?.replaceLayoutSnapshot(layout);
    });

    if (!capturedRef.current) throw new Error("missing workbench state");
    const nextState = capturedRef.current;
    expect(nextState.dbProjectId).toBe("ops");
    expect(nextState.activeView).toBe("calendar");
    expect(nextState.activeSearchQuery).toBe("release");
    expect(nextState.focusedStage).toBe("threads");
    expect(nextState.sidebar.collapsibleSections.projects).toBe(true);
    expect(nextState.sidebar.collapsibleSections.chats).toBe(true);
    expect(nextState.sidebar.collapsibleSections.pinned).toBe(false);
  });

  test("discards removed sidebar organization preferences from persisted state", async () => {
    resetStorage();
    localStorageRef.setItem(workbenchStorageKeys.sidebar, JSON.stringify({
      collapsed: false,
      width: 320,
      pinnedOrganizationMode: "manualOrder",
      topLevelSectionOrder: ["recents", "pages", "threads", "files"],
      topLevelSections: {
        recents: { visible: false, itemLimit: 5 },
      },
    }));
    const capturedRef: { current: ReturnType<typeof useWorkbenchState> | null } = { current: null };

    function Harness() {
      capturedRef.current = useWorkbenchState(PROJECTS);
      return null;
    }

    renderWithRendererState(createElement(Harness));
    await settleAsyncRender();

    if (!capturedRef.current) throw new Error("missing workbench state");
    expect(capturedRef.current.sidebar.width).toBe(320);
    expect(Object.hasOwn(capturedRef.current.sidebar, "pinnedOrganizationMode")).toBe(false);
    expect(Object.hasOwn(capturedRef.current.sidebar, "topLevelSectionOrder")).toBe(false);
    expect(Object.hasOwn(capturedRef.current.sidebar, "topLevelSections")).toBe(false);

    const rawSidebarPrefs = localStorageRef.getItem(workbenchStorageKeys.sidebar);
    const sidebarPrefs = JSON.parse(rawSidebarPrefs ?? "{}") as Record<string, unknown>;
    expect(Object.hasOwn(sidebarPrefs, "pinnedOrganizationMode")).toBe(false);
    expect(Object.hasOwn(sidebarPrefs, "topLevelSectionOrder")).toBe(false);
    expect(Object.hasOwn(sidebarPrefs, "topLevelSections")).toBe(false);
  });

  test("persists sidebar organizer section collapse state in sidebar prefs", async () => {
    resetStorage();
    const capturedRef: { current: ReturnType<typeof useWorkbenchState> | null } = { current: null };

    function Harness() {
      capturedRef.current = useWorkbenchState(PROJECTS);
      return null;
    }

    renderWithRendererState(createElement(Harness));
    await settleAsyncRender();

    if (!capturedRef.current) throw new Error("missing workbench state");
    expect(capturedRef.current.sidebar.collapsibleSections.projects).toBe(false);
    expect(capturedRef.current.sidebar.collapsibleSections.chats).toBe(false);

    await act(async () => {
      capturedRef.current?.setSidebarCollapsibleSectionCollapsed("projects", true);
      capturedRef.current?.setSidebarCollapsibleSectionCollapsed("chats", true);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const rawSidebarPrefs = localStorageRef.getItem(workbenchStorageKeys.sidebar);
    const sidebarPrefs = JSON.parse(rawSidebarPrefs ?? "{}") as {
      collapsibleSections?: { projects?: boolean; chats?: boolean; pinned?: boolean };
    };
    expect(sidebarPrefs.collapsibleSections?.projects).toBe(true);
    expect(sidebarPrefs.collapsibleSections?.chats).toBe(true);
    expect(sidebarPrefs.collapsibleSections?.pinned).toBe(false);
  });

  resetStorage();
});
