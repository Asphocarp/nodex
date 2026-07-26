import { describe, expect, test, vi } from "vitest";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarDeviceToolbarState,
  BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";
import {
  activateWorkbenchSessionViewTab,
  createEmptyWorkbenchSessionView,
  createWorkbenchSessionViewTab,
  patchWorkbenchSessionViewPanel,
} from "../../shared/workbench-session-view";
import type { ProjectSession } from "../../shared/types";
import {
  createCodexForkBrowserSnapshotAdapter,
  type CodexForkBrowserRuntime,
} from "./codex-fork-browser-snapshot-adapter";

function makeSession(id: string): ProjectSession {
  return {
    id,
    projectId: "project",
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
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  };
}

const deviceState: BrowserSidebarDeviceToolbarState = {
  responsiveViewportSize: null,
  toolbarState: {
    isEnabled: true,
    presetId: "responsive",
    width: 390,
    height: 844,
  },
};

function makeHarness() {
  const browserState: BrowserSidebarStateSnapshot = { tabs: [] };
  const browserUseState: BrowserSidebarBrowserUseStateSnapshot = {
    tabs: [],
    activeBrowserTabIdsByConversationScope: {},
    cursors: [],
  };
  const runtime: CodexForkBrowserRuntime = {
    getBrowserUseStateSnapshot: () => browserUseState,
    getConversationBrowserTabIds: () => [],
    getDeviceToolbarTabState: () => deviceState,
    getStateSnapshot: () => browserState,
    openClonedBrowserTab: vi.fn(),
    primeTransferredBrowserTabId: vi.fn(),
    setDeviceToolbarTabState: vi.fn(),
  };
  const sessions = new Map([
    ["session-source", makeSession("session-source")],
    ["session-target", makeSession("session-target")],
  ]);
  const adapter = createCodexForkBrowserSnapshotAdapter({
    getProjectSession: async (id) => sessions.get(id) ?? null,
    resolveBrowserConversationId: async (conversationId) =>
      conversationId === "thread-source"
        ? "session-source"
        : conversationId === "thread-target"
          ? "session-target"
          : conversationId,
    runtime,
  });
  return { adapter, runtime };
}

function sourceView() {
  const empty = createEmptyWorkbenchSessionView("session-source", {
    touchedAt: "2026-07-23T00:00:00.000Z",
    identityFactory: {
      createId: (kind) => `${kind}:seed`,
    },
  });
  const withTab = createWorkbenchSessionViewTab(empty, {
    panelId: "right",
    tab: {
      id: "view-browser",
      kind: "browser",
      titleSnapshot: "Docs",
      config: {
        browserTabId: "runtime-browser",
        url: "https://example.com",
      },
      stateKey: 0,
      state: null,
    },
  });
  const visible = patchWorkbenchSessionViewPanel(withTab, "right", {
    collapsed: false,
  });
  return activateWorkbenchSessionViewTab(
    visible,
    "right",
    visible.panels.right.layout.activeLeafId,
    "view-browser",
  );
}

describe("createCodexForkBrowserSnapshotAdapter", () => {
  test("captures the initiating Window Session view instead of Core session UI", async () => {
    const { adapter } = makeHarness();
    const snapshot = await adapter.capture("thread-source", {
      browserViewScopeId: "window-source",
      view: sourceView(),
    });
    expect(snapshot.sourceBrowserViewScopeId).toBe("window-source");
    expect(snapshot.tabs).toMatchObject([
      {
        active: true,
        browserTabId: "runtime-browser",
        initialUrl: "https://example.com",
        panel: "right",
        tabId: "view-browser",
      },
    ]);
  });

  test("remints view/runtime identities and clones runtime into the consuming window", async () => {
    const { adapter, runtime } = makeHarness();
    const captured = await adapter.capture("thread-source", {
      browserViewScopeId: "window-source",
      view: sourceView(),
    });
    const rebased = await adapter.rebase(captured, {
      targetConversationId: "thread-target",
    });
    const applied = await adapter.apply(rebased, {
      targetBrowserViewScopeId: "window-target",
      targetConversationId: "thread-target",
      targetProjectSessionId: "session-target",
    });
    expect(applied).toBeTruthy();
    expect(applied?.targetBrowserViewScopeId).toBe("window-target");
    expect(applied?.tabs[0]?.tabId).not.toBe("view-browser");
    expect(applied?.tabs[0]?.browserTabId).not.toBe("runtime-browser");
    expect(runtime.openClonedBrowserTab).toHaveBeenCalledWith(expect.objectContaining({
      browserConversationId: "session-target",
      browserViewScopeId: "window-target",
      initialUrl: "https://example.com",
    }));
  });

  test("rejects a target whose Session identity does not match the rebased conversation", async () => {
    const { adapter } = makeHarness();
    const captured = await adapter.capture("thread-source", {
      browserViewScopeId: "window-source",
      view: sourceView(),
    });
    await expect(adapter.apply(captured, {
      targetBrowserViewScopeId: "window-target",
      targetConversationId: "thread-target",
      targetProjectSessionId: "session-target",
    })).rejects.toThrow("identity is not stable");
  });
});
