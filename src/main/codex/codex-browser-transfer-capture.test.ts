import { describe, expect, test } from "vitest";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarStateSnapshot,
  BrowserSidebarTabSnapshot,
  BrowserUseTabState,
} from "../../shared/browser-sidebar";
import { makeProjectSessionPanelLayout } from "../../shared/project-session-panel-layout";
import type { PanelId, ProjectSession, ProjectSessionTab } from "../../shared/types";
import { captureCodexOrdinaryBrowserTransfer } from "./codex-browser-transfer-capture";

function makeBrowserTab(id: string, panelId: PanelId, order: number): ProjectSessionTab {
  return {
    id,
    sessionId: "session-source",
    browserTabId: id,
    projectId: "project-source",
    panelId,
    kind: "browser",
    title: id,
    order,
    config: { projectId: "project-source" },
    stateKey: 0,
    state: {},
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}

function makeSession(input: {
  readonly tabs?: readonly ProjectSessionTab[];
  readonly rightActiveTabId?: string | null;
  readonly bottomActiveTabId?: string | null;
  readonly hasThread?: boolean;
} = {}): ProjectSession {
  const tabs = [...(input.tabs ?? [])];
  const panel = (panelId: PanelId, activeTabId: string | null | undefined) => ({
    collapsed: false,
    layout: makeProjectSessionPanelLayout(
      tabs.filter((tab) => tab.panelId === panelId).map((tab) => tab.id),
      activeTabId ?? null,
    ),
    size: {},
  });
  return {
    id: "session-source",
    projectId: "project-source",
    noThreadFallbackTitle: "Source",
    displayTitle: "Source",
    order: 0,
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    unread: false,
    leftPaneCollapsed: false,
    panels: {
      right: panel("right", input.rightActiveTabId),
      bottom: panel("bottom", input.bottomActiveTabId),
    },
    thread: input.hasThread
      ? {
          sessionId: "session-source",
          projectId: "project-source",
          threadId: "thread-source",
          threadPreview: "",
          modelProvider: "openai",
          statusType: "idle",
          statusActiveFlags: [],
          archived: false,
          createdAt: 0,
          updatedAt: 0,
          linkedAt: "2026-07-11T00:00:00.000Z",
        }
      : null,
    tabs,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}

function makeBrowserSnapshot(
  browserTabId: string,
  browserConversationId = "session-source",
): BrowserSidebarTabSnapshot {
  return {
    browserConversationId,
    browserTabId,
    projectId: "project-source",
    webContentsId: null,
    mountGeneration: 0,
    url: "about:blank",
    title: browserTabId,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    zoomPercent: 100,
    deviceToolbarVisible: false,
    viewport: { width: 0, height: 0, zoomPercent: 100, presetId: "responsive" },
    deviceToolbarState: {
      responsiveViewportSize: null,
      toolbarState: {
        isEnabled: false,
        presetId: "responsive",
        width: 0,
        height: 0,
      },
    },
    interactionMode: "browse",
    findState: {
      open: false,
      query: "",
      activeMatchOrdinal: null,
      matchCount: null,
      caseSensitive: false,
    },
    hasBrowserPage: false,
    pageActionsDisabled: true,
    updatedAt: 0,
  };
}

function makeBrowserUseTab(
  browserTabId: string,
  browserConversationId = "session-source",
): BrowserUseTabState {
  return {
    browserConversationId,
    browserTabId,
    projectId: "project-source",
    title: browserTabId,
    url: "about:blank",
    webContentsId: null,
    viewport: { width: 0, height: 0, zoomPercent: 100, presetId: "responsive" },
    captureActive: false,
    released: false,
    updatedAt: 0,
  };
}

function capture(input: {
  readonly session: ProjectSession;
  readonly browserTabs?: readonly BrowserSidebarTabSnapshot[];
  readonly browserUseTabs?: readonly BrowserUseTabState[];
  readonly activeBrowserUseTabId?: string | null;
  readonly enabled?: boolean;
}) {
  const browserState: BrowserSidebarStateSnapshot = { tabs: [...(input.browserTabs ?? [])] };
  const browserUseState: BrowserSidebarBrowserUseStateSnapshot = {
    tabs: [...(input.browserUseTabs ?? [])],
    activeBrowserTabIdsByConversation: input.activeBrowserUseTabId === undefined
      || input.activeBrowserUseTabId === null
      ? {}
      : { "session-source": input.activeBrowserUseTabId },
    cursors: [],
  };
  return captureCodexOrdinaryBrowserTransfer({
    session: input.session,
    browserState,
    browserUseState,
    enabled: input.enabled ?? true,
  });
}

describe("captureCodexOrdinaryBrowserTransfer", () => {
  test("fails closed outside the Home-equivalent threadless session and browser gate", () => {
    const tab = makeBrowserTab("browser-a", "right", 0);
    expect(capture({ session: makeSession({ tabs: [tab] }), enabled: false })).toBe(null);
    expect(capture({ session: makeSession({ tabs: [tab], hasThread: true }) })).toBe(null);
  });

  test("omits the complete transfer tuple when no browser tab is eligible", () => {
    expect(capture({ session: makeSession() })).toBe(null);
    expect(capture({
      session: makeSession(),
      browserTabs: [makeBrowserSnapshot("other", "session-other")],
      browserUseTabs: [makeBrowserUseTab("other-use", "session-other")],
    })).toBe(null);
  });

  test("keeps right, bottom, runtime, and BrowserUse first-wins order", () => {
    const rightA = makeBrowserTab("right-a", "right", 0);
    const rightB = makeBrowserTab("shared", "right", 1);
    const bottom = makeBrowserTab("bottom-a", "bottom", 0);
    const result = capture({
      session: makeSession({ tabs: [rightA, rightB, bottom] }),
      browserTabs: [
        makeBrowserSnapshot("shared"),
        makeBrowserSnapshot("runtime-only"),
      ],
      browserUseTabs: [
        makeBrowserUseTab("runtime-only"),
        makeBrowserUseTab("browser-use-only"),
      ],
    });

    expect(JSON.stringify(result?.browserTransferSourceBrowserTabIds)).toBe(
      JSON.stringify(["right-a", "shared", "bottom-a", "runtime-only", "browser-use-only"]),
    );
  });

  test("uses conversation browser identity rather than panel storage ids", () => {
    const tab = makeBrowserTab("panel-storage-id", "right", 0);
    tab.browserTabId = "browser-runtime-id";
    const result = capture({
      session: makeSession({ tabs: [tab], rightActiveTabId: tab.id }),
      browserTabs: [makeBrowserSnapshot("browser-runtime-id")],
    });

    expect(JSON.stringify(result)).toBe(JSON.stringify({
      browserTransferSourceBrowserTabId: "browser-runtime-id",
      browserTransferSourceBrowserTabIds: ["browser-runtime-id"],
      browserTransferSourceConversationId: "session-source",
    }));
  });

  test("selects remembered, active right, active bottom, then final captured id", () => {
    const right = makeBrowserTab("right", "right", 0);
    const bottom = makeBrowserTab("bottom", "bottom", 0);
    const runtime = makeBrowserSnapshot("runtime");

    expect(capture({
      session: makeSession({ tabs: [right, bottom], rightActiveTabId: "right" }),
      browserTabs: [runtime],
      activeBrowserUseTabId: "runtime",
    })?.browserTransferSourceBrowserTabId).toBe("runtime");
    expect(capture({
      session: makeSession({ tabs: [right, bottom], rightActiveTabId: "right" }),
      browserTabs: [runtime],
      activeBrowserUseTabId: "missing",
    })?.browserTransferSourceBrowserTabId).toBe("right");
    expect(capture({
      session: makeSession({ tabs: [bottom], bottomActiveTabId: "bottom" }),
      browserTabs: [runtime],
    })?.browserTransferSourceBrowserTabId).toBe("bottom");
    expect(capture({
      session: makeSession(),
      browserTabs: [runtime],
    })?.browserTransferSourceBrowserTabId).toBe("runtime");
  });

  test("returns a frozen list copy owned by the pending request", () => {
    const browserTabs = [makeBrowserSnapshot("runtime")];
    const result = capture({ session: makeSession(), browserTabs });
    browserTabs.push(makeBrowserSnapshot("late"));

    expect(JSON.stringify(result)).toBe(JSON.stringify({
      browserTransferSourceBrowserTabId: "runtime",
      browserTransferSourceBrowserTabIds: ["runtime"],
      browserTransferSourceConversationId: "session-source",
    }));
  });
});
