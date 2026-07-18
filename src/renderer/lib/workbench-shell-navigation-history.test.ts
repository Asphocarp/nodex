import { beforeEach, describe, expect, test } from "vitest";
import { parseDatabaseId } from "../../shared/database-identities";
import {
  navigateBackInWorkbenchShellHistory,
  navigateForwardInWorkbenchShellHistory,
  normalizeWorkbenchShellNavigationHistoryState,
  recordWorkbenchShellNavigationTransition,
  removeLibraryRoutesFromWorkbenchShellNavigationHistory,
  workbenchShellNavigationHistoryStorageKey,
  type WorkbenchShellNavigationSnapshot,
} from "./workbench-shell-navigation-history";

const mockStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
})();

if (!(globalThis as { sessionStorage?: unknown }).sessionStorage) {
  (globalThis as { sessionStorage: typeof mockStorage }).sessionStorage = mockStorage;
}

function makeSnapshot(overrides: Partial<WorkbenchShellNavigationSnapshot> = {}): WorkbenchShellNavigationSnapshot {
  return {
    activeProjectId: "alpha",
    activeSessionId: "session:alpha:database-view",
    activeView: "kanban",
    rightActiveTabId: "alpha-db",
    bottomActiveTabId: null,
    rightPanelCollapsed: false,
    bottomPanelCollapsed: true,
    rightPanelFullWidth: false,
    libraryRoute: null,
    ...overrides,
  };
}

beforeEach(() => {
  ((globalThis as { sessionStorage?: typeof mockStorage }).sessionStorage ?? mockStorage).removeItem(
    workbenchShellNavigationHistoryStorageKey,
  );
});

describe("workbench shell navigation history", () => {
  test("does not record unchanged snapshots", () => {
    const snapshot = makeSnapshot();
    const history = recordWorkbenchShellNavigationTransition({ backStack: [], forwardStack: [] }, snapshot, snapshot);

    expect(history.backStack.length).toBe(0);
    expect(history.forwardStack.length).toBe(0);
  });

  test("records changed snapshots and clears forward stack", () => {
    const first = makeSnapshot();
    const second = makeSnapshot({ activeSessionId: "session:alpha:2" });
    const third = makeSnapshot({ activeSessionId: "session:alpha:3" });
    const history = recordWorkbenchShellNavigationTransition(
      { backStack: [makeSnapshot({ activeProjectId: "beta" })], forwardStack: [third] },
      first,
      second,
    );

    expect(history.backStack.length).toBe(2);
    expect(history.backStack[1]?.activeSessionId).toBe("session:alpha:database-view");
    expect(history.forwardStack.length).toBe(0);
  });

  test("back pushes current snapshot to the forward stack", () => {
    const first = makeSnapshot();
    const second = makeSnapshot({ activeSessionId: "session:alpha:2" });
    const history = recordWorkbenchShellNavigationTransition({ backStack: [], forwardStack: [] }, first, second);
    const result = navigateBackInWorkbenchShellHistory(history, second);

    expect(result.snapshot?.activeSessionId).toBe("session:alpha:database-view");
    expect(result.historyState.backStack.length).toBe(0);
    expect(result.historyState.forwardStack[0]?.activeSessionId).toBe("session:alpha:2");
  });

  test("round-trips Library routes through Back and Forward history", () => {
    const chat = makeSnapshot();
    const libraryHome = makeSnapshot({ libraryRoute: { kind: "home" } });
    const libraryPage = makeSnapshot({
      libraryRoute: { kind: "page", pageId: "page-1" },
    });
    const afterHome = recordWorkbenchShellNavigationTransition(
      { backStack: [], forwardStack: [] },
      chat,
      libraryHome,
    );
    const afterPage = recordWorkbenchShellNavigationTransition(
      afterHome,
      libraryHome,
      libraryPage,
    );

    const back = navigateBackInWorkbenchShellHistory(afterPage, libraryPage);
    expect(back.snapshot?.libraryRoute).toEqual({ kind: "home" });
    const backToChat = navigateBackInWorkbenchShellHistory(
      back.historyState,
      libraryHome,
    );
    expect(backToChat.snapshot?.libraryRoute).toBeNull();
    const forward = navigateForwardInWorkbenchShellHistory(
      backToChat.historyState,
      chat,
    );
    expect(forward.snapshot?.libraryRoute).toEqual({ kind: "home" });
  });

  test("preserves explicit Project context for an opened Library Database", () => {
    const snapshot = makeSnapshot({
      activeProjectId: "beta",
      libraryRoute: {
        kind: "database",
        databaseId: parseDatabaseId("database-1"),
        accessProjectId: "beta",
      },
    });
    const normalized = normalizeWorkbenchShellNavigationHistoryState({
      backStack: [snapshot],
      forwardStack: [],
    });

    expect(normalized.backStack[0]?.libraryRoute).toEqual({
      kind: "database",
      databaseId: "database-1",
      accessProjectId: "beta",
    });
  });

  test("removes persisted Library routes while retaining Project navigation", () => {
    const history = removeLibraryRoutesFromWorkbenchShellNavigationHistory({
      backStack: [
        makeSnapshot({ activeSessionId: "session:alpha:previous" }),
        makeSnapshot({ libraryRoute: { kind: "home" } }),
      ],
      forwardStack: [
        makeSnapshot({ activeSessionId: "session:alpha:next" }),
        makeSnapshot({
          activeSessionId: "session:alpha:2",
          libraryRoute: { kind: "page", pageId: "page-1" },
        }),
      ],
    });

    expect(history.backStack).toHaveLength(1);
    expect(history.backStack[0]?.libraryRoute).toBeNull();
    expect(history.backStack[0]?.activeSessionId).toBe("session:alpha:previous");
    expect(history.forwardStack).toHaveLength(1);
    expect(history.forwardStack[0]?.libraryRoute).toBeNull();
    expect(history.forwardStack[0]?.activeSessionId).toBe("session:alpha:next");
  });

  test("forward pushes current snapshot to the back stack", () => {
    const first = makeSnapshot();
    const second = makeSnapshot({ activeSessionId: "session:alpha:2" });
    const backResult = navigateBackInWorkbenchShellHistory(
      recordWorkbenchShellNavigationTransition({ backStack: [], forwardStack: [] }, first, second),
      second,
    );
    const forwardResult = navigateForwardInWorkbenchShellHistory(backResult.historyState, first);

    expect(forwardResult.snapshot?.activeSessionId).toBe("session:alpha:2");
    expect(forwardResult.historyState.backStack[0]?.activeSessionId).toBe("session:alpha:database-view");
    expect(forwardResult.historyState.forwardStack.length).toBe(0);
  });

  test("drops invalid persisted snapshots", () => {
    const state = normalizeWorkbenchShellNavigationHistoryState({
      backStack: [
        makeSnapshot(),
        { activeProjectId: "", activeSessionId: 12 },
      ],
      forwardStack: [
        makeSnapshot({ activeSessionId: "session:alpha:2" }),
        { rightPanelCollapsed: "false" },
      ],
    } as unknown);

    expect(state.backStack.length).toBe(1);
    expect(state.forwardStack.length).toBe(1);
    expect(state.forwardStack[0]?.activeSessionId).toBe("session:alpha:2");
  });
});
