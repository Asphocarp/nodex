import { describe, expect, test } from "vitest";
import {
  makeDefaultBrowserSidebarTabId,
  type BrowserSidebarBrowserUseStateSnapshot,
  type BrowserSidebarDeviceToolbarState,
  type BrowserSidebarStateSnapshot,
  type BrowserSidebarTabSnapshot,
  type BrowserUseTabState,
} from "../../shared/browser-sidebar";
import { makeProjectSessionPanelLayout } from "../../shared/project-session-panel-layout";
import type {
  PanelId,
  ProjectSession,
  ProjectSessionTab,
} from "../../shared/types";
import {
  createCodexForkBrowserSnapshotAdapter,
  type CodexForkBrowserSidePanelSnapshot,
  type CodexForkBrowserSnapshotAdapterDependencies,
} from "./codex-fork-browser-snapshot-adapter";
import { CodexForkSidePanelTransferManager } from "./codex-fork-side-panel-transfer";

const CREATED_AT = "2026-07-11T00:00:00.000Z";

function makeDeviceState(seed: number): BrowserSidebarDeviceToolbarState {
  return {
    responsiveViewportSize: { width: seed + 100, height: seed + 200 },
    toolbarState: {
      isEnabled: true,
      presetId: `preset-${seed}`,
      width: seed + 300,
      height: seed + 400,
    },
  };
}

type TabInputBase = {
  id: string;
  panelId: PanelId;
  order: number;
  sessionId?: string;
  projectId?: string | null;
};

type TabInput = TabInputBase & (
  | { kind?: "browser"; browserTabId?: string | null }
  | { kind: "terminal"; browserTabId?: never }
);

function makeTab(input: TabInput): ProjectSessionTab {
  const projectId = input.projectId === undefined ? "project-source" : input.projectId;
  const base = {
    id: input.id,
    sessionId: input.sessionId ?? "session-source",
    projectId,
    panelId: input.panelId,
    title: input.id,
    order: input.order,
    stateKey: 0,
    state: {},
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  if (input.kind === "terminal") {
    return {
      ...base,
      browserTabId: null,
      kind: input.kind,
      config: { terminalSessionId: `terminal:${input.id}` },
    };
  }
  return {
    ...base,
    browserTabId: input.browserTabId ?? input.id,
    kind: "browser",
    config: { projectId },
  };
}

function makeSession(input: {
  id: string;
  projectId?: string | null;
  tabs?: readonly ProjectSessionTab[];
  rightActiveTabId?: string | null;
  bottomActiveTabId?: string | null;
}): ProjectSession {
  const projectId = input.projectId === undefined ? "project-source" : input.projectId;
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
    id: input.id,
    projectId,
    noThreadFallbackTitle: input.id,
    displayTitle: input.id,
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
    thread: null,
    tabs,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeBrowserSnapshot(input: {
  browserConversationId: string;
  browserTabId: string;
  url: string;
  deviceToolbarState?: BrowserSidebarDeviceToolbarState;
  projectId?: string | null;
}): BrowserSidebarTabSnapshot {
  const deviceToolbarState = input.deviceToolbarState ?? makeDeviceState(1);
  return {
    browserConversationId: input.browserConversationId,
    browserTabId: input.browserTabId,
    projectId: input.projectId === undefined ? "project-source" : input.projectId,
    webContentsId: null,
    mountGeneration: 0,
    url: input.url,
    title: input.browserTabId,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    zoomPercent: 100,
    deviceToolbarVisible: deviceToolbarState.toolbarState.isEnabled,
    viewport: {
      width: deviceToolbarState.toolbarState.width,
      height: deviceToolbarState.toolbarState.height,
      zoomPercent: 100,
      presetId: deviceToolbarState.toolbarState.presetId,
    },
    deviceToolbarState,
    interactionMode: "browse",
    findState: {
      open: false,
      query: "",
      activeMatchOrdinal: null,
      matchCount: null,
      caseSensitive: false,
    },
    hasBrowserPage: true,
    pageActionsDisabled: false,
    updatedAt: 0,
  };
}

function makeBrowserUseTab(input: {
  browserConversationId: string;
  browserTabId: string;
  url: string;
  projectId?: string | null;
}): BrowserUseTabState {
  return {
    browserConversationId: input.browserConversationId,
    browserTabId: input.browserTabId,
    projectId: input.projectId === undefined ? "project-source" : input.projectId,
    title: input.browserTabId,
    url: input.url,
    webContentsId: null,
    viewport: { width: 0, height: 0, zoomPercent: 100, presetId: "responsive" },
    captureActive: false,
    released: false,
    updatedAt: 0,
  };
}

interface HarnessOptions {
  sourceSession?: ProjectSession | null;
  targetSession?: ProjectSession | null;
  browserState?: BrowserSidebarStateSnapshot;
  browserUseState?: BrowserSidebarBrowserUseStateSnapshot;
  fallbackBrowserTabIds?: readonly string[];
  openResult?: unknown;
  failDeviceWrites?: number;
}

function makeHarness(options: HarnessOptions = {}) {
  const sourceSession = options.sourceSession === undefined
    ? makeSession({ id: "session-source" })
    : options.sourceSession;
  const targetSession = options.targetSession === undefined
    ? makeSession({ id: "session-target", projectId: "project-target" })
    : options.targetSession;
  const browserState = options.browserState ?? { tabs: [] };
  const browserUseState = options.browserUseState ?? {
    tabs: [],
    activeBrowserTabIdsByConversation: {},
    cursors: [],
  };
  const fallbackBrowserTabIds = [...(options.fallbackBrowserTabIds ?? [])];
  const events: string[] = [];
  const createdInputs: Parameters<
    CodexForkBrowserSnapshotAdapterDependencies["createTargetBrowserPanelTab"]
  >[0][] = [];
  const openInputs: Parameters<
    CodexForkBrowserSnapshotAdapterDependencies["runtime"]["openClonedBrowserTab"]
  >[0][] = [];
  const deviceWrites: Array<{
    identity: { browserConversationId: string; browserTabId: string };
    state: BrowserSidebarDeviceToolbarState;
  }> = [];
  let remainingDeviceWriteFailures = options.failDeviceWrites ?? 0;
  const sessions = new Map<string, ProjectSession>();
  if (sourceSession) sessions.set(sourceSession.id, sourceSession);
  if (targetSession) sessions.set(targetSession.id, targetSession);

  const dependencies: CodexForkBrowserSnapshotAdapterDependencies = {
    async createTargetBrowserPanelTab(input) {
      events.push(`create:${input.browserTabId}:${input.panel}`);
      createdInputs.push(input);
      return makeTab({
        id: input.durableTabId,
        sessionId: input.targetProjectSession.id,
        projectId: input.targetProjectSession.projectId,
        panelId: input.panel,
        order: createdInputs.length - 1,
        browserTabId: input.browserTabId,
      });
    },
    async getProjectSession(projectSessionId) {
      return sessions.get(projectSessionId) ?? null;
    },
    async resolveBrowserConversationId(conversationId) {
      if (conversationId === "thread-source") return "session-source";
      if (conversationId === "thread-target") return "session-target";
      return conversationId;
    },
    async resolveProjectSession(conversationId) {
      if (conversationId !== "thread-source") return null;
      return sourceSession;
    },
    runtime: {
      getBrowserUseStateSnapshot: () => browserUseState,
      getConversationBrowserTabIds: () => [...fallbackBrowserTabIds],
      getDeviceToolbarTabState(identity) {
        return browserState.tabs.find((tab) =>
          tab.browserConversationId === identity.browserConversationId
          && tab.browserTabId === identity.browserTabId
        )?.deviceToolbarState ?? makeDeviceState(0);
      },
      getStateSnapshot: () => browserState,
      openClonedBrowserTab(input) {
        events.push(`open:${input.browserTabId}`);
        openInputs.push(input);
        return options.openResult;
      },
      primeTransferredBrowserTabId(browserConversationId, browserTabId) {
        events.push(`prime:${browserConversationId}:${browserTabId}`);
      },
      setDeviceToolbarTabState(identity, state) {
        events.push(`device:${identity.browserTabId}`);
        deviceWrites.push({ identity, state });
        if (remainingDeviceWriteFailures <= 0) return;
        remainingDeviceWriteFailures -= 1;
        throw new Error("device write failed");
      },
    },
  };
  return {
    adapter: createCodexForkBrowserSnapshotAdapter(dependencies),
    browserState,
    createdInputs,
    deviceWrites,
    events,
    openInputs,
  };
}

describe("Codex fork browser snapshot adapter", () => {
  test("captures mounted right then bottom order, repairs unsupported active tabs, and appends runtime-only tabs after right", async () => {
    const sourceSession = makeSession({
      id: "session-source",
      tabs: [
        makeTab({ id: "right-a", browserTabId: "browser-right-a", panelId: "right", order: 0 }),
        makeTab({ id: "right-terminal", panelId: "right", order: 1, kind: "terminal" }),
        makeTab({ id: "right-b", browserTabId: "browser-right-b", panelId: "right", order: 2 }),
        makeTab({ id: "bottom-terminal", panelId: "bottom", order: 0, kind: "terminal" }),
        makeTab({ id: "bottom-a", browserTabId: "browser-bottom-a", panelId: "bottom", order: 1 }),
      ],
      rightActiveTabId: "right-terminal",
      bottomActiveTabId: "bottom-terminal",
    });
    const browserUseState: BrowserSidebarBrowserUseStateSnapshot = {
      tabs: [makeBrowserUseTab({
        browserConversationId: "session-source",
        browserTabId: "runtime-only",
        url: "https://runtime.example",
      })],
      activeBrowserTabIdsByConversation: { "session-source": "runtime-only" },
      cursors: [],
    };
    const { adapter } = makeHarness({ sourceSession, browserUseState });

    const captured = await adapter.capture("thread-source");
    expect(JSON.stringify(captured.tabs.map((tab) => ({
      active: tab.active,
      browserTabId: tab.browserTabId,
      insertAfterTabId: tab.insertAfterTabId,
      panel: tab.panel,
      tabId: tab.tabId,
    })))).toBe(JSON.stringify([
      {
        active: true,
        browserTabId: "browser-right-a",
        insertAfterTabId: null,
        panel: "right",
        tabId: "right-a",
      },
      {
        active: false,
        browserTabId: "browser-right-b",
        insertAfterTabId: "right-a",
        panel: "right",
        tabId: "right-b",
      },
      {
        active: true,
        browserTabId: "browser-bottom-a",
        insertAfterTabId: null,
        panel: "bottom",
        tabId: "bottom-a",
      },
      {
        active: true,
        browserTabId: "runtime-only",
        insertAfterTabId: "right-b",
        panel: "right",
        tabId: "runtime-only",
      },
    ]));
  });

  test("captures a runtime-only conversation without a mounted project session", async () => {
    const browserState: BrowserSidebarStateSnapshot = {
      tabs: [
        makeBrowserSnapshot({
          browserConversationId: "runtime-source",
          browserTabId: "runtime-a",
          url: "https://a.example",
          deviceToolbarState: makeDeviceState(11),
        }),
      ],
    };
    const browserUseState: BrowserSidebarBrowserUseStateSnapshot = {
      tabs: [makeBrowserUseTab({
        browserConversationId: "runtime-source",
        browserTabId: "runtime-b",
        url: "https://b.example",
      })],
      activeBrowserTabIdsByConversation: {},
      cursors: [],
    };
    const { adapter } = makeHarness({
      sourceSession: null,
      browserState,
      browserUseState,
      fallbackBrowserTabIds: ["runtime-a", "runtime-b"],
    });

    const captured = await adapter.capture("runtime-source");
    expect(JSON.stringify(captured.tabs.map((tab) => ({
      active: tab.active,
      browserTabId: tab.browserTabId,
      initialUrl: tab.initialUrl,
      insertAfterTabId: tab.insertAfterTabId,
      panel: tab.panel,
    })))).toBe(JSON.stringify([
      {
        active: false,
        browserTabId: "runtime-a",
        initialUrl: "https://a.example",
        insertAfterTabId: null,
        panel: "right",
      },
      {
        active: true,
        browserTabId: "runtime-b",
        initialUrl: "https://b.example",
        insertAfterTabId: "runtime-a",
        panel: "right",
      },
    ]));
  });

  test("rebases only the legacy default browser identity and remaps insertion references", async () => {
    const sourceDefault = makeDefaultBrowserSidebarTabId("session-source");
    const targetDefault = makeDefaultBrowserSidebarTabId("session-target");
    const sourceSession = makeSession({
      id: "session-source",
      tabs: [
        makeTab({
          id: "source-default-panel-tab",
          browserTabId: sourceDefault,
          panelId: "right",
          order: 0,
        }),
        makeTab({
          id: "stable-panel-tab",
          browserTabId: "stable-browser-tab",
          panelId: "right",
          order: 1,
        }),
      ],
    });
    const { adapter } = makeHarness({ sourceSession });

    const captured = await adapter.capture("thread-source");
    const rebased = await adapter.rebase(captured, { targetConversationId: "thread-target" });
    expect(JSON.stringify(rebased.tabs.map((tab) => ({
      browserTabId: tab.browserTabId,
      insertAfterTabId: tab.insertAfterTabId,
      tabId: tab.tabId,
    })))).toBe(JSON.stringify([
      {
        browserTabId: targetDefault,
        insertAfterTabId: null,
        tabId: targetDefault,
      },
      {
        browserTabId: "stable-browser-tab",
        insertAfterTabId: targetDefault,
        tabId: "stable-panel-tab",
      },
    ]));
    expect(captured.tabs[0]?.browserTabId).toBe(sourceDefault);
    expect(captured.tabs[0]?.tabId).toBe("source-default-panel-tab");
    expect(rebased.sourceBrowserConversationId).toBe("session-source");
    expect(rebased.targetBrowserConversationId).toBe("session-target");
  });

  test("freezes the URL and complete device state, clones into a projectless target, and leaves source state untouched", async () => {
    const deviceState = makeDeviceState(27);
    const sourceSnapshot = makeBrowserSnapshot({
      browserConversationId: "session-source",
      browserTabId: "stable-browser",
      url: "https://frozen.example/initial",
      deviceToolbarState: deviceState,
      projectId: null,
    });
    const browserState: BrowserSidebarStateSnapshot = { tabs: [sourceSnapshot] };
    const sourceSession = makeSession({
      id: "session-source",
      projectId: null,
      tabs: [makeTab({
        id: "stable-panel",
        browserTabId: "stable-browser",
        panelId: "right",
        order: 0,
        projectId: null,
      })],
    });
    const targetSession = makeSession({ id: "session-target", projectId: null });
    const { adapter, createdInputs, deviceWrites, openInputs } = makeHarness({
      sourceSession,
      targetSession,
      browserState,
      openResult: null,
    });
    const captured = await adapter.capture("thread-source");
    browserState.tabs[0] = makeBrowserSnapshot({
      browserConversationId: "session-source",
      browserTabId: "stable-browser",
      url: "https://replacement.example/later",
      deviceToolbarState: makeDeviceState(99),
      projectId: null,
    });
    const sourceAfterReplacement = JSON.stringify(browserState);
    const rebased = await adapter.rebase(captured, { targetConversationId: "thread-target" });
    await adapter.apply(rebased, {
      targetConversationId: "thread-target",
      targetProjectSessionId: "session-target",
    });

    expect(openInputs[0]?.initialUrl).toBe("https://frozen.example/initial");
    expect(openInputs[0]?.projectId).toBe(null);
    expect(createdInputs[0]?.targetProjectSession.projectId).toBe(null);
    expect(captured.tabs[0]?.deviceToolbarState === deviceState).toBe(true);
    expect(JSON.stringify(deviceWrites[0]?.state)).toBe(JSON.stringify(makeDeviceState(27)));
    expect(JSON.stringify(browserState)).toBe(sourceAfterReplacement);
  });

  test("applies every descriptor sequentially, ignores null open results, and attempts duplicates", async () => {
    const { adapter, events } = makeHarness({ openResult: null });
    const deviceState = makeDeviceState(42);
    const targetDefault = makeDefaultBrowserSidebarTabId("session-target");
    const snapshot: CodexForkBrowserSidePanelSnapshot = {
      bottomPanelOpen: false,
      focusArea: "main",
      rightPanelFullWidth: false,
      rightPanelOpen: true,
      sourceBrowserConversationId: "session-source",
      targetBrowserConversationId: "session-target",
      tabs: [
        {
          active: true,
          browserTabId: "duplicate-browser",
          deviceToolbarState: deviceState,
          initialUrl: "https://first.example",
          insertAfterTabId: null,
          kind: "browser",
          panel: "right",
          tabId: "duplicate-panel",
        },
        {
          active: false,
          browserTabId: "duplicate-browser",
          deviceToolbarState: deviceState,
          initialUrl: "https://second.example",
          insertAfterTabId: "duplicate-panel",
          kind: "browser",
          panel: "right",
          tabId: "duplicate-panel",
        },
        {
          active: false,
          browserTabId: targetDefault,
          deviceToolbarState: deviceState,
          initialUrl: null,
          insertAfterTabId: "duplicate-panel",
          kind: "browser",
          panel: "bottom",
          tabId: targetDefault,
        },
      ],
    };

    await adapter.apply(snapshot, {
      targetConversationId: "thread-target",
      targetProjectSessionId: "session-target",
    });
    expect(events.join(",")).toBe([
      "prime:session-target:duplicate-browser",
      "create:duplicate-browser:right",
      "open:duplicate-browser",
      "device:duplicate-browser",
      "prime:session-target:duplicate-browser",
      "create:duplicate-browser:right",
      "open:duplicate-browser",
      "device:duplicate-browser",
      `create:${targetDefault}:bottom`,
      `open:${targetDefault}`,
      `device:${targetDefault}`,
    ].join(","));
  });

  test("retains a target snapshot after a partial apply failure and retries the prefix", async () => {
    const sourceSession = makeSession({
      id: "session-source",
      tabs: [makeTab({
        id: "stable-panel",
        browserTabId: "stable-browser",
        panelId: "right",
        order: 0,
      })],
    });
    const { adapter, events } = makeHarness({ sourceSession, failDeviceWrites: 1 });
    const manager = new CodexForkSidePanelTransferManager(adapter);
    await manager.stageDirect({
      sourceConversationId: "thread-source",
      targetConversationId: "thread-target",
    });

    let failureMessage = "";
    try {
      await manager.consumeTarget({
        routeKind: "local-thread",
        targetConversationId: "thread-target",
        targetProjectSessionId: "session-target",
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }
    expect(failureMessage).toBe("device write failed");
    expect(manager.getTargetSnapshot("thread-target") !== null).toBe(true);

    expect(await manager.consumeTarget({
      routeKind: "local-thread",
      targetConversationId: "thread-target",
      targetProjectSessionId: "session-target",
    })).toBe(true);
    expect(events.filter((event) => event === "open:stable-browser").length).toBe(2);
    expect(manager.getTargetSnapshot("thread-target")).toBe(null);
  });
});
